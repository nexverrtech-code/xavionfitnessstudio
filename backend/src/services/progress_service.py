"""ProgressService: body measurements and progress (weight, body fat, chest, waist, arm, thigh)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from core.clock import fmt_ts, iso_z
from core.errors import NotFound, ValidationFailed
from models.domain import METRICS
from repositories.members import MemberRepository
from repositories.measurements import MeasurementRepository

from .context import Ctx


def measurement_out(row: dict[str, Any], local_date: str) -> dict[str, Any]:
    return {
        "id": row["id"],
        "member_id": row.get("member_id"),
        "date": local_date,
        **{metric: row.get(metric) for metric in METRICS},
        "recorded_at": iso_z(row["recorded_at"]),
    }


class ProgressService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.measurements = MeasurementRepository(ctx.db)

    def _local_date(self, recorded_at: str) -> str:
        return self.ctx.clock.local_date_of(recorded_at).isoformat()

    async def for_member(self, member_id: int) -> dict[str, Any]:
        history = [measurement_out(r, self._local_date(r["recorded_at"])) for r in await self.measurements.for_member(member_id)]
        latest: dict[str, Any] = {}
        change: dict[str, Any] = {}
        for metric in METRICS:
            values = [(h["date"], h[metric]) for h in history if h[metric] is not None]
            if values:
                latest[metric] = {"value": values[0][1], "date": values[0][0]}
                if len(values) > 1:
                    change[metric] = round(values[0][1] - values[1][1], 2)
        bmi = None
        weight, height = latest.get("weight", {}).get("value"), latest.get("height", {}).get("value")
        if weight and height:
            bmi = round(weight / ((height / 100) ** 2), 1)
        return {"history": history, "latest": latest, "change": change, "bmi": bmi}

    async def record(self, member_id: int, values: dict[str, Any]) -> dict[str, Any]:
        if not await MemberRepository(self.ctx.db).basic(member_id):
            raise NotFound("Member not found.")
        today = self.ctx.clock.today()
        day: date = values.get("date") or today
        if day > today:
            raise ValidationFailed("The measurement date can't be in the future.", fields={"date": "Can't be in the future"})
        if day == today:
            recorded_at = self.ctx.now
        else:  # a past check-in: keep the current local time on the chosen day
            local = datetime.combine(day, self.ctx.clock.local_now().time().replace(microsecond=0), tzinfo=self.ctx.clock.tz)
            recorded_at = fmt_ts(local)
        row = await self.measurements.insert(member_id, values, recorded_at, self.ctx.actor_id)
        return measurement_out(row, day.isoformat())

    async def member_of(self, measurement_id: int) -> int:
        member_id = await self.measurements.member_of(measurement_id)
        if member_id is None:
            raise NotFound("Measurement not found.")
        return member_id

    async def delete(self, measurement_id: int) -> None:
        if not await self.measurements.delete(measurement_id):
            raise NotFound("Measurement not found.")

    async def recent(self, page, *, trainer_id: int | None) -> dict[str, Any]:
        rows, total = await self.measurements.recent(trainer_id=trainer_id, limit=page.limit, offset=page.offset)
        items = [
            {**measurement_out(r, self._local_date(r["recorded_at"])), "member_name": r["member_name"], "member_code": r["member_code"]}
            for r in rows
        ]
        return page.wrap(items, total)

