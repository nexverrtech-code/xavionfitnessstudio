"""AttendanceRepository: check-ins (QR or manual), the daily log and attendance history."""

from __future__ import annotations

from typing import Any

from core.database import Result

from .base import Repository, count_of

# Member + membership validity for a check-in, in one query. ?1 = today, ?2 = today minus the
# configured grace days; the lookup column's value is bound as ?3.
_VALIDITY_SQL = (
    "SELECT m.id, m.member_code, m.name, m.status, m.trainer_id, "
    "(SELECT MAX(ms.end_date) FROM memberships ms WHERE ms.member_id = m.id AND ms.status != 'CANCELLED' "
    " AND ms.start_date <= ?1 AND ms.end_date >= ?2) AS valid_until, "
    "(SELECT MIN(ms.start_date) FROM memberships ms WHERE ms.member_id = m.id AND ms.status != 'CANCELLED' "
    " AND ms.start_date > ?1) AS next_start, "
    "(SELECT MAX(ms.end_date) FROM memberships ms WHERE ms.member_id = m.id AND ms.status != 'CANCELLED') AS expiry_date, "
    "(SELECT p.name FROM memberships ms JOIN membership_plans p ON p.id = ms.plan_id WHERE ms.member_id = m.id "
    " AND ms.status != 'CANCELLED' ORDER BY ms.end_date DESC LIMIT 1) AS plan_name "
    "FROM members m WHERE "
)
_LOOKUPS = {"id": "m.id = ?3", "code": "m.member_code = ?3", "phone": "m.phone = ?3", "qr": "m.qr_token = ?3"}


class AttendanceRepository(Repository):
    async def members_for_check_in(self, by: str, value: Any, today: str, grace_start: str) -> list[dict[str, Any]]:
        return await self.db.all(f"{_VALIDITY_SQL}{_LOOKUPS[by]} LIMIT 5", [today, grace_start, value])

    async def check_in(self, member_id: int, today: str, now: str, method: str) -> list[Result]:
        """Idempotent: the UNIQUE (member_id, attendance_date) index turns repeat scans into no-ops."""
        return await self.db.batch(
            [
                (
                    "INSERT INTO attendance (member_id, attendance_date, check_in, method, created_at) VALUES (?1, ?2, ?3, ?4, ?3) "
                    "ON CONFLICT (member_id, attendance_date) DO NOTHING RETURNING id, check_in, check_out",
                    [member_id, today, now, method],
                ),
                (
                    "SELECT id, check_in, check_out FROM attendance WHERE member_id = ?1 AND attendance_date = ?2",
                    [member_id, today],
                ),
            ]
        )

    async def check_out(self, attendance_id: int, now: str) -> bool:
        result = await self.db.run(
            "UPDATE attendance SET check_out = ?2 WHERE id = ?1 AND check_out IS NULL RETURNING check_out", [attendance_id, now]
        )
        return bool(result.rows)

    async def day_log(self, day: str, trainer_id: int | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int, int]:
        params: list[Any] = [day]
        scope = ""
        if trainer_id:
            params.append(trainer_id)
            scope = " AND m.trainer_id = ?2"
        n = len(params)
        rows, total = await self.db.batch(
            [
                (
                    "SELECT a.id, a.member_id, a.attendance_date, a.check_in, a.check_out, a.method, m.name, m.member_code, m.phone "
                    f"FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.attendance_date = ?1{scope} "
                    f"ORDER BY a.check_in DESC LIMIT ?{n + 1} OFFSET ?{n + 2}",
                    [*params, limit, offset],
                ),
                (
                    "SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN a.check_out IS NOT NULL THEN 1 ELSE 0 END), 0) AS checked_out "
                    f"FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.attendance_date = ?1{scope}",
                    params,
                ),
            ]
        )
        first = total.first or {}
        return rows.rows, count_of(total), int(first.get("checked_out") or 0)

    async def member_history(self, member_id: int, start: str, end: str) -> list[dict[str, Any]]:
        return await self.db.all(
            "SELECT id, attendance_date, check_in, check_out, method FROM attendance "
            "WHERE member_id = ?1 AND attendance_date BETWEEN ?2 AND ?3 ORDER BY attendance_date DESC",
            [member_id, start, end],
        )

    async def daily_counts(self, start: str, end: str) -> list[dict[str, Any]]:
        return await self.db.all(
            "SELECT attendance_date AS date, COUNT(*) AS visits FROM attendance "
            "WHERE attendance_date BETWEEN ?1 AND ?2 GROUP BY attendance_date ORDER BY attendance_date",
            [start, end],
        )

    async def get(self, attendance_id: int) -> dict[str, Any] | None:
        return await self.db.one(
            "SELECT a.id, a.member_id, a.attendance_date, m.trainer_id FROM attendance a JOIN members m ON m.id = a.member_id "
            "WHERE a.id = ?1",
            [attendance_id],
        )

    async def delete(self, attendance_id: int) -> int:
        return (await self.db.run("DELETE FROM attendance WHERE id = ?1", [attendance_id])).changes
