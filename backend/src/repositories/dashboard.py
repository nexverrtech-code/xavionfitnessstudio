"""DashboardRepository: KPI and chart aggregates — few statements, one batch each, all
range-bounded on indexes so dashboard loads stay cheap in D1 rows read."""

from __future__ import annotations

from core.database import Result, Statement

from .base import Repository

_NO_LATER = (
    "NOT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = ms.member_id AND n.status != 'CANCELLED' "
    "AND n.end_date > ms.end_date)"
)


class DashboardRepository(Repository):
    async def summary(
        self, *, today: str, yesterday: str, soon: str, month_start: str, prev_month_start: str, prev_same_day: str,
        open_after: str,
    ) -> list[Result]:
        return await self.db.batch(
            [
                (
                    "SELECT COUNT(*) AS total, "
                    "COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active, "
                    "COALESCE(SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS expired, "
                    "COALESCE(SUM(CASE WHEN status = 'INACTIVE' THEN 1 ELSE 0 END), 0) AS inactive, "
                    "COALESCE(SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END), 0) AS suspended, "
                    "COALESCE(SUM(CASE WHEN joining_date >= ?1 THEN 1 ELSE 0 END), 0) AS joined_this_month FROM members",
                    [month_start],
                ),
                (
                    "SELECT COUNT(DISTINCT ms.member_id) AS c FROM memberships ms JOIN members m ON m.id = ms.member_id "
                    "WHERE ms.status IN ('ACTIVE', 'EXPIRING') AND ms.end_date BETWEEN ?1 AND ?2 AND m.status = 'ACTIVE' "
                    f"AND {_NO_LATER}",
                    [today, soon],
                ),
                (
                    # Members present (each counted once a day however many visits), visits, inside now.
                    "SELECT COUNT(DISTINCT CASE WHEN attendance_date = ?1 THEN member_id END) AS today, "
                    "COUNT(DISTINCT CASE WHEN attendance_date = ?2 THEN member_id END) AS yesterday, "
                    "COALESCE(SUM(CASE WHEN attendance_date = ?1 THEN 1 ELSE 0 END), 0) AS today_visits, "
                    "COUNT(DISTINCT CASE WHEN check_out IS NULL AND check_in > ?3 THEN member_id END) AS in_gym "
                    "FROM attendance WHERE attendance_date >= ?2 AND attendance_date <= ?1",
                    [today, yesterday, open_after],
                ),
                (
                    "SELECT COALESCE(SUM(CASE WHEN payment_date = ?1 THEN amount END), 0) AS today, "
                    "COALESCE(SUM(CASE WHEN payment_date >= ?2 THEN amount END), 0) AS month, "
                    "COALESCE(SUM(CASE WHEN payment_date >= ?2 THEN 1 ELSE 0 END), 0) AS month_count, "
                    "COALESCE(SUM(CASE WHEN payment_date < ?2 AND payment_date <= ?4 THEN amount END), 0) AS prev_period "
                    "FROM payments WHERE status IN ('PAID', 'REFUNDED') AND payment_date >= ?3 AND payment_date <= ?1",
                    [today, month_start, prev_month_start, prev_same_day],
                ),
                (
                    "SELECT COALESCE(SUM(CASE WHEN refund_date = ?1 THEN amount END), 0) AS today, "
                    "COALESCE(SUM(CASE WHEN refund_date >= ?2 THEN amount END), 0) AS month, "
                    "COALESCE(SUM(CASE WHEN refund_date < ?2 AND refund_date <= ?4 THEN amount END), 0) AS prev_period "
                    "FROM refunds WHERE refund_date >= ?3 AND refund_date <= ?1",
                    [today, month_start, prev_month_start, prev_same_day],
                ),
                ("SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS amount FROM payments WHERE status = 'PENDING'", []),
                (
                    "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE expense_date BETWEEN ?1 AND ?2",
                    [month_start, today],
                ),
                ("SELECT snapshot_date, db_bytes FROM storage_snapshots ORDER BY snapshot_date DESC LIMIT 1", []),
            ]
        )

    @staticmethod
    def _trend_statements(*, month_from: str, month_to: str, starts_to: str, day_from: str, day_to: str) -> list[Statement]:
        """Revenue, refunds, expenses, new memberships and attendance for [from, to) date ranges:
        dates on or after month_from (by month) and day_from (by day), before the matching *_to."""
        return [
            (
                "SELECT substr(payment_date, 1, 7) AS month, COALESCE(SUM(amount), 0) AS revenue, COUNT(*) AS payments "
                "FROM payments WHERE status IN ('PAID', 'REFUNDED') AND payment_date >= ?1 AND payment_date < ?2 GROUP BY month",
                [month_from, month_to],
            ),
            (
                "SELECT substr(refund_date, 1, 7) AS month, COALESCE(SUM(amount), 0) AS refunds FROM refunds "
                "WHERE refund_date >= ?1 AND refund_date < ?2 GROUP BY month",
                [month_from, month_to],
            ),
            (
                "SELECT substr(expense_date, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total FROM expenses "
                "WHERE expense_date >= ?1 AND expense_date < ?2 GROUP BY month",
                [month_from, month_to],
            ),
            (
                # Memberships that started in the window necessarily end after it began, so the
                # (status, end_date) index bounds the scan.
                "SELECT substr(ms.start_date, 1, 7) AS month, COUNT(*) AS total, "
                "COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = ms.member_id "
                "AND x.id < ms.id AND x.status != 'CANCELLED') THEN 1 ELSE 0 END), 0) AS renewals "
                "FROM memberships ms WHERE ms.status IN ('ACTIVE', 'EXPIRING', 'EXPIRED') AND ms.end_date >= ?1 "
                "AND ms.start_date >= ?1 AND ms.start_date < ?2 GROUP BY month",
                [month_from, starts_to],
            ),
            (
                "SELECT attendance_date AS date, COUNT(DISTINCT member_id) AS members, COUNT(*) AS visits FROM attendance "
                "WHERE attendance_date >= ?1 AND attendance_date < ?2 GROUP BY attendance_date",
                [day_from, day_to],
            ),
        ]

    async def chart_history(self, *, first_month: str, month_start: str, attendance_from: str, today: str) -> list[Result]:
        """Months before this one and days before today."""
        return await self.db.batch(
            self._trend_statements(month_from=first_month, month_to=month_start, starts_to=month_start,
                                   day_from=attendance_from, day_to=today)
        )

    async def chart_live(self, *, month_start: str, today: str, tomorrow: str) -> list[Result]:
        """This month and today, plus this month's payment methods and today's plan mix."""
        return await self.db.batch(
            [
                *self._trend_statements(month_from=month_start, month_to="9999-12-31", starts_to=tomorrow,
                                        day_from=today, day_to=tomorrow),
                (
                    "SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM payments "
                    "WHERE status IN ('PAID', 'REFUNDED') AND payment_date >= ?1 GROUP BY payment_method ORDER BY amount DESC",
                    [month_start],
                ),
                (
                    "SELECT p.name AS plan, COUNT(*) AS members FROM memberships ms JOIN membership_plans p ON p.id = ms.plan_id "
                    "WHERE ms.status IN ('ACTIVE', 'EXPIRING') AND ms.end_date >= ?1 AND ms.start_date <= ?1 "
                    "GROUP BY p.id ORDER BY members DESC LIMIT 8",
                    [today],
                ),
            ]
        )

    async def cached(self, key: str) -> str | None:
        return await self.db.value("SELECT value FROM dashboard_cache WHERE key = ?1", [key])

    async def cache(self, key: str, value: str, now: str) -> None:
        await self.db.batch(
            [
                ("INSERT OR REPLACE INTO dashboard_cache (key, value, created_at) VALUES (?1, ?2, ?3)", [key, value, now]),
                ("DELETE FROM dashboard_cache WHERE created_at < datetime(?1, '-2 days')", [now]),
            ]
        )

    async def activity(self) -> list[Result]:
        return await self.db.batch(
            [
                ("SELECT id, member_code, name, created_at FROM members ORDER BY id DESC LIMIT 6", []),
                (
                    # "+" keeps SQLite on the rowid (newest first, stops after 6) instead of sorting every
                    # paid payment found through the status index.
                    "SELECT p.id, p.amount, p.payment_method, p.verified_at, m.id AS member_id, m.name FROM payments p "
                    "JOIN members m ON m.id = p.member_id WHERE +p.status IN ('PAID', 'REFUNDED') ORDER BY p.id DESC LIMIT 6",
                    [],
                ),
                (
                    "SELECT ms.id, ms.created_at, pl.name AS plan, m.id AS member_id, m.name, "
                    "EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = ms.member_id AND x.id < ms.id "
                    "AND x.status != 'CANCELLED') AS is_renewal "
                    "FROM memberships ms JOIN membership_plans pl ON pl.id = ms.plan_id JOIN members m ON m.id = ms.member_id "
                    # "+" keeps SQLite on the rowid (newest first) instead of sorting the status index.
                    "WHERE +ms.status != 'CANCELLED' ORDER BY ms.id DESC LIMIT 6",
                    [],
                ),
                (
                    "SELECT a.id, a.check_in, a.check_out, a.method, m.id AS member_id, m.name FROM attendance a "
                    "JOIN members m ON m.id = a.member_id ORDER BY a.id DESC LIMIT 6",
                    [],
                ),
                ("SELECT id, category, amount, created_at FROM expenses ORDER BY id DESC LIMIT 4", []),
                (
                    "SELECT p.id, p.amount, p.created_at, m.id AS member_id, m.name FROM payments p JOIN members m ON m.id = p.member_id "
                    "WHERE p.status = 'PENDING' ORDER BY p.id DESC LIMIT 4",
                    [],
                ),
                (
                    "SELECT r.id, r.amount, r.created_at, m.id AS member_id, m.name FROM refunds r JOIN payments p ON p.id = r.payment_id "
                    "JOIN members m ON m.id = p.member_id ORDER BY r.id DESC LIMIT 3",
                    [],
                ),
            ]
        )
