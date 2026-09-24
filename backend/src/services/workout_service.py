"""WorkoutService: trainer-made workout plans (exercise, sets, reps, weight, rest, notes)."""

from __future__ import annotations

from typing import Any

from core.clock import iso_z
from core.errors import NotFound
from repositories.members import MemberRepository
from repositories.workouts import WorkoutRepository

from .context import Ctx


def _plan_out(plan: dict[str, Any], exercises: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": plan["id"],
        "member_id": plan["member_id"],
        "member_name": plan.get("member_name"),
        "member_code": plan.get("member_code"),
        "trainer_id": plan.get("trainer_id"),
        "trainer_name": plan.get("trainer_name"),
        "title": plan["title"],
        "day_label": plan.get("day_label"),
        "notes": plan.get("notes"),
        "status": plan["status"],
        "created_at": iso_z(plan.get("created_at")),
        "updated_at": iso_z(plan.get("updated_at")),
        "exercises": [
            {k: e[k] for k in ("id", "position", "exercise_name", "sets", "reps", "weight", "rest_seconds", "notes")}
            for e in exercises
        ],
    }


class WorkoutService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.workouts = WorkoutRepository(ctx.db)

    async def for_member(self, member_id: int, *, include_archived: bool = False) -> list[dict[str, Any]]:
        plans, exercises = await self.workouts.for_member(member_id, include_archived=include_archived)
        grouped: dict[int, list[dict[str, Any]]] = {}
        for e in exercises.rows:
            grouped.setdefault(e["workout_plan_id"], []).append(e)
        return [_plan_out(p, grouped.get(p["id"], [])) for p in plans.rows]

    async def get(self, plan_id: int) -> dict[str, Any]:
        plan, exercises = await self.workouts.get(plan_id)
        if not plan.first:
            raise NotFound("Workout not found.")
        return _plan_out(plan.first, exercises.rows)

    async def member_of(self, plan_id: int) -> int:
        member_id = await self.workouts.member_of(plan_id)
        if member_id is None:
            raise NotFound("Workout not found.")
        return member_id

    async def recent(self, page, *, trainer_id: int | None) -> dict[str, Any]:
        rows, total = await self.workouts.recent(trainer_id=trainer_id, limit=page.limit, offset=page.offset)
        items = [
            {
                "id": r["id"], "member_id": r["member_id"], "member_name": r["member_name"], "member_code": r["member_code"],
                "trainer_name": r["trainer_name"], "title": r["title"], "day_label": r["day_label"], "status": r["status"],
                "exercise_count": r["exercise_count"], "updated_at": iso_z(r["updated_at"]),
            }
            for r in rows
        ]
        return page.wrap(items, total)

    async def create(self, member_id: int, values: dict[str, Any]) -> dict[str, Any]:
        member = await MemberRepository(self.ctx.db).basic(member_id)
        if not member:
            raise NotFound("Member not found.")
        trainer_id = self.ctx.user.trainer_id if self.ctx.user and self.ctx.user.trainer_id else member["trainer_id"]
        statements = [self.workouts.insert_plan_stmt(member_id=member_id, trainer_id=trainer_id, values=values,
                                                     created_by=self.ctx.actor_id, now=self.ctx.now)]
        statements += [self.workouts.insert_exercise_for_new_plan_stmt(i, e) for i, e in enumerate(values["exercises"])]
        results = await self.ctx.db.batch(statements)
        return await self.get(results[0].first["id"])

    async def update(self, plan_id: int, values: dict[str, Any]) -> dict[str, Any]:
        statements = [self.workouts.update_plan_stmt(plan_id, values, self.ctx.now), self.workouts.clear_exercises_stmt(plan_id)]
        statements += [self.workouts.insert_exercise_stmt(plan_id, i, e) for i, e in enumerate(values["exercises"])]
        results = await self.ctx.db.batch(statements)
        if results[0].changes == 0:
            raise NotFound("Workout not found.")
        return await self.get(plan_id)

    async def copy(self, plan_id: int, member_id: int) -> dict[str, Any]:
        source = await self.get(plan_id)
        values = {
            "title": source["title"], "day_label": source["day_label"], "notes": source["notes"],
            "exercises": [{k: e[k] for k in ("exercise_name", "sets", "reps", "weight", "rest_seconds", "notes")} for e in source["exercises"]],
        }
        return await self.create(member_id, values)

    async def delete(self, plan_id: int) -> None:
        results = await self.ctx.db.batch([self.workouts.clear_exercises_stmt(plan_id), self.workouts.delete_plan_stmt(plan_id)])
        if results[1].changes == 0:
            raise NotFound("Workout not found.")
