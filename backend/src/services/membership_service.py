"""MembershipService: previews, lists, renewals follow-up and cancellation.

Memberships are created only by PaymentService once a payment is PAID; this service reads
them and lets an admin cancel one.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from core.errors import NotFound
from repositories.members import MemberRepository
from repositories.memberships import MembershipRepository
from repositories.plans import PlanRepository

from .context import Ctx
from .membership_rules import coverage_state, end_date_for, membership_out, next_start


class MembershipService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.memberships = MembershipRepository(ctx.db)
        self.members = MemberRepository(ctx.db)

    async def preview(self, member_id: int, plan_id: int) -> dict[str, Any]:
        """Dates a new membership would get if paid now (the backend recomputes them at activation)."""
        member, plan = await self.members.basic(member_id), await PlanRepository(self.ctx.db).get(plan_id)
        if not member:
            raise NotFound("Member not found.")
        if not plan or plan["status"] != "ACTIVE":
            raise NotFound("Plan not found.")
        today = self.ctx.clock.today()
        start = next_start(member["expiry_date"], today)
        return {
            "member_id": member_id,
            "plan": {"id": plan["id"], "name": plan["name"], "duration_days": plan["duration_days"], "price": plan["price"]},
            "start_date": start.isoformat(),
            "end_date": end_date_for(start, plan["duration_days"]).isoformat(),
            "is_renewal": member["expiry_date"] is not None,
            "current": coverage_state(member["expiry_date"], today),
        }

    async def for_member(self, member_id: int) -> list[dict[str, Any]]:
        today = self.ctx.clock.today()
        return [membership_out(r, today) for r in await self.memberships.for_member(member_id)]

    async def list(self, page, *, status: str | None, plan_id: int | None) -> dict[str, Any]:
        today = self.ctx.clock.today()
        rows, total = await self.memberships.list(
            status=status, plan_id=plan_id, today=today.isoformat(), soon=(today + timedelta(days=7)).isoformat(),
            limit=page.limit, offset=page.offset,
        )
        items = []
        for r in rows:
            item = membership_out(r, today)
            item.update({"member_name": r["member_name"], "member_code": r["member_code"], "phone": r["phone"]})
            items.append(item)
        return page.wrap(items, total)

    async def renewals_due(self, page, *, window: str) -> dict[str, Any]:
        """Follow-ups: memberships ending in the next 7 days, or lapsed in the last 30, not renewed."""
        today = self.ctx.clock.today()
        if window == "expired":
            low, high, newest = (today - timedelta(days=30)).isoformat(), (today - timedelta(days=1)).isoformat(), True
        else:
            low, high, newest = today.isoformat(), (today + timedelta(days=7)).isoformat(), False
        rows, total = await self.memberships.renewals_due(low=low, high=high, newest_first=newest, limit=page.limit, offset=page.offset)
        items = [
            {
                "member_id": r["member_id"],
                "member_code": r["member_code"],
                "name": r["name"],
                "phone": r["phone"],
                "plan_id": r["plan_id"],
                "plan_name": r["plan_name"],
                "has_pending_payment": bool(r["has_pending"]),
                "account_status": r["account_status"],
                **coverage_state(r["end_date"], today),
            }
            for r in rows
        ]
        return page.wrap(items, total)

    async def cancel(self, membership_id: int) -> dict[str, Any]:
        row = await self.memberships.get(membership_id)
        if not row:
            raise NotFound("Membership not found.")
        if row["status"] != "CANCELLED":
            now = self.ctx.now
            await self.ctx.db.batch(
                [
                    self.memberships.cancel_stmt(membership_id, now),
                    self.members.recompute_after_cancel_stmt(row["member_id"], self.ctx.clock.today().isoformat(), now),
                ]
            )
        return {"id": membership_id, "status": "CANCELLED"}
