"""NotificationRepository: in-app notifications (UNREAD / READ).

Reminders are created with a single INSERT ... SELECT per reminder type — a handful of
statements per day regardless of member count (the Free plan allows 50 per invocation) —
and are de-duplicated inside the same statement.
"""

from __future__ import annotations

from typing import Any

from utils.formatting import sql_first_name, sql_format_date

from .base import Binder, Repository, Statement, count_of, where

_REMINDER_TEXT = {
    "EXPIRY_7D": "'Hi ' || {first} || ', your ' || p.name || ' membership expires on ' || {date} "
    "|| ' (7 days left). Renew in the app to keep training without a break.'",
    "EXPIRY_3D": "'Hi ' || {first} || ', only 3 days left on your ' || p.name || ' membership (expires ' || {date} "
    "|| '). Renew now in the app.'",
    "EXPIRY_1D": "'Hi ' || {first} || ', your ' || p.name || ' membership expires tomorrow (' || {date} "
    "|| '). Renew today to avoid interruption.'",
    "MEMBERSHIP_EXPIRED": "'Membership expired. Please renew to continue. Your ' || p.name || ' membership ended on ' "
    "|| {date} || '.'",
}
_NO_LATER_MEMBERSHIP = (
    "NOT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = ms.member_id AND n.status != 'CANCELLED' "
    "AND n.end_date > ms.end_date)"
)


def _text(kind: str) -> str:
    return _REMINDER_TEXT[kind].format(first=sql_first_name("m.name"), date=sql_format_date("ms.end_date"))


class NotificationRepository(Repository):
    def insert_stmt(self, user_id: int, kind: str, message: str, now: str) -> Statement:
        return (
            "INSERT INTO notifications (user_id, type, message, status, created_at) VALUES (?1, ?2, ?3, 'UNREAD', ?4)",
            [user_id, kind, message[:300], now],
        )

    async def insert_for_users(self, user_ids: list[int], kind: str, message: str, now: str) -> int:
        """One statement for any number of recipients (JSON array of user ids)."""
        if not user_ids:
            return 0
        result = await self.db.run(
            "INSERT INTO notifications (user_id, type, message, status, created_at) "
            "SELECT value, ?2, ?3, 'UNREAD', ?4 FROM json_each(?1)",
            ["[" + ",".join(str(int(u)) for u in user_ids) + "]", kind, message[:300], now],
        )
        return result.changes

    def expiry_reminder_stmt(self, kind: str, target_date: str, day_start: str, now: str) -> Statement:
        """Members whose membership ends on ``target_date``, not yet renewed, with no payment
        awaiting verification and not already reminded today."""
        return (
            "INSERT INTO notifications (user_id, type, message, status, created_at) "
            f"SELECT m.user_id, ?1, {_text(kind)}, 'UNREAD', ?4 "
            "FROM memberships ms JOIN members m ON m.id = ms.member_id JOIN membership_plans p ON p.id = ms.plan_id "
            "WHERE ms.status IN ('ACTIVE', 'EXPIRING') AND ms.end_date = ?2 AND m.user_id IS NOT NULL AND m.status = 'ACTIVE' "
            f"AND {_NO_LATER_MEMBERSHIP} "
            "AND NOT EXISTS (SELECT 1 FROM payments py WHERE py.member_id = ms.member_id AND py.status = 'PENDING') "
            "AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.user_id = m.user_id AND x.type = ?1 AND x.created_at >= ?3) "
            "GROUP BY m.user_id",
            [kind, target_date, day_start, now],
        )

    def expired_notice_stmt(self, low: str, high: str, now: str) -> Statement:
        """Once per lapsed membership (end date within the last few days, no renewal)."""
        return (
            "INSERT INTO notifications (user_id, type, message, status, created_at) "
            f"SELECT m.user_id, 'MEMBERSHIP_EXPIRED', {_text('MEMBERSHIP_EXPIRED')}, 'UNREAD', ?3 "
            "FROM memberships ms JOIN members m ON m.id = ms.member_id JOIN membership_plans p ON p.id = ms.plan_id "
            "WHERE ms.status IN ('ACTIVE', 'EXPIRING', 'EXPIRED') AND ms.end_date BETWEEN ?1 AND ?2 "
            "AND m.user_id IS NOT NULL AND m.status IN ('ACTIVE', 'EXPIRED') "
            f"AND {_NO_LATER_MEMBERSHIP} "
            "AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.user_id = m.user_id AND x.type = 'MEMBERSHIP_EXPIRED' "
            "AND x.created_at >= ms.end_date) "
            "GROUP BY m.user_id",
            [low, high, now],
        )

    async def already_sent_today(self, user_id: int, kind: str, day_start: str) -> bool:
        return bool(
            await self.db.value(
                "SELECT 1 FROM notifications WHERE user_id = ?1 AND type = ?2 AND created_at >= ?3 LIMIT 1",
                [user_id, kind, day_start],
            )
        )

    async def inbox(self, user_id: int, limit: int) -> tuple[list[dict[str, Any]], int]:
        rows, unread = await self.db.batch(
            [
                (
                    "SELECT id, type, message, status, created_at, read_at FROM notifications WHERE user_id = ?1 "
                    "ORDER BY created_at DESC, id DESC LIMIT ?2",
                    [user_id, limit],
                ),
                ("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?1 AND status = 'UNREAD'", [user_id]),
            ]
        )
        return rows.rows, count_of(unread)

    async def unread_count(self, user_id: int) -> int:
        return await self.db.value(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ?1 AND status = 'UNREAD'", [user_id], default=0
        )

    async def mark_read(self, user_id: int, notification_id: int | None, now: str) -> int:
        if notification_id is None:
            result = await self.db.run(
                "UPDATE notifications SET status = 'READ', read_at = ?2 WHERE user_id = ?1 AND status = 'UNREAD'", [user_id, now]
            )
        else:
            result = await self.db.run(
                "UPDATE notifications SET status = 'READ', read_at = COALESCE(read_at, ?3) WHERE id = ?1 AND user_id = ?2",
                [notification_id, user_id, now],
            )
        return result.changes

    async def log(
        self, *, since: str, kind: str | None, status: str | None, member_id: int | None, limit: int, offset: int
    ) -> tuple[list[dict[str, Any]], int]:
        # Always bounded by a date window so the count uses the created_at index.
        bind = Binder()
        clauses = [f"n.created_at >= {bind(since)}"]
        if kind:
            clauses.append(f"n.type = {bind(kind)}")
        if status:
            clauses.append(f"n.status = {bind(status)}")
        if member_id:
            clauses.append(f"n.user_id = (SELECT user_id FROM members WHERE id = {bind(member_id)})")
        condition = where(clauses)
        count_params = list(bind.params)
        rows, total = await self.db.batch(
            [
                (
                    "SELECT n.id, n.user_id, n.type, n.message, n.status, n.created_at, n.read_at, u.name AS user_name, "
                    "u.role_id, m.id AS member_id, m.member_code FROM notifications n JOIN users u ON u.id = n.user_id "
                    f"LEFT JOIN members m ON m.user_id = n.user_id {condition} "
                    f"ORDER BY n.created_at DESC, n.id DESC LIMIT {bind(limit)} OFFSET {bind(offset)}",
                    bind.params,
                ),
                (f"SELECT COUNT(*) AS c FROM notifications n {condition}", count_params),
            ]
        )
        return rows.rows, count_of(total)

    def cleanup_stmt(self, cutoff: str) -> Statement:
        """Old notifications are non-critical data (spec: safe automatic cleanup). Bounded per run."""
        return (
            "DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at < ?1 ORDER BY created_at LIMIT 5000)",
            [cutoff],
        )
