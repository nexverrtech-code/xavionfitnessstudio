"""PaymentRepository: payments and recorded refunds.

Payment numbers (PAY-2026-000001) are assigned inside the INSERT from the highest number of
the same year — an indexed range lookup on the UNIQUE payment_number column. D1 executes
writes one at a time, so numbers never collide (and the UNIQUE index would reject it anyway).
"""

from __future__ import annotations

from typing import Any

from .base import Binder, Repository, Statement, count_of, where

PAYMENT_COLUMNS = (
    "p.id, p.payment_number, p.member_id, p.membership_id, p.plan_id, p.amount, p.payment_method, "
    "p.transaction_reference, p.status, p.payment_date, p.verified_by, p.verified_at, p.notes, p.created_by, "
    "p.created_at, p.updated_at"
)
_RETURNING = PAYMENT_COLUMNS.replace("p.", "")
DETAIL_COLUMNS = (
    f"{PAYMENT_COLUMNS}, m.name AS member_name, m.member_code, m.phone AS member_phone, m.user_id AS member_user_id, "
    "pl.name AS plan_name, pl.duration_days, ms.start_date, ms.end_date, v.name AS verified_by_name, "
    "r.amount AS refund_amount, r.refund_method, r.refund_reference, r.refund_reason, r.refund_date"
)
DETAIL_JOINS = (
    "FROM payments p JOIN members m ON m.id = p.member_id JOIN membership_plans pl ON pl.id = p.plan_id "
    "LEFT JOIN memberships ms ON ms.id = p.membership_id LEFT JOIN users v ON v.id = p.verified_by "
    "LEFT JOIN refunds r ON r.payment_id = p.id"
)


def _number_sql(year_param: str) -> str:
    return (
        f"'PAY-' || {year_param} || '-' || printf('%06d', COALESCE((SELECT CAST(substr(x.payment_number, 10) AS INTEGER) "
        f"FROM payments x WHERE x.payment_number >= 'PAY-' || {year_param} || '-' "
        f"AND x.payment_number < 'PAY-' || {year_param} || '.' ORDER BY x.payment_number DESC LIMIT 1), 0) + 1)"
    )


class PaymentRepository(Repository):
    # -- writes (statement builders, combined into one batch by PaymentService) ------------------
    def insert_stmt(
        self, *, year: str, member_id: int, plan_id: int, amount: int, method: str, reference: str | None,
        status: str, payment_date: str, notes: str | None, idempotency_key: str | None, created_by: int | None,
        now: str, link_latest_membership: bool, verified_by: int | None,
    ) -> Statement:
        membership = "(SELECT MAX(id) FROM memberships WHERE member_id = ?2)" if link_latest_membership else "NULL"
        verified_at = "?12" if status == "PAID" else "NULL"
        return (
            "INSERT INTO payments (payment_number, member_id, membership_id, plan_id, amount, payment_method, "
            "transaction_reference, status, payment_date, verified_by, verified_at, notes, idempotency_key, created_by, "
            f"created_at, updated_at) VALUES ({_number_sql('?1')}, ?2, {membership}, ?3, ?4, ?5, ?6, ?7, ?8, ?9, "
            f"{verified_at}, ?10, ?11, ?13, ?12, ?12) RETURNING {_RETURNING}",
            [year, member_id, plan_id, amount, method, reference, status, payment_date, verified_by, notes,
             idempotency_key, now, created_by],
        )

    def approve_stmt(self, payment_id: int, member_id: int, verified_by: int | None, now: str) -> Statement:
        return (
            "UPDATE payments SET status = 'PAID', membership_id = (SELECT MAX(id) FROM memberships WHERE member_id = ?2), "
            "verified_by = ?3, verified_at = ?4, updated_at = ?4 WHERE id = ?1 AND status = 'PENDING'",
            [payment_id, member_id, verified_by, now],
        )

    async def close_pending(self, payment_id: int, *, status: str, reason: str, actor: int | None, now: str) -> int:
        result = await self.db.run(
            "UPDATE payments SET status = ?2, notes = ?3, verified_by = ?4, verified_at = ?5, updated_at = ?5 "
            "WHERE id = ?1 AND status = 'PENDING'",
            [payment_id, status, reason, actor, now],
        )
        return result.changes

    def refund_insert_stmt(
        self, *, payment_id: int, amount: int, method: str, reference: str | None, reason: str, refund_date: str,
        created_by: int | None, now: str,
    ) -> Statement:
        return (
            "INSERT INTO refunds (payment_id, amount, refund_method, refund_reference, refund_reason, refund_date, "
            "created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            [payment_id, amount, method, reference, reason, refund_date, created_by, now],
        )

    def mark_refunded_stmt(self, payment_id: int, now: str) -> Statement:
        return (
            "UPDATE payments SET status = 'REFUNDED', updated_at = ?2 WHERE id = ?1 AND status = 'PAID'",
            [payment_id, now],
        )

    # -- reads -------------------------------------------------------------------------------------
    async def get(self, payment_id: int) -> dict[str, Any] | None:
        return await self.db.one(f"SELECT {DETAIL_COLUMNS} {DETAIL_JOINS} WHERE p.id = ?1", [payment_id])

    def get_stmt(self, payment_id: int) -> Statement:
        return (f"SELECT {DETAIL_COLUMNS} {DETAIL_JOINS} WHERE p.id = ?1", [payment_id])

    async def by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        return await self.db.one(f"SELECT {DETAIL_COLUMNS} {DETAIL_JOINS} WHERE p.idempotency_key = ?1", [key])

    async def reference_in_use(self, reference: str) -> bool:
        return bool(
            await self.db.value(
                "SELECT 1 FROM payments WHERE transaction_reference = ?1 AND payment_method IN ('UPI', 'BANK_TRANSFER') "
                "AND status IN ('PENDING', 'PAID', 'REFUNDED') LIMIT 1",
                [reference],
            )
        )

    async def pending_for_member(self, member_id: int) -> dict[str, Any] | None:
        return await self.db.one(
            f"SELECT {DETAIL_COLUMNS} {DETAIL_JOINS} WHERE p.member_id = ?1 AND p.status = 'PENDING'", [member_id]
        )

    async def list(
        self, *, start: str | None, end: str | None, status: str | None, method: str | None, member_id: int | None,
        q: str | None, member_code: str | None, limit: int, offset: int,
    ) -> tuple[list[dict[str, Any]], int, int]:
        bind = Binder()
        clauses: list[str] = []
        if start:
            clauses.append(f"p.payment_date >= {bind(start)}")
        if end:
            clauses.append(f"p.payment_date <= {bind(end)}")
        if status:
            clauses.append(f"p.status = {bind(status)}")
        if method:
            clauses.append(f"p.payment_method = {bind(method)}")
        if member_id:
            clauses.append(f"p.member_id = {bind(member_id)}")
        if q:
            text = q.strip()
            options = [
                f"p.payment_number = {bind(text.upper())}",
                f"p.transaction_reference = {bind(text.replace(' ', '').upper())}",
                f"(m.name >= {bind(text)} AND m.name < {bind(text + chr(0x10FFFF))})",
            ]
            if member_code:
                options.append(f"m.member_code = {bind(member_code)}")
            clauses.append("(" + " OR ".join(options) + ")")
        condition = where(clauses)
        count_params = list(bind.params)
        rows, totals = await self.db.batch(
            [
                (
                    f"SELECT {DETAIL_COLUMNS} {DETAIL_JOINS} {condition} ORDER BY p.payment_date DESC, p.id DESC "
                    f"LIMIT {bind(limit)} OFFSET {bind(offset)}",
                    bind.params,
                ),
                (
                    "SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN p.status IN ('PAID', 'REFUNDED') "
                    "THEN p.amount - COALESCE(r.amount, 0) END), 0) AS paid_total "
                    f"FROM payments p JOIN members m ON m.id = p.member_id LEFT JOIN refunds r ON r.payment_id = p.id {condition}",
                    count_params,
                ),
            ]
        )
        first = totals.first or {}
        return rows.rows, count_of(totals), int(first.get("paid_total") or 0)

    async def pending(self, limit: int, offset: int) -> tuple[list[dict[str, Any]], int, int]:
        rows, total = await self.db.batch(
            [
                (
                    f"SELECT {DETAIL_COLUMNS} {DETAIL_JOINS} WHERE p.status = 'PENDING' ORDER BY p.created_at ASC LIMIT ?1 OFFSET ?2",
                    [limit, offset],
                ),
                ("SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS amount FROM payments WHERE status = 'PENDING'", []),
            ]
        )
        first = total.first or {}
        return rows.rows, count_of(total), int(first.get("amount") or 0)

    async def pending_count(self) -> int:
        return await self.db.value("SELECT COUNT(*) FROM payments WHERE status = 'PENDING'", default=0)

    async def summary(self, today: str, week_start: str, month_start: str) -> dict[str, Any]:
        """Money collected (PAID, plus payments later refunded) minus refunds recorded, per period."""
        low = min(week_start, month_start)
        collected, refunded = await self.db.batch(
            [
                (
                    "SELECT COALESCE(SUM(CASE WHEN payment_date = ?1 THEN amount END), 0) AS today, "
                    "COALESCE(SUM(CASE WHEN payment_date >= ?2 THEN amount END), 0) AS week, "
                    "COALESCE(SUM(CASE WHEN payment_date >= ?3 THEN amount END), 0) AS month, "
                    "COALESCE(SUM(CASE WHEN payment_date >= ?3 THEN 1 ELSE 0 END), 0) AS month_count "
                    "FROM payments WHERE status IN ('PAID', 'REFUNDED') AND payment_date >= ?4 AND payment_date <= ?1",
                    [today, week_start, month_start, low],
                ),
                (
                    "SELECT COALESCE(SUM(CASE WHEN refund_date = ?1 THEN amount END), 0) AS today, "
                    "COALESCE(SUM(CASE WHEN refund_date >= ?2 THEN amount END), 0) AS week, "
                    "COALESCE(SUM(CASE WHEN refund_date >= ?3 THEN amount END), 0) AS month "
                    "FROM refunds WHERE refund_date >= ?4 AND refund_date <= ?1",
                    [today, week_start, month_start, low],
                ),
            ]
        )
        gross, back = collected.first or {}, refunded.first or {}
        return {
            "today": int(gross.get("today") or 0) - int(back.get("today") or 0),
            "week": int(gross.get("week") or 0) - int(back.get("week") or 0),
            "month": int(gross.get("month") or 0) - int(back.get("month") or 0),
            "month_count": int(gross.get("month_count") or 0),
            "month_refunds": int(back.get("month") or 0),
        }
