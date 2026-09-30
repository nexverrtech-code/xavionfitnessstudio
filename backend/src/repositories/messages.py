"""MessageRepository: the outbox of automatic WhatsApp / email messages."""

from __future__ import annotations

import json
from typing import Any

from core.database import Result, Statement
from utils.formatting import sql_first_name, sql_format_date

from .base import Repository

_NO_LATER_MEMBERSHIP = (
    "NOT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = ms.member_id AND n.status != 'CANCELLED' "
    "AND n.end_date > ms.end_date)"
)
# Stored phones are local digits: WhatsApp needs the country code in front.
_RECIPIENT = {
    "WHATSAPP": ("CASE WHEN length(m.phone) = 10 THEN ?4 || m.phone ELSE m.phone END", "m.phone IS NOT NULL"),
    "EMAIL": ("m.email", "m.email IS NOT NULL"),
}


class MessageRepository(Repository):
    def enqueue_stmt(self, *, channel: str, event: str, member_id: int | None, recipient: str, params: dict[str, Any],
                     dedupe_key: str, now: str) -> Statement:
        return (
            "INSERT OR IGNORE INTO outbox (channel, event, member_id, recipient, params, dedupe_key, created_at) "
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            [channel, event, member_id, recipient, json.dumps(params, separators=(",", ":"), ensure_ascii=False), dedupe_key, now],
        )

    def reminder_stmt(self, *, channel: str, event: str, gym: str, country_code: str, now: str,
                      end_from: str, end_to: str, expired: bool) -> Statement:
        """Every member (app login or not) whose membership ends in [end_from, end_to] and who has
        not renewed. One message per membership and reminder type: a re-run adds nothing."""
        recipient, present = _RECIPIENT[channel]
        if expired:
            scope = "ms.status IN ('ACTIVE', 'EXPIRING', 'EXPIRED') AND m.status IN ('ACTIVE', 'EXPIRED')"
        else:
            scope = ("ms.status IN ('ACTIVE', 'EXPIRING') AND m.status = 'ACTIVE' "
                     "AND NOT EXISTS (SELECT 1 FROM payments py WHERE py.member_id = ms.member_id AND py.status = 'PENDING')")
        return (
            "INSERT OR IGNORE INTO outbox (channel, event, member_id, recipient, params, dedupe_key, created_at) "
            f"SELECT ?1, ?2, m.id, {recipient}, "
            f"json_object('first', {sql_first_name('m.name')}, 'plan', p.name, 'gym', ?3, 'end', {sql_format_date('ms.end_date')}), "
            "?2 || ':' || MAX(ms.id) || ':' || ?1, ?5 "
            "FROM memberships ms JOIN members m ON m.id = ms.member_id JOIN membership_plans p ON p.id = ms.plan_id "
            f"WHERE ms.end_date BETWEEN ?6 AND ?7 AND {scope} AND m.messages_opt_out = 0 AND {present} "
            f"AND {_NO_LATER_MEMBERSHIP} GROUP BY m.id",
            [channel, event, gym, country_code, now, end_from, end_to],
        )

    async def claim(self, limit: int, now: str, stale_before: str) -> list[dict[str, Any]]:
        """Atomically take up to ``limit`` unsent messages (QUEUED -> SENDING). A run that died
        mid-way leaves SENDING rows behind; they are taken again once older than ``stale_before``."""
        return await self.db.all(
            "UPDATE outbox SET status = 'SENDING', attempts = attempts + 1, claimed_at = ?2 WHERE id IN ("
            "SELECT id FROM outbox WHERE status IN ('QUEUED', 'SENDING') AND (status = 'QUEUED' OR claimed_at < ?3) "
            "ORDER BY id LIMIT ?1) RETURNING id, channel, event, member_id, recipient, params, attempts",
            [limit, now, stale_before],
        )

    @staticmethod
    def sent_stmt(message_id: int, now: str) -> Statement:
        return "UPDATE outbox SET status = 'SENT', sent_at = ?2, last_error = NULL WHERE id = ?1", [message_id, now]

    @staticmethod
    def failed_stmt(message_id: int, error: str) -> Statement:
        return "UPDATE outbox SET status = 'FAILED', last_error = ?2 WHERE id = ?1", [message_id, error[:300]]

    @staticmethod
    def retry_stmt(message_id: int, error: str, max_attempts: int) -> Statement:
        return (
            "UPDATE outbox SET status = CASE WHEN attempts >= ?3 THEN 'FAILED' ELSE 'QUEUED' END, last_error = ?2 WHERE id = ?1",
            [message_id, error[:300], max_attempts],
        )

    async def overview(self, since: str, limit: int) -> list[Result]:
        return await self.db.batch(
            [
                ("SELECT COUNT(*) AS c FROM outbox WHERE status IN ('QUEUED', 'SENDING')", []),
                (
                    "SELECT COALESCE(SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END), 0) AS sent, "
                    "COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed FROM outbox WHERE created_at >= ?1",
                    [since],
                ),
                (
                    "SELECT o.id, o.channel, o.event, o.recipient, o.status, o.attempts, o.last_error, o.created_at, o.sent_at, "
                    "o.member_id, m.name AS member_name, m.member_code FROM outbox o LEFT JOIN members m ON m.id = o.member_id "
                    "ORDER BY o.id DESC LIMIT ?1",
                    [limit],
                ),
            ]
        )

    @staticmethod
    def cleanup_stmt(before: str) -> Statement:
        return "DELETE FROM outbox WHERE created_at < ?1 AND status IN ('SENT', 'FAILED')", [before]
