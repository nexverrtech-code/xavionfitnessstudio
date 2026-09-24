"""PortalService: the member app. Every method is scoped to the signed-in member's own id —
never an id supplied by the client."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from core.clock import iso_z
from core.errors import NotFound
from repositories.members import MemberRepository
from repositories.memberships import MembershipRepository
from repositories.payments import PaymentRepository
from repositories.portal import PortalRepository

from .context import Ctx
from .membership_rules import coverage_state, membership_out
from .payment_service import payment_out


class PortalService:
    def __init__(self, ctx: Ctx, member_id: int) -> None:
        self.ctx = ctx
        self.member_id = member_id
        self.members = MemberRepository(ctx.db)

    async def overview(self) -> dict[str, Any]:
        """The member home screen in one round trip."""
        today = self.ctx.clock.today()
        strip_start = today - timedelta(days=13)
        (member_r, memberships_r, attendance_r, visits_r, payment_r, workout_r, notification_r, unread_r,
         pending_r) = await PortalRepository(self.ctx.db).overview(
            member_id=self.member_id, user_id=self.ctx.user.id if self.ctx.user else 0, today=today.isoformat(),
            month_start=today.replace(day=1).isoformat(), strip_start=strip_start.isoformat(),
        )
        member = member_r.first
        if not member:
            raise NotFound("Member not found.")
        memberships = [membership_out(r, today) for r in memberships_r.rows]
        attendance = attendance_r.first or {}
        visited = {r["attendance_date"] for r in visits_r.rows}
        payment, notification, pending = payment_r.first, notification_r.first, pending_r.first
        return {
            "member": {k: member[k] for k in ("id", "member_code", "name", "status", "trainer_name")},
            "membership": {
                **coverage_state(memberships[0]["end_date"] if memberships else None, today),
                "current": next((m for m in memberships if m["status"] in ("ACTIVE", "EXPIRING")), None),
                "upcoming": next((m for m in memberships if m["status"] == "UPCOMING"), None),
                "latest": memberships[0] if memberships else None,
            },
            "pending_payment": (
                {"id": pending["id"], "payment_number": pending["payment_number"], "amount": pending["amount"],
                 "plan_name": pending["plan_name"], "transaction_reference": pending["transaction_reference"],
                 "created_at": iso_z(pending["created_at"])}
                if pending else None
            ),
            "attendance": {
                "this_month": attendance.get("this_month", 0),
                "last_check_in": iso_z(attendance.get("last_check_in")),
                "checked_in_today": bool(attendance.get("today_check_in")),
                "last_14_days": [
                    {"date": (d := (strip_start + timedelta(days=i)).isoformat()), "visited": d in visited} for i in range(14)
                ],
            },
            "latest_payment": dict(payment) if payment else None,
            "current_workout": workout_r.first,
            "recent_notification": {**notification, "created_at": iso_z(notification["created_at"])} if notification else None,
            "unread_notifications": (unread_r.first or {}).get("c", 0),
        }

    async def profile(self) -> dict[str, Any]:
        row = await self.members.profile(self.member_id)
        if not row:
            raise NotFound("Member not found.")
        return row

    async def update_profile(self, *, email: str | None, address: str | None, emergency_contact: str | None) -> dict[str, Any]:
        await self.members.update_contact(self.member_id, email=email, address=address, emergency=emergency_contact, now=self.ctx.now)
        return await self.profile()

    async def membership(self) -> dict[str, Any]:
        today = self.ctx.clock.today()
        history = [membership_out(r, today) for r in await MembershipRepository(self.ctx.db).for_member(self.member_id, 60)]
        active = [m for m in history if m["status"] != "CANCELLED"]
        return {
            "membership": {
                **coverage_state(max((m["end_date"] for m in active), default=None), today),
                "current": next((m for m in active if m["status"] in ("ACTIVE", "EXPIRING")), None),
                "upcoming": next((m for m in active if m["status"] == "UPCOMING"), None),
                "latest": active[0] if active else None,
            },
            "history": history,
        }

    async def payments(self, page) -> dict[str, Any]:
        rows, total, _ = await PaymentRepository(self.ctx.db).list(
            start=None, end=None, status=None, method=None, member_id=self.member_id, q=None, member_code=None,
            limit=page.limit, offset=page.offset,
        )
        return page.wrap([payment_out(r) for r in rows], total)

    async def pending(self) -> dict[str, Any] | None:
        row = await PaymentRepository(self.ctx.db).pending_for_member(self.member_id)
        return payment_out(row) if row else None
