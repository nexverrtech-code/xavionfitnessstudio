"""ReportRepository: on-demand report data. Aggregates are computed in SQL; detail rows are
returned as JSON text straight from D1 (see Database.rows_json) and the browser renders the
CSV / PDF file — nothing is generated or stored on the server."""

from __future__ import annotations

from core.database import JsonRows, Result

from .base import Repository

ISO = "replace({col}, ' ', 'T') || 'Z'"  # UTC timestamps as ISO-8601 for the browser


def _iso(col: str) -> str:
    return f"CASE WHEN {col} IS NULL THEN NULL ELSE {ISO.format(col=col)} END"


class ReportRepository(Repository):
    # -- members ---------------------------------------------------------------------------------
    async def member_summary(self, start: str, end: str) -> Result:
        return await self.db.run(
            "SELECT COUNT(*) AS total, "
            "COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active, "
            "COALESCE(SUM(CASE WHEN status = 'INACTIVE' THEN 1 ELSE 0 END), 0) AS inactive, "
            "COALESCE(SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS expired, "
            "COALESCE(SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END), 0) AS suspended, "
            "COALESCE(SUM(CASE WHEN joining_date BETWEEN ?1 AND ?2 THEN 1 ELSE 0 END), 0) AS new_members FROM members",
            [start, end],
        )

    async def member_rows(self, start: str, end: str, cap: int) -> JsonRows:
        return await self.db.rows_json(
            "SELECT m.member_code, m.name, m.phone, m.email, m.gender, m.joining_date, m.status, t.name AS trainer, "
            "(SELECT MAX(x.end_date) FROM memberships x WHERE x.member_id = m.id AND x.status != 'CANCELLED') AS expiry_date "
            "FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id WHERE m.joining_date BETWEEN ?1 AND ?2 "
            "ORDER BY m.id LIMIT ?3",
            [start, end, cap],
        )

    # -- memberships ------------------------------------------------------------------------------
    async def membership_by_plan(self, start: str, end: str, today: str) -> Result:
        return await self.db.run(
            "SELECT p.id, p.name AS plan, p.duration_days, p.price, "
            "COALESCE(SUM(CASE WHEN ms.status != 'CANCELLED' AND ms.start_date <= ?3 AND ms.end_date >= ?3 THEN 1 ELSE 0 END), 0) AS active, "
            "COALESCE(SUM(CASE WHEN ms.status != 'CANCELLED' AND ms.end_date < ?3 AND ms.end_date BETWEEN ?1 AND ?2 THEN 1 ELSE 0 END), 0) AS expired, "
            "COALESCE(SUM(CASE WHEN ms.status != 'CANCELLED' AND ms.start_date BETWEEN ?1 AND ?2 AND EXISTS (SELECT 1 FROM memberships x "
            " WHERE x.member_id = ms.member_id AND x.id < ms.id AND x.status != 'CANCELLED') THEN 1 ELSE 0 END), 0) AS renewals, "
            "COALESCE(SUM(CASE WHEN ms.status != 'CANCELLED' AND ms.start_date BETWEEN ?1 AND ?2 THEN 1 ELSE 0 END), 0) AS started, "
            "COALESCE(SUM(CASE WHEN ms.status != 'CANCELLED' AND ms.start_date BETWEEN ?1 AND ?2 THEN ms.amount END), 0) AS amount "
            "FROM membership_plans p LEFT JOIN memberships ms ON ms.plan_id = p.id GROUP BY p.id ORDER BY p.duration_days, p.name",
            [start, end, today],
        )

    async def membership_rows(self, start: str, end: str, cap: int) -> JsonRows:
        return await self.db.rows_json(
            "SELECT m.member_code, m.name, p.name AS plan, ms.start_date, ms.end_date, ms.amount, ms.status "
            "FROM memberships ms JOIN members m ON m.id = ms.member_id JOIN membership_plans p ON p.id = ms.plan_id "
            "WHERE ms.start_date BETWEEN ?1 AND ?2 ORDER BY ms.start_date, ms.id LIMIT ?3",
            [start, end, cap],
        )

    # -- payments ----------------------------------------------------------------------------------
    async def payment_by_method(self, start: str, end: str) -> list[Result]:
        return await self.db.batch(
            [
                (
                    "SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM payments "
                    "WHERE status IN ('PAID', 'REFUNDED') AND payment_date BETWEEN ?1 AND ?2 GROUP BY payment_method",
                    [start, end],
                ),
                (
                    "SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM refunds WHERE refund_date BETWEEN ?1 AND ?2",
                    [start, end],
                ),
                (
                    "SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM payments "
                    "WHERE payment_date BETWEEN ?1 AND ?2 GROUP BY status",
                    [start, end],
                ),
            ]
        )

    async def payment_rows(self, start: str, end: str, cap: int) -> JsonRows:
        return await self.db.rows_json(
            "SELECT p.payment_number, p.payment_date, m.member_code, m.name, pl.name AS plan, p.payment_method, "
            "p.transaction_reference, p.amount, p.status, r.amount AS refund_amount, v.name AS verified_by, "
            f"{_iso('p.verified_at')} AS verified_at FROM payments p JOIN members m ON m.id = p.member_id "
            "JOIN membership_plans pl ON pl.id = p.plan_id LEFT JOIN users v ON v.id = p.verified_by "
            "LEFT JOIN refunds r ON r.payment_id = p.id WHERE p.payment_date BETWEEN ?1 AND ?2 "
            "ORDER BY p.payment_date, p.id LIMIT ?3",
            [start, end, cap],
        )

    # -- attendance --------------------------------------------------------------------------------
    async def attendance_daily(self, start: str, end: str) -> Result:
        return await self.db.run(
            "SELECT attendance_date AS date, COUNT(*) AS visits, COUNT(DISTINCT member_id) AS members FROM attendance "
            "WHERE attendance_date BETWEEN ?1 AND ?2 GROUP BY attendance_date ORDER BY attendance_date",
            [start, end],
        )

    async def attendance_rows(self, start: str, end: str, cap: int) -> JsonRows:
        return await self.db.rows_json(
            f"SELECT a.attendance_date, m.member_code, m.name, {_iso('a.check_in')} AS check_in, "
            f"{_iso('a.check_out')} AS check_out, a.method FROM attendance a JOIN members m ON m.id = a.member_id "
            "WHERE a.attendance_date BETWEEN ?1 AND ?2 ORDER BY a.attendance_date, a.check_in LIMIT ?3",
            [start, end, cap],
        )

    # -- expenses ----------------------------------------------------------------------------------
    async def expense_by_category(self, start: str, end: str) -> Result:
        return await self.db.run(
            "SELECT category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM expenses "
            "WHERE expense_date BETWEEN ?1 AND ?2 GROUP BY category ORDER BY amount DESC",
            [start, end],
        )

    async def expense_rows(self, start: str, end: str, cap: int) -> JsonRows:
        return await self.db.rows_json(
            "SELECT e.expense_date, e.category, e.description, e.amount, u.name AS recorded_by FROM expenses e "
            "LEFT JOIN users u ON u.id = e.created_by WHERE e.expense_date BETWEEN ?1 AND ?2 "
            "ORDER BY e.expense_date, e.id LIMIT ?3",
            [start, end, cap],
        )
