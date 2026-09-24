"""UserRepository: sign-in accounts for admins, staff, trainers and members."""

from __future__ import annotations

from typing import Any

from .base import Repository, Statement

USER_COLUMNS = (
    "u.id, u.name, u.email, u.phone, u.password_hash, u.role_id, u.status, u.must_change_password, "
    "u.token_version, u.failed_logins, u.locked_until, u.last_login_at, u.created_at"
)
_LINKS = (
    "(SELECT m.id FROM members m WHERE m.user_id = u.id) AS member_id, "
    "(SELECT m.member_code FROM members m WHERE m.user_id = u.id) AS member_code, "
    "(SELECT t.id FROM trainers t WHERE t.user_id = u.id) AS trainer_id, "
    "(SELECT t.status FROM trainers t WHERE t.user_id = u.id) AS trainer_status"
)


class UserRepository(Repository):
    async def session_user(self, user_id: int) -> dict[str, Any] | None:
        """The few fields every authenticated request needs (cached briefly per isolate)."""
        return await self.db.one(
            "SELECT u.id, u.role_id, u.name, u.status, u.must_change_password, u.token_version, "
            "(SELECT m.id FROM members m WHERE m.user_id = u.id) AS member_id, "
            "(SELECT t.id FROM trainers t WHERE t.user_id = u.id) AS trainer_id "
            "FROM users u WHERE u.id = ?1",
            [user_id],
        )

    async def get(self, user_id: int) -> dict[str, Any] | None:
        return await self.db.one(f"SELECT {USER_COLUMNS}, {_LINKS} FROM users u WHERE u.id = ?1", [user_id])

    async def find_for_login(self, *, email: str | None, phone: str | None, member_code: str | None) -> list[dict[str, Any]]:
        """Admin/staff by their own email/phone, trainers by their trainer contact details,
        members by member ID / phone / email — one indexed round trip."""
        return await self.db.all(
            f"SELECT {USER_COLUMNS}, NULL AS member_id, NULL AS member_code, NULL AS trainer_id, NULL AS trainer_status "
            "FROM users u WHERE u.role_id IN (1, 2) AND (u.email = ?1 OR u.phone = ?2) "
            "UNION ALL "
            f"SELECT {USER_COLUMNS}, m.id, m.member_code, NULL, NULL FROM members m JOIN users u ON u.id = m.user_id "
            "WHERE m.member_code = ?3 OR m.phone = ?2 OR m.email = ?1 "
            "UNION ALL "
            f"SELECT {USER_COLUMNS}, NULL, NULL, t.id, t.status FROM trainers t JOIN users u ON u.id = t.user_id "
            "WHERE t.phone = ?2 OR t.email = ?1 "
            "LIMIT 3",
            [email, phone, member_code],
        )

    async def record_failure(self, user_id: int, failed: int, locked_until: str | None) -> None:
        await self.db.run(
            "UPDATE users SET failed_logins = ?2, locked_until = ?3 WHERE id = ?1", [user_id, failed, locked_until]
        )

    async def record_success(self, user_id: int, now: str, new_hash: str | None) -> None:
        await self.db.run(
            "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?2, "
            "password_hash = COALESCE(?3, password_hash) WHERE id = ?1",
            [user_id, now, new_hash],
        )

    async def change_password(self, user_id: int, password_hash: str, token_version: int, now: str) -> None:
        await self.db.run(
            "UPDATE users SET password_hash = ?2, must_change_password = 0, token_version = ?3, updated_at = ?4 WHERE id = ?1",
            [user_id, password_hash, token_version, now],
        )

    async def reset_credentials(self, user_id: int, password_hash: str, now: str, *, name: str | None = None) -> None:
        """New temporary password: forces a change at next sign-in and signs out every device."""
        await self.db.run(
            "UPDATE users SET password_hash = ?2, must_change_password = 1, status = 'ACTIVE', failed_logins = 0, "
            "locked_until = NULL, token_version = token_version + 1, name = COALESCE(?4, name), updated_at = ?3 WHERE id = ?1",
            [user_id, password_hash, now, name],
        )

    def insert_stmt(
        self, *, role_id: int, name: str, password_hash: str, now: str, email: str | None = None, phone: str | None = None,
        must_change_password: bool = True,
    ) -> Statement:
        return (
            "INSERT INTO users (name, email, phone, password_hash, role_id, must_change_password, created_at, updated_at) "
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) RETURNING id",
            [name, email, phone, password_hash, role_id, 1 if must_change_password else 0, now],
        )

    async def insert(self, **kwargs: Any) -> int:
        sql, params = self.insert_stmt(**kwargs)
        return (await self.db.run(sql, params)).first["id"]

    async def set_status(self, user_id: int, status: str, now: str) -> int:
        result = await self.db.run(
            "UPDATE users SET status = ?2, token_version = token_version + 1, updated_at = ?3 WHERE id = ?1",
            [user_id, status, now],
        )
        return result.changes

    async def update_profile(self, user_id: int, *, name: str, email: str | None, phone: str | None, now: str) -> None:
        await self.db.run(
            "UPDATE users SET name = ?2, email = ?3, phone = ?4, updated_at = ?5 WHERE id = ?1",
            [user_id, name, email, phone, now],
        )

    async def rename(self, user_id: int, name: str, now: str) -> None:
        await self.db.run("UPDATE users SET name = ?2, updated_at = ?3 WHERE id = ?1", [user_id, name, now])

    async def bump_token_version(self, user_id: int) -> None:
        await self.db.run("UPDATE users SET token_version = token_version + 1 WHERE id = ?1", [user_id])

    async def list_team(self) -> list[dict[str, Any]]:
        return await self.db.all(
            f"SELECT {USER_COLUMNS} FROM users u WHERE u.role_id IN (1, 2) ORDER BY u.role_id, u.name LIMIT 200"
        )

    async def other_active_admins(self, user_id: int) -> int:
        return await self.db.value(
            "SELECT COUNT(*) FROM users WHERE role_id = 1 AND status = 'ACTIVE' AND id != ?1", [user_id], default=0
        )

    async def has_admin(self) -> bool:
        return bool(await self.db.value("SELECT 1 FROM users WHERE role_id = 1 LIMIT 1"))

    async def admin_ids(self) -> list[int]:
        rows = await self.db.all("SELECT id FROM users WHERE role_id = 1 AND status = 'ACTIVE' LIMIT 20")
        return [r["id"] for r in rows]
