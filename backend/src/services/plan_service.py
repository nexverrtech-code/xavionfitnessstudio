"""PlanService: membership plans (Monthly 30 days, Quarterly 90 days ... or any custom plan)."""

from __future__ import annotations

from typing import Any

from core.clock import iso_z
from core.database import IntegrityError
from core.errors import Conflict, NotFound
from repositories.plans import PlanRepository

from .context import Ctx


def plan_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "duration_days": row["duration_days"],
        "price": row["price"],
        "description": row.get("description"),
        "status": row["status"],
        "active_members": row.get("active_members", 0),
        "created_at": iso_z(row.get("created_at")),
    }


class PlanService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.plans = PlanRepository(ctx.db)

    async def list(self, *, include_inactive: bool, with_stats: bool = False) -> list[dict[str, Any]]:
        rows = await self.plans.list(include_inactive=include_inactive, with_stats=with_stats, today=self.ctx.clock.today().isoformat())
        return [plan_out(r) for r in rows]

    async def save(self, values: dict[str, Any], plan_id: int | None = None) -> dict[str, Any]:
        try:
            if plan_id is None:
                row = await self.plans.insert(values, self.ctx.now)
            else:
                row = await self.plans.update(plan_id, values, self.ctx.now)
                if not row:
                    raise NotFound("Plan not found.")
        except IntegrityError as exc:
            if exc.mentions("membership_plans.name"):
                raise Conflict("A plan with this name already exists.", fields={"name": "Already exists"}) from None
            raise
        return plan_out(row)
