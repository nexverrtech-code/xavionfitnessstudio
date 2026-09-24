"""PortalRepository: the member app home screen, in a single batch."""

from __future__ import annotations

from core.database import Result

from .base import Repository


class PortalRepository(Repository):
    async def overview(self, *, member_id: int, user_id: int, today: str, month_start: str, strip_start: str) -> list[Result]:
        return await self.db.batch(
            [
                (
                    "SELECT m.id, m.member_code, m.name, m.status, t.name AS trainer_name FROM members m "
                    "LEFT JOIN trainers t ON t.id = m.trainer_id WHERE m.id = ?1",
                    [member_id],
                ),
                (
                    "SELECT ms.id, ms.member_id, ms.plan_id, ms.start_date, ms.end_date, ms.amount, ms.status, ms.created_at, "
                    "p.name AS plan_name FROM memberships ms JOIN membership_plans p ON p.id = ms.plan_id "
                    "WHERE ms.member_id = ?1 AND ms.status != 'CANCELLED' ORDER BY ms.end_date DESC LIMIT 3",
                    [member_id],
                ),
                (
                    "SELECT COALESCE(SUM(CASE WHEN attendance_date >= ?2 THEN 1 ELSE 0 END), 0) AS this_month, "
                    "MAX(check_in) AS last_check_in, MAX(CASE WHEN attendance_date = ?3 THEN check_in END) AS today_check_in "
                    "FROM attendance WHERE member_id = ?1",
                    [member_id, month_start, today],
                ),
                (
                    "SELECT attendance_date FROM attendance WHERE member_id = ?1 AND attendance_date >= ?2",
                    [member_id, strip_start],
                ),
                (
                    "SELECT id, payment_number, amount, payment_method, status, payment_date FROM payments "
                    "WHERE member_id = ?1 ORDER BY id DESC LIMIT 1",
                    [member_id],
                ),
                (
                    "SELECT wp.id, wp.title, wp.day_label, (SELECT COUNT(*) FROM workout_exercises e WHERE e.workout_plan_id = wp.id) "
                    "AS exercises FROM workout_plans wp WHERE wp.member_id = ?1 AND wp.status = 'ACTIVE' "
                    "ORDER BY wp.updated_at DESC LIMIT 1",
                    [member_id],
                ),
                (
                    "SELECT id, type, message, status, created_at FROM notifications WHERE user_id = ?1 "
                    "ORDER BY created_at DESC, id DESC LIMIT 1",
                    [user_id],
                ),
                ("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?1 AND status = 'UNREAD'", [user_id]),
                (
                    "SELECT p.id, p.payment_number, p.amount, p.transaction_reference, p.created_at, pl.name AS plan_name "
                    "FROM payments p JOIN membership_plans pl ON pl.id = p.plan_id WHERE p.member_id = ?1 AND p.status = 'PENDING'",
                    [member_id],
                ),
            ]
        )
