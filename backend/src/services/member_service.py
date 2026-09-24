"""MemberService: registration (auto member ID), search, lists, workspace, status, trainer
assignment, QR tokens and app access."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from core.clock import iso_z
from core.database import IntegrityError
from core.errors import Conflict, NotFound, ValidationFailed
from repositories.members import MemberRepository
from repositories.trainers import TrainerRepository
from repositories.users import UserRepository
from security.qr import new_qr_token, qr_payload
from utils.formatting import escape_like, member_code_candidates

from .context import Ctx
from .membership_rules import coverage_state, membership_out
from .notification_service import NotificationService
from .user_service import UserService


def search_terms(q: str, prefix: str) -> dict[str, Any]:
    text = " ".join(q.split())
    digits = "".join(ch for ch in text if ch.isdigit())
    compact = text.replace(" ", "").replace("-", "").replace("+", "")
    return {
        "text": text,
        "codes": member_code_candidates(text, prefix),
        "phone": digits if len(digits) >= 3 and compact.isdigit() else None,
        "has_letters": any(ch.isalpha() for ch in text),
        "email": text.lower() if "@" in text else None,
    }


def list_item(row: dict[str, Any], today: date) -> dict[str, Any]:
    return {
        "id": row["id"],
        "member_code": row["member_code"],
        "name": row["name"],
        "phone": row["phone"],
        "email": row.get("email"),
        "status": row["status"],
        "joining_date": row.get("joining_date"),
        "has_app": bool(row.get("user_id")),
        "trainer": {"id": row["trainer_id"], "name": row.get("trainer_name")} if row.get("trainer_id") else None,
        "membership": {**coverage_state(row.get("expiry_date"), today), "plan_name": row.get("plan_name")},
    }


class MemberService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.members = MemberRepository(ctx.db)

    # -- search & lists ------------------------------------------------------------------------
    async def search(self, q: str, *, limit: int = 8, trainer_id: int | None = None) -> list[dict[str, Any]]:
        """Member ID (exact), phone / name / email prefix — index lookups in one round trip, with a
        word-inside-the-name fallback only when prefixes find too few."""
        settings = await self.ctx.settings()
        terms = search_terms(q, settings["member_code_prefix"])
        if len(terms["text"]) < 2 and not terms["codes"]:
            return []
        statements = self.members.search_statements(terms, limit=limit, trainer_id=trainer_id)
        seen: dict[int, dict[str, Any]] = {}
        if statements:
            for result in await self.ctx.db.batch(statements):
                for row in result.rows:
                    seen.setdefault(row["id"], row)
        if len(seen) < limit and terms["has_letters"] and len(terms["text"]) >= 3:
            for row in await self.members.search_word(f"% {escape_like(terms['text'])}%", limit=limit, trainer_id=trainer_id):
                seen.setdefault(row["id"], row)
        today = self.ctx.clock.today()
        return [list_item(r, today) for r in list(seen.values())[:limit]]

    async def list(self, page, *, q: str | None, status: str | None, trainer_id: int | None, sort: str) -> dict[str, Any]:
        today = self.ctx.clock.today()
        terms = None
        if q and q.strip():
            settings = await self.ctx.settings()
            terms = search_terms(q, settings["member_code_prefix"])
        rows, total = await self.members.list(
            status=status, trainer_id=trainer_id, terms=terms, today=today.isoformat(),
            soon=(today + timedelta(days=7)).isoformat(), sort=sort, limit=page.limit, offset=page.offset,
        )
        return page.wrap([list_item(r, today) for r in rows], total)

    # -- registration & edits ------------------------------------------------------------------
    async def _check_trainer(self, trainer_id: int | None) -> dict[str, Any] | None:
        if trainer_id is None:
            return None
        trainer = await TrainerRepository(self.ctx.db).basic(trainer_id)
        if not trainer or trainer["status"] != "ACTIVE":
            raise ValidationFailed("Choose an active trainer.", fields={"trainer_id": "Choose an active trainer"})
        return trainer

    async def create(self, values: dict[str, Any], *, create_app_login: bool) -> dict[str, Any]:
        settings = await self.ctx.settings()
        today = self.ctx.clock.today()
        joining = values.get("joining_date") or today
        if joining > today:
            raise ValidationFailed("Joining date can't be in the future.", fields={"joining_date": "Can't be in the future"})
        await self._check_trainer(values.get("trainer_id"))
        duplicate = await self.members.duplicate(values["name"], values["phone"])
        if duplicate:
            raise Conflict(f"{values['name']} is already registered with this phone number ({duplicate}).")
        record = {**values, "joining_date": joining.isoformat(),
                  "date_of_birth": values["date_of_birth"].isoformat() if values.get("date_of_birth") else None}
        try:
            row = (await self.ctx.db.run(*self.members.insert_stmt(
                prefix=settings["member_code_prefix"], values=record, qr_token=new_qr_token(),
                created_by=self.ctx.actor_id, now=self.ctx.now,
            ))).first
        except IntegrityError as exc:
            if exc.mentions("member_code", "members.id"):
                raise Conflict("Please try again — another member was added at the same moment.") from None
            raise
        credentials = None
        if create_app_login:
            credentials = await UserService(self.ctx).member_login(row["id"])
            member = await self.members.basic(row["id"])
            await NotificationService(self.ctx).notify(member, "WELCOME", code=row["member_code"])
        return {"member": await self.workspace(row["id"]), "credentials": credentials}

    async def update(self, member_id: int, values: dict[str, Any]) -> dict[str, Any]:
        if values["joining_date"] > self.ctx.clock.today():
            raise ValidationFailed("Joining date can't be in the future.", fields={"joining_date": "Can't be in the future"})
        current = await self.members.basic(member_id)
        if not current:
            raise NotFound("Member not found.")
        record = {**values, "joining_date": values["joining_date"].isoformat(),
                  "date_of_birth": values["date_of_birth"].isoformat() if values.get("date_of_birth") else None}
        await self.members.update(member_id, record, self.ctx.now)
        if "trainer_id" in values and values["trainer_id"] != current["trainer_id"]:
            await self.assign_trainer(member_id, values["trainer_id"])
        if current["user_id"] and values["name"] != current["name"]:
            await UserRepository(self.ctx.db).rename(current["user_id"], values["name"], self.ctx.now)
        return await self.workspace(member_id)

    async def set_status(self, member_id: int, action: str) -> dict[str, Any]:
        """suspend / deactivate set the status; reactivate recomputes it from memberships."""
        member = await self.members.basic(member_id)
        if not member:
            raise NotFound("Member not found.")
        now = self.ctx.now
        if action == "SUSPEND":
            await self.members.set_status(member_id, "SUSPENDED", now)
        elif action == "DEACTIVATE":
            await self.members.set_status(member_id, "INACTIVE", now)
        else:
            await self.ctx.db.run(*self.members.reactivate_stmt(member_id, self.ctx.clock.today().isoformat(), now))
        updated = await self.members.basic(member_id)
        return {"id": member_id, "status": updated["status"]}

    async def assign_trainer(self, member_id: int, trainer_id: int | None) -> dict[str, Any]:
        member = await self.members.basic(member_id)
        if not member:
            raise NotFound("Member not found.")
        trainer = await self._check_trainer(trainer_id)
        if member["trainer_id"] != trainer_id:
            await self.members.set_trainer(member_id, trainer_id, self.ctx.now)
            if trainer:
                await NotificationService(self.ctx).notify(member, "TRAINER_ASSIGNED", trainer=trainer["name"])
        return {"member_id": member_id, "trainer": {"id": trainer["id"], "name": trainer["name"]} if trainer else None}

    # -- QR & app access -------------------------------------------------------------------------
    async def qr(self, member_id: int) -> dict[str, Any]:
        row = await self.members.qr(member_id)
        if not row:
            raise NotFound("Member not found.")
        return {"member_id": row["id"], "member_code": row["member_code"], "name": row["name"], "payload": qr_payload(row["qr_token"])}

    async def reset_qr(self, member_id: int) -> dict[str, Any]:
        if not await self.members.set_qr_token(member_id, new_qr_token(), self.ctx.now):
            raise NotFound("Member not found.")
        return await self.qr(member_id)

    async def enable_app(self, member_id: int, *, password: str | None = None, must_change: bool = True) -> dict[str, Any]:
        return await UserService(self.ctx).member_login(member_id, password=password, must_change=must_change)

    async def disable_app(self, member_id: int) -> None:
        member = await self.members.basic(member_id)
        if not member:
            raise NotFound("Member not found.")
        await UserService(self.ctx).disable_login(member["user_id"])

    # -- workspace ------------------------------------------------------------------------------
    async def workspace(self, member_id: int, *, include_finance: bool = True) -> dict[str, Any]:
        """Everything the member workspace header needs, in one round trip."""
        today = self.ctx.clock.today()
        results = await self.members.workspace(member_id, today.replace(day=1).isoformat(), include_finance=include_finance)
        member = results[0].first
        if not member:
            raise NotFound("Member not found.")
        memberships = [membership_out(r, today) for r in results[1].rows]
        expiry = results[1].rows[0]["end_date"] if results[1].rows else None
        attendance = results[2].first or {}
        measurement = results[3].first
        login = results[5].first
        pending = results[7].first if include_finance else None
        stats: dict[str, Any] = {
            "visits_total": attendance.get("total", 0),
            "visits_this_month": attendance.get("this_month", 0),
            "last_check_in": iso_z(attendance.get("last_check_in")),
            "active_workouts": (results[4].first or {}).get("c", 0),
            "latest_weight": measurement["weight"] if measurement else None,
            "latest_measured_at": iso_z(measurement["recorded_at"]) if measurement else None,
        }
        if include_finance:
            finance = results[6].first or {}
            stats.update({"total_paid": finance.get("total_paid", 0), "last_payment_date": finance.get("last_payment_date")})
        return {
            "id": member["id"],
            "member_code": member["member_code"],
            "name": member["name"],
            "phone": member["phone"],
            "email": member["email"],
            "gender": member["gender"],
            "date_of_birth": member["date_of_birth"],
            "address": member["address"],
            "emergency_contact": member["emergency_contact"],
            "joining_date": member["joining_date"],
            "status": member["status"],
            "trainer": {"id": member["trainer_id"], "name": member["trainer_name"]} if member["trainer_id"] else None,
            "membership": {
                **coverage_state(expiry, today),
                "current": next((m for m in memberships if m["status"] in ("ACTIVE", "EXPIRING")), None),
                "upcoming": next((m for m in memberships if m["status"] == "UPCOMING"), None),
                "latest": memberships[0] if memberships else None,
            },
            "pending_payment": (
                {
                    "id": pending["id"],
                    "payment_number": pending["payment_number"],
                    "amount": pending["amount"],
                    "plan_name": pending["plan_name"],
                    "transaction_reference": pending["transaction_reference"],
                    "payment_date": pending["payment_date"],
                    "created_at": iso_z(pending["created_at"]),
                }
                if pending
                else None
            ),
            "stats": stats,
            "app": {
                "enabled": bool(login and login["status"] == "ACTIVE"),
                "login": member["member_code"] if login else None,
                "last_login_at": iso_z(login["last_login_at"]) if login else None,
                "must_change_password": bool(login and login["must_change_password"]),
            },
            "created_at": iso_z(member["created_at"]),
        }

    async def activity(self, member_id: int, *, include_finance: bool = True, limit: int = 25) -> list[dict[str, Any]]:
        results = await self.members.activity(member_id, include_finance=include_finance)
        events: list[dict[str, Any]] = []
        for r in results[0].rows:
            events.append({"type": "ATTENDANCE", "at": iso_z(r["check_in"]),
                           "title": "Checked in" + (" (manual)" if r["method"] == "MANUAL" else ""), "ref": r["id"]})
        for r in results[1].rows:
            label = "Membership cancelled" if r["status"] == "CANCELLED" else "Membership activated"
            events.append({"type": "MEMBERSHIP", "at": iso_z(r["created_at"]), "title": f"{label} · {r['plan_name']}", "ref": r["id"]})
        for r in results[2].rows:
            detail = f" · {r['weight']:g} kg" if r["weight"] else ""
            events.append({"type": "MEASUREMENT", "at": iso_z(r["recorded_at"]), "title": f"Measurements recorded{detail}", "ref": r["id"]})
        for r in results[3].rows:
            events.append({"type": "WORKOUT", "at": iso_z(r["updated_at"] or r["created_at"]), "title": f"Workout · {r['title']}", "ref": r["id"]})
        for r in results[4].rows:
            events.append({"type": "NOTIFICATION", "at": iso_z(r["created_at"]), "title": r["message"], "ref": r["id"]})
        if include_finance:
            for r in results[5].rows:
                events.append(
                    {
                        "type": "PAYMENT",
                        "at": iso_z(r["verified_at"] or r["created_at"]),
                        "title": f"Payment {r['payment_number']} · {r['status'].lower()}",
                        "amount": r["amount"],
                        "status": r["status"],
                        "ref": r["id"],
                    }
                )
        events.sort(key=lambda e: e["at"] or "", reverse=True)
        return events[:limit]
