"""NotificationService: in-app notifications only (Version 1 has no email / SMS / WhatsApp).

Members see their notifications in the member app; admins also receive storage alerts.
Reminders are generated once a day by the scheduled Worker, never by frontend polling.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from core.clock import fmt_ts, iso_z
from core.database import Statement
from core.errors import NotFound
from models.domain import METHOD_LABELS, REMINDER_TYPES
from repositories.members import MemberRepository
from repositories.notifications import NotificationRepository
from repositories.users import UserRepository
from utils.formatting import first_name

from .context import Ctx

EVENT_TOGGLES = {
    "PAYMENT_RECEIVED": "notify_payment",
    "MEMBERSHIP_ACTIVATED": "notify_activation",
    "MEMBERSHIP_RENEWED": "notify_renewal",
    "TRAINER_ASSIGNED": "notify_trainer",
}
TEMPLATES = {
    "MEMBERSHIP_ACTIVATED": "Welcome to {gym}, {first}! Your {plan} membership is active from {start} to {end}.",
    "MEMBERSHIP_RENEWED": "Thanks {first}! Your {plan} membership is renewed. It is valid until {end}.",
    "PAYMENT_RECEIVED": "Payment of {amount} received ({method}). Payment number {number}. Thank you, {first}!",
    "PAYMENT_REJECTED": "We couldn't verify your UPI payment (UTR {utr}). {reason} Please contact the front desk.",
    "PAYMENT_REFUNDED": "A refund of {amount} for payment {number} has been recorded ({method}).",
    "TRAINER_ASSIGNED": "Hi {first}, {trainer} is now your trainer at {gym}.",
    "WELCOME": "Hi {first}, welcome to {gym}! Your member ID is {code}.",
    "STORAGE_ALERT": "Database storage is at {percent}% ({used} of {limit}) — status {level}. Open Data & Backup to review.",
}


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return ""


def render(kind: str, **context: Any) -> str:
    values = _SafeDict({k: ("" if v is None else v) for k, v in context.items()})
    if "method" in values:
        values["method"] = METHOD_LABELS.get(str(values["method"]), str(values["method"]))
    return " ".join(TEMPLATES[kind].format_map(values).split())[:300]


def notification_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "type": row["type"],
        "message": row["message"],
        "status": row["status"],
        "created_at": iso_z(row["created_at"]),
        "read_at": iso_z(row.get("read_at")),
    }


class NotificationService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.repo = NotificationRepository(ctx.db)

    # -- events --------------------------------------------------------------------------------
    async def statements(self, member: dict[str, Any], events: list[tuple[str, dict[str, Any]]]) -> list[Statement]:
        """Insert statements for a member's events (skipped when the member has no app login or
        the event type is switched off in Settings)."""
        user_id = member.get("user_id")
        if not user_id:
            return []
        settings = await self.ctx.settings()
        statements = []
        for kind, context in events:
            toggle = EVENT_TOGGLES.get(kind)
            if toggle and not settings.get(toggle):
                continue
            message = render(kind, gym=settings["gym_name"], first=first_name(member.get("name") or ""), **context)
            statements.append(self.repo.insert_stmt(user_id, kind, message, self.ctx.now))
        return statements

    async def notify(self, member: dict[str, Any], kind: str, **context: Any) -> None:
        statements = await self.statements(member, [(kind, context)])
        if statements:
            await self.ctx.db.batch(statements)

    async def announce(self, *, member_ids: list[int] | None, segment: str | None, message: str) -> dict[str, int]:
        """An admin message to one or more members (only members with the app receive it)."""
        members = MemberRepository(self.ctx.db)
        if member_ids:
            rows = await members.many(sorted(set(member_ids)))
            user_ids = [r["user_id"] for r in rows if r["user_id"]]
            targets = len(rows)
        else:
            today = self.ctx.clock.today()
            user_ids = await members.active_user_ids(segment or "ACTIVE", today.isoformat(), (today + timedelta(days=7)).isoformat())
            targets = len(user_ids)
        created = await self.repo.insert_for_users(user_ids, "ANNOUNCEMENT", message.strip(), self.ctx.now)
        return {"members": targets, "delivered": created, "without_app": targets - created}

    async def storage_alert(self, *, level: str, percent: float, used: str, limit: str) -> int:
        """Alert every admin once per day while storage is at WARNING or above."""
        users = UserRepository(self.ctx.db)
        day_start = self.ctx.clock.day_start_utc(self.ctx.clock.today())
        message = render("STORAGE_ALERT", percent=f"{percent:.1f}", used=used, limit=limit, level=level.replace("_", " "))
        sent = 0
        for admin_id in await users.admin_ids():
            if await self.repo.already_sent_today(admin_id, "STORAGE_ALERT", day_start):
                continue
            await self.ctx.db.run(*self.repo.insert_stmt(admin_id, "STORAGE_ALERT", message, self.ctx.now))
            sent += 1
        return sent

    # -- inbox (any signed-in user) --------------------------------------------------------------
    async def inbox(self, user_id: int, limit: int = 40) -> dict[str, Any]:
        rows, unread = await self.repo.inbox(user_id, limit)
        return {"items": [notification_out(r) for r in rows], "unread": unread}

    async def unread(self, user_id: int) -> int:
        return await self.repo.unread_count(user_id)

    async def mark_read(self, user_id: int, notification_id: int | None = None) -> None:
        changed = await self.repo.mark_read(user_id, notification_id, self.ctx.now)
        if notification_id is not None and changed == 0:
            raise NotFound("Notification not found.")

    # -- admin log -----------------------------------------------------------------------------------
    async def log(self, page, *, kind: str | None, status: str | None, member_id: int | None, days: int) -> dict[str, Any]:
        since = self.ctx.clock.day_start_utc(self.ctx.clock.today() - timedelta(days=days))
        rows, total = await self.repo.log(
            since=since, kind=kind, status=status, member_id=member_id, limit=page.limit, offset=page.offset
        )
        items = [
            {
                **notification_out(r),
                "user_name": r["user_name"],
                "member_id": r["member_id"],
                "member_code": r["member_code"],
                "audience": "ADMIN" if r["role_id"] == 1 else "STAFF" if r["role_id"] == 2 else "TRAINER" if r["role_id"] == 3 else "MEMBER",
            }
            for r in rows
        ]
        return page.wrap(items, total)

    # -- daily job -------------------------------------------------------------------------------------
    async def run_reminders(self) -> dict[str, int]:
        """7 / 3 / 1 days before expiry, and once after expiry — one statement per type,
        de-duplicated in SQL (never two reminders of the same type on the same day)."""
        settings = await self.ctx.settings()
        if not settings["reminders_enabled"]:
            return {"created": 0}
        today = self.ctx.clock.today()
        day_start = self.ctx.clock.day_start_utc(today)
        now = self.ctx.now
        statements = [
            self.repo.expiry_reminder_stmt(kind, (today + timedelta(days=days)).isoformat(), day_start, now)
            for days, kind in REMINDER_TYPES.items()
        ]
        statements.append(
            self.repo.expired_notice_stmt((today - timedelta(days=3)).isoformat(), (today - timedelta(days=1)).isoformat(), now)
        )
        results = await self.ctx.db.batch(statements)
        created = {kind: r.changes for kind, r in zip([*REMINDER_TYPES.values(), "MEMBERSHIP_EXPIRED"], results)}
        created["created"] = sum(created.values())
        return created

    async def cleanup(self) -> int:
        settings = await self.ctx.settings()
        cutoff = fmt_ts(self.ctx.clock.utcnow() - timedelta(days=settings["notification_retention_days"]))
        result = await self.ctx.db.run(*self.repo.cleanup_stmt(cutoff))
        return result.changes
