"""WorkoutRepository: trainer-made workout plans (text only — no exercise media)."""

from __future__ import annotations

from typing import Any

from core.database import Result

from .base import Repository, Statement, count_of

PLAN_COLUMNS = (
    "wp.id, wp.member_id, wp.trainer_id, wp.title, wp.day_label, wp.notes, wp.status, wp.created_by, wp.created_at, wp.updated_at"
)
EXERCISE_COLUMNS = "e.id, e.workout_plan_id, e.position, e.exercise_name, e.sets, e.reps, e.weight, e.rest_seconds, e.notes"
_EXERCISE_INSERT = (
    "INSERT INTO workout_exercises (workout_plan_id, position, exercise_name, sets, reps, weight, rest_seconds, notes) "
)


class WorkoutRepository(Repository):
    async def for_member(self, member_id: int, *, include_archived: bool) -> list[Result]:
        status = "" if include_archived else " AND wp.status = 'ACTIVE'"
        return await self.db.batch(
            [
                (
                    f"SELECT {PLAN_COLUMNS}, t.name AS trainer_name FROM workout_plans wp "
                    f"LEFT JOIN trainers t ON t.id = wp.trainer_id WHERE wp.member_id = ?1{status} "
                    "ORDER BY wp.status, wp.updated_at DESC LIMIT 30",
                    [member_id],
                ),
                (
                    f"SELECT {EXERCISE_COLUMNS} FROM workout_exercises e JOIN workout_plans wp ON wp.id = e.workout_plan_id "
                    f"WHERE wp.member_id = ?1{status} ORDER BY e.workout_plan_id, e.position",
                    [member_id],
                ),
            ]
        )

    async def get(self, plan_id: int) -> list[Result]:
        return await self.db.batch(
            [
                (
                    f"SELECT {PLAN_COLUMNS}, t.name AS trainer_name, m.name AS member_name, m.member_code FROM workout_plans wp "
                    "JOIN members m ON m.id = wp.member_id LEFT JOIN trainers t ON t.id = wp.trainer_id WHERE wp.id = ?1",
                    [plan_id],
                ),
                (f"SELECT {EXERCISE_COLUMNS} FROM workout_exercises e WHERE e.workout_plan_id = ?1 ORDER BY e.position", [plan_id]),
            ]
        )

    async def member_of(self, plan_id: int) -> int | None:
        return await self.db.value("SELECT member_id FROM workout_plans WHERE id = ?1", [plan_id])

    async def recent(self, *, trainer_id: int | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int]:
        scope = "WHERE m.trainer_id = ?3" if trainer_id else ""
        params: list[Any] = [limit, offset] + ([trainer_id] if trainer_id else [])
        rows, total = await self.db.batch(
            [
                (
                    "SELECT wp.id, wp.member_id, wp.title, wp.day_label, wp.status, wp.updated_at, wp.created_at, "
                    "m.name AS member_name, m.member_code, t.name AS trainer_name, "
                    "(SELECT COUNT(*) FROM workout_exercises e WHERE e.workout_plan_id = wp.id) AS exercise_count "
                    "FROM workout_plans wp JOIN members m ON m.id = wp.member_id LEFT JOIN trainers t ON t.id = wp.trainer_id "
                    f"{scope} ORDER BY wp.id DESC LIMIT ?1 OFFSET ?2",
                    params,
                ),
                (
                    "SELECT COUNT(*) AS c FROM workout_plans wp JOIN members m ON m.id = wp.member_id "
                    + ("WHERE m.trainer_id = ?1" if trainer_id else ""),
                    [trainer_id] if trainer_id else [],
                ),
            ]
        )
        return rows.rows, count_of(total)

    def insert_plan_stmt(self, *, member_id: int, trainer_id: int | None, values: dict[str, Any], created_by: int | None, now: str) -> Statement:
        return (
            "INSERT INTO workout_plans (member_id, trainer_id, title, day_label, notes, status, created_by, created_at, updated_at) "
            "VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE', ?6, ?7, ?7) RETURNING id",
            [member_id, trainer_id, values["title"], values.get("day_label"), values.get("notes"), created_by, now],
        )

    def insert_exercise_for_new_plan_stmt(self, position: int, exercise: dict[str, Any]) -> Statement:
        """Exercise of the plan inserted earlier in the same batch (highest workout_plans.id)."""
        return (
            _EXERCISE_INSERT + "VALUES ((SELECT MAX(id) FROM workout_plans), ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            [position, exercise["exercise_name"], exercise.get("sets"), exercise.get("reps"), exercise.get("weight"),
             exercise.get("rest_seconds"), exercise.get("notes")],
        )

    def insert_exercise_stmt(self, plan_id: int, position: int, exercise: dict[str, Any]) -> Statement:
        return (
            _EXERCISE_INSERT + "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            [plan_id, position, exercise["exercise_name"], exercise.get("sets"), exercise.get("reps"), exercise.get("weight"),
             exercise.get("rest_seconds"), exercise.get("notes")],
        )

    def update_plan_stmt(self, plan_id: int, values: dict[str, Any], now: str) -> Statement:
        return (
            "UPDATE workout_plans SET title = ?2, day_label = ?3, notes = ?4, status = ?5, updated_at = ?6 WHERE id = ?1",
            [plan_id, values["title"], values.get("day_label"), values.get("notes"), values["status"], now],
        )

    def clear_exercises_stmt(self, plan_id: int) -> Statement:
        return ("DELETE FROM workout_exercises WHERE workout_plan_id = ?1", [plan_id])

    def delete_plan_stmt(self, plan_id: int) -> Statement:
        return ("DELETE FROM workout_plans WHERE id = ?1", [plan_id])
