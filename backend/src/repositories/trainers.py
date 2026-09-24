"""TrainerRepository: trainer profiles, their sign-in link and the trainer dashboard reads."""

from __future__ import annotations

from typing import Any

from core.database import Result

from .base import Repository, Statement

TRAINER_COLUMNS = (
    "t.id, t.user_id, t.name, t.phone, t.email, t.specialization, t.joining_date, t.status, t.created_at, t.updated_at"
)
_SELECT = (
    f"SELECT {TRAINER_COLUMNS}, "
    "(SELECT COUNT(*) FROM members m WHERE m.trainer_id = t.id AND m.status != 'INACTIVE') AS member_count, "
    "u.status AS login_status, u.last_login_at FROM trainers t LEFT JOIN users u ON u.id = t.user_id "
)


class TrainerRepository(Repository):
    async def list(self, status: str | None) -> list[dict[str, Any]]:
        if status:
            return await self.db.all(_SELECT + "WHERE t.status = ?1 ORDER BY t.name LIMIT 200", [status])
        return await self.db.all(_SELECT + "ORDER BY t.status, t.name LIMIT 200")

    async def get(self, trainer_id: int) -> dict[str, Any] | None:
        return await self.db.one(_SELECT + "WHERE t.id = ?1", [trainer_id])

    async def basic(self, trainer_id: int) -> dict[str, Any] | None:
        return await self.db.one("SELECT id, user_id, name, phone, email, status FROM trainers WHERE id = ?1", [trainer_id])

    async def insert(self, values: dict[str, Any], now: str) -> int:
        row = await self.db.one(
            "INSERT INTO trainers (name, phone, email, specialization, joining_date, status, created_at, updated_at) "
            "VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE', ?6, ?6) RETURNING id",
            [values["name"], values["phone"], values.get("email"), values.get("specialization"), values["joining_date"], now],
        )
        return row["id"]

    async def update(self, trainer_id: int, values: dict[str, Any], now: str) -> int:
        result = await self.db.run(
            "UPDATE trainers SET name = ?2, phone = ?3, email = ?4, specialization = ?5, "
            "joining_date = COALESCE(?6, joining_date), updated_at = ?7 WHERE id = ?1",
            [trainer_id, values["name"], values["phone"], values.get("email"), values.get("specialization"),
             values.get("joining_date"), now],
        )
        return result.changes

    async def set_status(self, trainer_id: int, status: str, now: str) -> int:
        result = await self.db.run("UPDATE trainers SET status = ?2, updated_at = ?3 WHERE id = ?1", [trainer_id, status, now])
        return result.changes

    def link_user_stmt(self, trainer_id: int, now: str) -> Statement:
        """Attach the user row inserted just before in the same batch (highest users.id)."""
        return (
            "UPDATE trainers SET user_id = (SELECT MAX(id) FROM users), updated_at = ?2 WHERE id = ?1 AND user_id IS NULL",
            [trainer_id, now],
        )

    async def dashboard(self, trainer_id: int, today: str, soon: str, week_start: str) -> list[Result]:
        return await self.db.batch(
            [
                (
                    "SELECT COUNT(*) AS assigned, COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active "
                    "FROM members WHERE trainer_id = ?1 AND status != 'INACTIVE'",
                    [trainer_id],
                ),
                (
                    "SELECT a.id, a.check_in, a.check_out, a.method, m.id AS member_id, m.name, m.member_code FROM attendance a "
                    "JOIN members m ON m.id = a.member_id WHERE a.attendance_date = ?2 AND m.trainer_id = ?1 "
                    "ORDER BY a.check_in DESC LIMIT 50",
                    [trainer_id, today],
                ),
                (
                    "SELECT COUNT(*) AS c FROM attendance a JOIN members m ON m.id = a.member_id "
                    "WHERE a.attendance_date >= ?2 AND m.trainer_id = ?1",
                    [trainer_id, week_start],
                ),
                ("SELECT COUNT(*) AS c FROM workout_plans WHERE trainer_id = ?1 AND status = 'ACTIVE'", [trainer_id]),
                (
                    "SELECT m.id, m.name, m.member_code, "
                    "(SELECT MAX(x.end_date) FROM memberships x WHERE x.member_id = m.id AND x.status != 'CANCELLED') AS expiry_date, "
                    "(SELECT MAX(b.recorded_at) FROM body_measurements b WHERE b.member_id = m.id) AS last_measured, "
                    "(SELECT COUNT(*) FROM workout_plans w WHERE w.member_id = m.id AND w.status = 'ACTIVE') AS workouts "
                    "FROM members m WHERE m.trainer_id = ?1 AND m.status = 'ACTIVE' ORDER BY m.name LIMIT 200",
                    [trainer_id],
                ),
            ]
        )
