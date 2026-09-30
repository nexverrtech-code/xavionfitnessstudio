"""AttendanceRepository: visits (check-in and check-out, several a day), the daily log and history."""

from __future__ import annotations

import json
from typing import Any

from core.database import Result

from .base import Repository

# The member's latest visit since yesterday (a late-night visit may end after midnight) and the
# number of visits started today. Both read a handful of index entries.
_LAST_VISIT = (
    "(SELECT json_array(a.id, a.attendance_date, a.check_in, a.check_out) FROM attendance a "
    "WHERE a.member_id = {member} AND a.attendance_date >= {since} ORDER BY a.attendance_date DESC, a.check_in DESC LIMIT 1)"
)
_VISITS_TODAY = "(SELECT COUNT(*) FROM attendance a WHERE a.member_id = {member} AND a.attendance_date = {today})"

# Member + membership validity + where the member's attendance stands, in one query.
# ?1 = today, ?2 = today minus the grace days, ?3 = the lookup value, ?4 = yesterday.
_VALIDITY_SQL = (
    "SELECT m.id, m.member_code, m.name, m.status, m.trainer_id, "
    "(SELECT MAX(ms.end_date) FROM memberships ms WHERE ms.member_id = m.id AND ms.status != 'CANCELLED' "
    " AND ms.start_date <= ?1 AND ms.end_date >= ?2) AS valid_until, "
    "(SELECT MIN(ms.start_date) FROM memberships ms WHERE ms.member_id = m.id AND ms.status != 'CANCELLED' "
    " AND ms.start_date > ?1) AS next_start, "
    "(SELECT MAX(ms.end_date) FROM memberships ms WHERE ms.member_id = m.id AND ms.status != 'CANCELLED') AS expiry_date, "
    "(SELECT p.name FROM memberships ms JOIN membership_plans p ON p.id = ms.plan_id WHERE ms.member_id = m.id "
    " AND ms.status != 'CANCELLED' ORDER BY ms.end_date DESC LIMIT 1) AS plan_name, "
    f"{_LAST_VISIT.format(member='m.id', since='?4')} AS last_visit, "
    f"{_VISITS_TODAY.format(member='m.id', today='?1')} AS visits_today "
    "FROM members m WHERE "
)
_LOOKUPS = {"id": "m.id = ?3", "code": "m.member_code = ?3", "phone": "m.phone = ?3", "qr": "m.qr_token = ?3"}
_VISIT_KEYS = ("id", "attendance_date", "check_in", "check_out")


def visit_from_json(raw: str | None) -> dict[str, Any] | None:
    return dict(zip(_VISIT_KEYS, json.loads(raw))) if raw else None


def visits_from_json(raw: str | None) -> list[dict[str, Any]]:
    """``json_group_array`` order is unspecified: visits come back sorted by check-in time."""
    items = [dict(zip(("id", "check_in", "check_out", "method"), v)) for v in json.loads(raw or "[]")]
    return sorted(items, key=lambda v: v["check_in"])


class AttendanceRepository(Repository):
    async def members_for_check_in(self, by: str, value: Any, today: str, grace_start: str, yesterday: str) -> list[dict[str, Any]]:
        return await self.db.all(f"{_VALIDITY_SQL}{_LOOKUPS[by]} LIMIT 5", [today, grace_start, value, yesterday])

    async def start_visit(self, member_id: int, *, today: str, yesterday: str, now: str, method: str,
                          recent_after: str, open_after: str, daily_limit: int) -> list[Result]:
        """Race-safe check-in: one atomic statement inserts the visit only when the member is not
        inside an open visit (started after ``open_after``), has not scanned within the cooldown
        (a visit started or ended after ``recent_after``) and is under the daily limit. Two desks
        scanning the same member at once therefore record one visit. The latest visit is read back
        in the same round trip."""
        return await self.db.batch(
            [
                (
                    "INSERT INTO attendance (member_id, attendance_date, check_in, method, created_at) "
                    "SELECT ?1, ?2, ?3, ?4, ?3 WHERE NOT EXISTS ("
                    "SELECT 1 FROM attendance WHERE member_id = ?1 AND attendance_date >= ?5 "
                    "AND (check_in > ?6 OR check_out > ?6 OR (check_out IS NULL AND check_in > ?7))) "
                    "AND (SELECT COUNT(*) FROM attendance WHERE member_id = ?1 AND attendance_date = ?2) < ?8 "
                    "RETURNING id, check_in",
                    [member_id, today, now, method, yesterday, recent_after, open_after, daily_limit],
                ),
                self.latest_stmt(member_id, today, yesterday),
            ]
        )

    def latest_stmt(self, member_id: int, today: str, yesterday: str) -> tuple[str, list[Any]]:
        return (
            f"SELECT {_LAST_VISIT.format(member='?1', since='?2')} AS last_visit, "
            f"{_VISITS_TODAY.format(member='?1', today='?3')} AS visits_today",
            [member_id, yesterday, today],
        )

    async def latest(self, member_id: int, today: str, yesterday: str) -> dict[str, Any]:
        sql, params = self.latest_stmt(member_id, today, yesterday)
        return await self.db.one(sql, params) or {}

    async def end_visit(self, visit_id: int, now: str) -> dict[str, Any] | None:
        """Check-out; ``check_out IS NULL`` makes a second (racing) check-out a no-op."""
        return await self.db.one(
            "UPDATE attendance SET check_out = ?2 WHERE id = ?1 AND check_out IS NULL AND check_in <= ?2 "
            "RETURNING check_in, check_out",
            [visit_id, now],
        )

    async def day_log(self, day: str, *, trainer_id: int | None, open_after: str, in_gym_only: bool,
                      limit: int, offset: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """One row per member (their visits nested, newest activity first) plus the day's totals."""
        params: list[Any] = [day, open_after]
        join = scope = ""
        if trainer_id:
            params.append(trainer_id)
            join, scope = " JOIN members m ON m.id = a.member_id", " AND m.trainer_id = ?3"
        n = len(params)
        in_gym = "SUM(CASE WHEN a.check_out IS NULL AND a.check_in > ?2 THEN 1 ELSE 0 END)"
        having = f" HAVING {in_gym} > 0" if in_gym_only else ""
        rows, totals = await self.db.batch(
            [
                (
                    "SELECT a.member_id, m.name, m.member_code, m.phone, COUNT(*) AS visit_count, MAX(a.check_in) AS last_in, "
                    f"{in_gym} AS open_visits, json_group_array(json_array(a.id, a.check_in, a.check_out, a.method)) AS visits "
                    f"FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.attendance_date = ?1{scope} "
                    f"GROUP BY a.member_id{having} ORDER BY last_in DESC, a.member_id DESC LIMIT ?{n + 1} OFFSET ?{n + 2}",
                    [*params, limit, offset],
                ),
                (
                    "SELECT COUNT(DISTINCT a.member_id) AS members, COUNT(*) AS visits, "
                    "COUNT(DISTINCT CASE WHEN a.check_out IS NULL AND a.check_in > ?2 THEN a.member_id END) AS in_gym, "
                    "COALESCE(SUM(CASE WHEN a.check_out IS NOT NULL THEN 1 ELSE 0 END), 0) AS checked_out "
                    f"FROM attendance a{join} WHERE a.attendance_date = ?1{scope}",
                    params,
                ),
            ]
        )
        return rows.rows, totals.first or {}

    async def member_history(self, member_id: int, start: str, end: str) -> list[dict[str, Any]]:
        return await self.db.all(
            "SELECT id, attendance_date, check_in, check_out, method FROM attendance "
            "WHERE member_id = ?1 AND attendance_date BETWEEN ?2 AND ?3 ORDER BY attendance_date DESC, check_in DESC",
            [member_id, start, end],
        )

    async def daily_counts(self, start: str, end: str) -> list[dict[str, Any]]:
        return await self.db.all(
            "SELECT attendance_date AS date, COUNT(DISTINCT member_id) AS members, COUNT(*) AS visits FROM attendance "
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
