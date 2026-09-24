"""TrainerService: trainer profiles, status, member assignment and the trainer dashboard."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from core.clock import iso_z
from core.errors import Conflict, NotFound, ValidationFailed
from repositories.members import MemberRepository
from repositories.trainers import TrainerRepository
from repositories.users import UserRepository

from .context import Ctx
from .member_service import MemberService
from .membership_rules import coverage_state
from .notification_service import NotificationService
from .user_service import UserService


def trainer_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "phone": row["phone"],
        "email": row.get("email"),
        "specialization": row.get("specialization"),
        "joining_date": row.get("joining_date"),
        "status": row["status"],
        "member_count": row.get("member_count", 0),
        "has_login": row.get("login_status") == "ACTIVE",
        "login": (row.get("email") or row.get("phone")) if row.get("user_id") else None,
        "last_login_at": iso_z(row.get("last_login_at")),
        "created_at": iso_z(row.get("created_at")),
    }


class TrainerService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.trainers = TrainerRepository(ctx.db)

    async def list(self, *, status: str | None = None) -> list[dict[str, Any]]:
        return [trainer_out(r) for r in await self.trainers.list(status)]

    async def get(self, trainer_id: int) -> dict[str, Any]:
        row = await self.trainers.get(trainer_id)
        if not row:
            raise NotFound("Trainer not found.")
        return trainer_out(row)

    async def create(self, values: dict[str, Any]) -> dict[str, Any]:
        joining = values.get("joining_date") or self.ctx.clock.today()
        trainer_id = await self.trainers.insert({**values, "joining_date": joining.isoformat()}, self.ctx.now)
        return await self.get(trainer_id)

    async def update(self, trainer_id: int, values: dict[str, Any]) -> dict[str, Any]:
        record = {**values, "joining_date": values["joining_date"].isoformat() if values.get("joining_date") else None}
        if not await self.trainers.update(trainer_id, record, self.ctx.now):
            raise NotFound("Trainer not found.")
        trainer = await self.trainers.basic(trainer_id)
        if trainer and trainer["user_id"]:
            await UserRepository(self.ctx.db).rename(trainer["user_id"], values["name"], self.ctx.now)
        return await self.get(trainer_id)

    async def set_status(self, trainer_id: int, status: str) -> dict[str, Any]:
        trainer = await self.trainers.basic(trainer_id)
        if not trainer:
            raise NotFound("Trainer not found.")
        await self.trainers.set_status(trainer_id, status, self.ctx.now)
        if status == "INACTIVE":
            await UserService(self.ctx).disable_login(trainer["user_id"])
        return await self.get(trainer_id)

    async def enable_login(self, trainer_id: int) -> dict[str, Any]:
        return await UserService(self.ctx).trainer_login(trainer_id)

    async def assigned_members(self, trainer_id: int, page) -> dict[str, Any]:
        return await MemberService(self.ctx).list(page, q=None, status=None, trainer_id=trainer_id, sort="name")

    async def assign_members(self, trainer_id: int, member_ids: list[int]) -> dict[str, Any]:
        trainer = await self.trainers.basic(trainer_id)
        if not trainer:
            raise NotFound("Trainer not found.")
        if trainer["status"] != "ACTIVE":
            raise Conflict("Activate this trainer before assigning members.")
        ids = sorted(set(member_ids))
        members = MemberRepository(self.ctx.db)
        rows = await members.many(ids)
        if len(rows) != len(ids):
            raise ValidationFailed("Some selected members no longer exist.")
        changed = [r for r in rows if r["trainer_id"] != trainer_id]
        if changed:
            await members.assign_trainer_many([r["id"] for r in changed], trainer_id, self.ctx.now)
            notifications = NotificationService(self.ctx)
            statements = []
            for member in changed[:40]:  # stays well inside the per-request statement budget
                statements += await notifications.statements(member, [("TRAINER_ASSIGNED", {"trainer": trainer["name"]})])
            if statements:
                await self.ctx.db.batch(statements)
        return {"assigned": len(changed)}

    async def dashboard(self, trainer_id: int) -> dict[str, Any]:
        today = self.ctx.clock.today()
        week_start = today - timedelta(days=today.weekday())
        stale_before = (today - timedelta(days=30)).isoformat()
        counts, sessions, week, workouts, members = await self.trainers.dashboard(
            trainer_id, today.isoformat(), (today + timedelta(days=7)).isoformat(), week_start.isoformat()
        )
        alerts = []
        expiring = 0
        for m in members.rows:
            if not m["workouts"]:
                alerts.append({"member_id": m["id"], "name": m["name"], "member_code": m["member_code"], "kind": "NO_WORKOUT",
                               "message": "No workout plan yet"})
            elif not m["last_measured"] or m["last_measured"][:10] < stale_before:
                alerts.append({"member_id": m["id"], "name": m["name"], "member_code": m["member_code"], "kind": "MEASURE",
                               "message": "Measurements due (30+ days)"})
            state = coverage_state(m["expiry_date"], today)
            if state["status"] == "EXPIRING":
                expiring += 1
                days = state["days_left"]
                ends = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
                alerts.append({"member_id": m["id"], "name": m["name"], "member_code": m["member_code"], "kind": "EXPIRING",
                               "message": f"Membership ends {ends}"})
        first = counts.first or {}
        return {
            "assigned_members": first.get("assigned", 0),
            "active_members": first.get("active", 0),
            "expiring_members": expiring,
            "today_sessions": [
                {"id": r["id"], "member_id": r["member_id"], "name": r["name"], "member_code": r["member_code"],
                 "check_in": iso_z(r["check_in"]), "check_out": iso_z(r["check_out"]), "method": r["method"]}
                for r in sessions.rows
            ],
            "week_attendance": (week.first or {}).get("c", 0),
            "active_workouts": (workouts.first or {}).get("c", 0),
            "alerts": alerts[:20],
        }
