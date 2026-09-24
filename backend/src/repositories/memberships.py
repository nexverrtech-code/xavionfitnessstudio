"""MembershipRepository: memberships are created only when a payment is confirmed.

Start / end dates are computed inside SQL at activation time, so two confirmations can never
overlap or extend a membership twice:

    start = chosen start date, or the day after the member's latest membership ends if that
            is today or later (renewing early never loses days), otherwise today
    end   = start + duration_days - 1   (inclusive)
"""

from __future__ import annotations

from typing import Any

from .base import Binder, Repository, Statement, count_of, where

MEMBERSHIP_COLUMNS = "ms.id, ms.member_id, ms.plan_id, ms.start_date, ms.end_date, ms.amount, ms.status, ms.created_at"
PAID_STATES = "('ACTIVE', 'EXPIRING', 'EXPIRED')"


def _start_sql(override: str, today: str, member: str) -> str:
    return (
        f"COALESCE({override}, MAX({today}, COALESCE((SELECT date(MAX(x.end_date), '+1 day') FROM memberships x "
        f"WHERE x.member_id = {member} AND x.status != 'CANCELLED'), {today})))"
    )


class MembershipRepository(Repository):
    def insert_stmt(
        self, *, member_id: int, plan_id: int, amount: int, start_override: str | None, today: str,
        created_by: int | None, now: str, only_if_pending_payment: int | None = None,
    ) -> Statement:
        """Insert the membership for a confirmed payment. With ``only_if_pending_payment`` the row
        is created only while that payment is still PENDING (idempotent approval)."""
        guard = ""
        params: list[Any] = [start_override, today, member_id, plan_id, amount, created_by, now]
        if only_if_pending_payment is not None:
            params.append(only_if_pending_payment)
            guard = " AND EXISTS (SELECT 1 FROM payments WHERE id = ?8 AND status = 'PENDING')"
        return (
            "INSERT INTO memberships (member_id, plan_id, start_date, end_date, amount, status, created_by, created_at, updated_at) "
            "SELECT ?3, p.id, s.d, date(s.d, '+' || (p.duration_days - 1) || ' days'), ?5, "
            "CASE WHEN julianday(date(s.d, '+' || (p.duration_days - 1) || ' days')) - julianday(?2) <= 7 "
            "THEN 'EXPIRING' ELSE 'ACTIVE' END, ?6, ?7, ?7 "
            f"FROM membership_plans p, (SELECT {_start_sql('?1', '?2', '?3')} AS d) s WHERE p.id = ?4{guard} "
            f"RETURNING {MEMBERSHIP_COLUMNS.replace('ms.', '')}",
            params,
        )

    def latest_for_member_stmt(self, member_id: int) -> Statement:
        return (
            f"SELECT {MEMBERSHIP_COLUMNS}, p.name AS plan_name FROM memberships ms "
            "JOIN membership_plans p ON p.id = ms.plan_id WHERE ms.member_id = ?1 ORDER BY ms.id DESC LIMIT 1",
            [member_id],
        )

    def cancel_stmt(self, membership_id: int, now: str) -> Statement:
        return (
            "UPDATE memberships SET status = 'CANCELLED', updated_at = ?2 WHERE id = ?1 AND status != 'CANCELLED'",
            [membership_id, now],
        )

    async def get(self, membership_id: int) -> dict[str, Any] | None:
        return await self.db.one(
            f"SELECT {MEMBERSHIP_COLUMNS}, p.name AS plan_name FROM memberships ms "
            "JOIN membership_plans p ON p.id = ms.plan_id WHERE ms.id = ?1",
            [membership_id],
        )

    async def coverage_end(self, member_id: int) -> str | None:
        return await self.db.value(
            "SELECT MAX(end_date) FROM memberships WHERE member_id = ?1 AND status != 'CANCELLED'", [member_id]
        )

    async def for_member(self, member_id: int, limit: int = 100) -> list[dict[str, Any]]:
        return await self.db.all(
            f"SELECT {MEMBERSHIP_COLUMNS}, p.name AS plan_name FROM memberships ms JOIN membership_plans p ON p.id = ms.plan_id "
            "WHERE ms.member_id = ?1 ORDER BY ms.end_date DESC, ms.id DESC LIMIT ?2",
            [member_id, limit],
        )

    async def list(
        self, *, status: str | None, plan_id: int | None, today: str, soon: str, limit: int, offset: int
    ) -> tuple[list[dict[str, Any]], int]:
        bind = Binder()
        clauses: list[str] = []
        if status == "ACTIVE":
            clauses.append(f"ms.status IN ('ACTIVE', 'EXPIRING') AND ms.start_date <= {bind(today)} AND ms.end_date >= {bind(today)}")
        elif status == "EXPIRING":
            clauses.append(f"ms.status IN ('ACTIVE', 'EXPIRING') AND ms.end_date BETWEEN {bind(today)} AND {bind(soon)}")
        elif status == "EXPIRED":
            clauses.append(f"ms.status IN {PAID_STATES} AND ms.end_date < {bind(today)}")
        elif status == "UPCOMING":
            clauses.append(f"ms.status IN ('ACTIVE', 'EXPIRING') AND ms.start_date > {bind(today)}")
        elif status == "CANCELLED":
            clauses.append("ms.status = 'CANCELLED'")
        if plan_id:
            clauses.append(f"ms.plan_id = {bind(plan_id)}")
        condition = where(clauses)
        order = "ms.end_date ASC" if status == "EXPIRING" else "ms.id DESC"
        count_params = list(bind.params)
        rows, total = await self.db.batch(
            [
                (
                    f"SELECT {MEMBERSHIP_COLUMNS}, p.name AS plan_name, m.name AS member_name, m.member_code, m.phone "
                    "FROM memberships ms JOIN membership_plans p ON p.id = ms.plan_id JOIN members m ON m.id = ms.member_id "
                    f"{condition} ORDER BY {order} LIMIT {bind(limit)} OFFSET {bind(offset)}",
                    bind.params,
                ),
                (f"SELECT COUNT(*) AS c FROM memberships ms {condition}", count_params),
            ]
        )
        return rows.rows, count_of(total)

    async def renewals_due(self, *, low: str, high: str, newest_first: bool, limit: int, offset: int) -> tuple[list[dict[str, Any]], int]:
        """Members whose latest membership ends in [low, high] and who haven't renewed yet."""
        condition = (
            f"ms.status IN {PAID_STATES} AND ms.end_date BETWEEN ?1 AND ?2 AND m.status NOT IN ('INACTIVE', 'SUSPENDED') "
            "AND NOT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = ms.member_id AND n.status != 'CANCELLED' "
            "AND n.end_date > ms.end_date)"
        )
        order = "ms.end_date DESC" if newest_first else "ms.end_date ASC"
        rows, total = await self.db.batch(
            [
                (
                    "SELECT m.id AS member_id, m.member_code, m.name, m.phone, m.status AS account_status, ms.end_date, "
                    "ms.plan_id, p.name AS plan_name, "
                    "EXISTS (SELECT 1 FROM payments py WHERE py.member_id = m.id AND py.status = 'PENDING') AS has_pending "
                    "FROM memberships ms JOIN members m ON m.id = ms.member_id JOIN membership_plans p ON p.id = ms.plan_id "
                    f"WHERE {condition} ORDER BY {order} LIMIT ?3 OFFSET ?4",
                    [low, high, limit, offset],
                ),
                (
                    f"SELECT COUNT(*) AS c FROM memberships ms JOIN members m ON m.id = ms.member_id WHERE {condition}",
                    [low, high],
                ),
            ]
        )
        return rows.rows, count_of(total)

    async def recent_duplicate(self, member_id: int, plan_id: int, since: str) -> bool:
        return bool(
            await self.db.value(
                "SELECT 1 FROM memberships WHERE member_id = ?1 AND plan_id = ?2 AND status != 'CANCELLED' AND created_at >= ?3 LIMIT 1",
                [member_id, plan_id, since],
            )
        )

    # -- daily job (indexed by status + end_date) ------------------------------------------------
    def expire_members_stmt(self, today: str, now: str) -> Statement:
        return (
            "UPDATE members SET status = 'EXPIRED', updated_at = ?2 WHERE status = 'ACTIVE' AND id IN ("
            "SELECT ms.member_id FROM memberships ms WHERE ms.status IN ('ACTIVE', 'EXPIRING') AND ms.end_date < ?1) "
            "AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = members.id AND x.status != 'CANCELLED' "
            "AND x.end_date >= ?1)",
            [today, now],
        )

    def mark_expired_stmt(self, today: str, now: str) -> Statement:
        return (
            "UPDATE memberships SET status = 'EXPIRED', updated_at = ?2 WHERE status IN ('ACTIVE', 'EXPIRING') AND end_date < ?1",
            [today, now],
        )

    def mark_expiring_stmt(self, today: str, soon: str, now: str) -> Statement:
        return (
            "UPDATE memberships SET status = 'EXPIRING', updated_at = ?3 "
            "WHERE status = 'ACTIVE' AND end_date <= ?2 AND start_date <= ?1",
            [today, soon, now],
        )
