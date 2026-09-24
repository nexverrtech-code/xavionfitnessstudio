"""MemberRepository: member records, search, lists and the member workspace reads."""

from __future__ import annotations

from typing import Any

from core.database import Result

from .base import Binder, Repository, Statement, count_of, where

# End date of the member's latest non-cancelled membership (index: memberships(member_id, end_date)).
COVERAGE_END = (
    "(SELECT MAX(x.end_date) FROM memberships x WHERE x.member_id = m.id AND x.status != 'CANCELLED')"
)
LATEST_PLAN = (
    "(SELECT p.name FROM memberships x JOIN membership_plans p ON p.id = x.plan_id "
    "WHERE x.member_id = m.id AND x.status != 'CANCELLED' ORDER BY x.end_date DESC LIMIT 1)"
)
LIST_COLUMNS = (
    "m.id, m.member_code, m.name, m.phone, m.email, m.status, m.trainer_id, m.joining_date, m.user_id, "
    f"t.name AS trainer_name, {COVERAGE_END} AS expiry_date, {LATEST_PLAN} AS plan_name"
)
DETAIL_COLUMNS = (
    "m.id, m.member_code, m.user_id, m.name, m.phone, m.email, m.gender, m.date_of_birth, m.address, "
    "m.emergency_contact, m.joining_date, m.trainer_id, m.status, m.qr_token, m.created_by, m.created_at, m.updated_at"
)
# Members whose paid coverage ends within the window and who have not renewed yet.
EXPIRING_IDS = (
    "SELECT ms.member_id FROM memberships ms WHERE ms.status IN ('ACTIVE', 'EXPIRING') "
    "AND ms.end_date BETWEEN {low} AND {high} AND NOT EXISTS (SELECT 1 FROM memberships n "
    "WHERE n.member_id = ms.member_id AND n.status != 'CANCELLED' AND n.end_date > ms.end_date)"
)
SORTS = {"newest": "m.id DESC", "name": "m.name ASC", "code": "m.member_code ASC"}
HIGH = "\U0010ffff"  # upper bound for index-friendly prefix ranges


class MemberRepository(Repository):
    # -- single records -------------------------------------------------------------------------
    async def get(self, member_id: int) -> dict[str, Any] | None:
        return await self.db.one(
            f"SELECT {DETAIL_COLUMNS}, t.name AS trainer_name, {COVERAGE_END} AS expiry_date "
            "FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id WHERE m.id = ?1",
            [member_id],
        )

    async def basic(self, member_id: int) -> dict[str, Any] | None:
        return await self.db.one(
            "SELECT m.id, m.member_code, m.name, m.phone, m.email, m.status, m.user_id, m.trainer_id, "
            f"{COVERAGE_END} AS expiry_date FROM members m WHERE m.id = ?1",
            [member_id],
        )

    async def trainer_of(self, member_id: int) -> int | None:
        row = await self.db.one("SELECT trainer_id FROM members WHERE id = ?1", [member_id])
        return row["trainer_id"] if row else None

    async def duplicate(self, name: str, phone: str) -> str | None:
        return await self.db.value("SELECT member_code FROM members WHERE phone = ?1 AND name = ?2 LIMIT 1", [phone, name])

    async def many(self, ids: list[int]) -> list[dict[str, Any]]:
        return await self.db.all(
            "SELECT m.id, m.name, m.user_id, m.trainer_id FROM members m WHERE m.id IN (SELECT value FROM json_each(?1))",
            [_json_ids(ids)],
        )

    # -- writes ---------------------------------------------------------------------------------
    def insert_stmt(self, *, prefix: str, values: dict[str, Any], qr_token: str, created_by: int | None, now: str) -> Statement:
        """Member ID = prefix + zero-padded next number (GYM000001), computed inside the insert."""
        return (
            "INSERT INTO members (id, member_code, name, phone, email, gender, date_of_birth, address, emergency_contact, "
            "joining_date, trainer_id, status, qr_token, created_by, created_at, updated_at) "
            "SELECT n, ?1 || printf('%06d', n), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'INACTIVE', ?11, ?12, ?13, ?13 "
            "FROM (SELECT COALESCE(MAX(id), 0) + 1 AS n FROM members) RETURNING id, member_code, name",
            [
                prefix, values["name"], values["phone"], values.get("email"), values.get("gender"),
                values.get("date_of_birth"), values.get("address"), values.get("emergency_contact"),
                values["joining_date"], values.get("trainer_id"), qr_token, created_by, now,
            ],
        )

    async def update(self, member_id: int, values: dict[str, Any], now: str) -> int:
        result = await self.db.run(
            "UPDATE members SET name = ?2, phone = ?3, email = ?4, gender = ?5, date_of_birth = ?6, address = ?7, "
            "emergency_contact = ?8, joining_date = ?9, updated_at = ?10 WHERE id = ?1",
            [
                member_id, values["name"], values["phone"], values.get("email"), values.get("gender"),
                values.get("date_of_birth"), values.get("address"), values.get("emergency_contact"),
                values["joining_date"], now,
            ],
        )
        return result.changes

    async def update_contact(self, member_id: int, *, email: str | None, address: str | None, emergency: str | None, now: str) -> None:
        await self.db.run(
            "UPDATE members SET email = ?2, address = ?3, emergency_contact = ?4, updated_at = ?5 WHERE id = ?1",
            [member_id, email, address, emergency, now],
        )

    async def set_status(self, member_id: int, status: str, now: str) -> int:
        result = await self.db.run("UPDATE members SET status = ?2, updated_at = ?3 WHERE id = ?1", [member_id, status, now])
        return result.changes

    def reactivate_stmt(self, member_id: int, today: str, now: str) -> Statement:
        """Back from SUSPENDED / INACTIVE: ACTIVE if a paid membership covers today or later."""
        return (
            "UPDATE members SET status = CASE "
            "WHEN EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = members.id AND x.status != 'CANCELLED' "
            "AND x.end_date >= ?2) THEN 'ACTIVE' "
            "WHEN EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = members.id AND x.status != 'CANCELLED') "
            "THEN 'EXPIRED' ELSE 'INACTIVE' END, updated_at = ?3 WHERE id = ?1",
            [member_id, today, now],
        )

    def activate_stmt(self, member_id: int, today: str, now: str) -> Statement:
        """After a confirmed payment a new / expired member becomes ACTIVE — or EXPIRED if the
        (back-dated) membership has already ended. A suspension is always kept."""
        return (
            "UPDATE members SET status = CASE WHEN EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = members.id "
            "AND x.status != 'CANCELLED' AND x.end_date >= ?2) THEN 'ACTIVE' ELSE 'EXPIRED' END, updated_at = ?3 "
            "WHERE id = ?1 AND status IN ('INACTIVE', 'EXPIRED')",
            [member_id, today, now],
        )

    def recompute_after_cancel_stmt(self, member_id: int, today: str, now: str) -> Statement:
        return (
            "UPDATE members SET status = CASE "
            "WHEN EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = members.id AND x.status != 'CANCELLED' "
            "AND x.end_date >= ?2) THEN 'ACTIVE' "
            "WHEN EXISTS (SELECT 1 FROM memberships x WHERE x.member_id = members.id AND x.status != 'CANCELLED') "
            "THEN 'EXPIRED' ELSE 'INACTIVE' END, updated_at = ?3 WHERE id = ?1 AND status IN ('ACTIVE', 'EXPIRED')",
            [member_id, today, now],
        )

    async def set_trainer(self, member_id: int, trainer_id: int | None, now: str) -> None:
        await self.db.run("UPDATE members SET trainer_id = ?2, updated_at = ?3 WHERE id = ?1", [member_id, trainer_id, now])

    async def assign_trainer_many(self, member_ids: list[int], trainer_id: int, now: str) -> int:
        result = await self.db.run(
            "UPDATE members SET trainer_id = ?2, updated_at = ?3 WHERE id IN (SELECT value FROM json_each(?1)) "
            "AND (trainer_id IS NULL OR trainer_id != ?2)",
            [_json_ids(member_ids), trainer_id, now],
        )
        return result.changes

    def link_user_stmt(self, member_id: int, now: str) -> Statement:
        """Attach the user row inserted just before in the same batch (highest users.id)."""
        return (
            "UPDATE members SET user_id = (SELECT MAX(id) FROM users), updated_at = ?2 WHERE id = ?1 AND user_id IS NULL",
            [member_id, now],
        )

    async def set_qr_token(self, member_id: int, token: str, now: str) -> int:
        result = await self.db.run("UPDATE members SET qr_token = ?2, updated_at = ?3 WHERE id = ?1", [member_id, token, now])
        return result.changes

    # -- search & lists ------------------------------------------------------------------------
    def search_statements(self, terms: dict[str, Any], *, limit: int, trainer_id: int | None) -> list[Statement]:
        base = f"SELECT {LIST_COLUMNS} FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id WHERE "

        def stmt(condition: str, values: list[Any], order: str = "") -> Statement:
            params = list(values)
            scope = ""
            if trainer_id:
                params.append(trainer_id)
                scope = f" AND m.trainer_id = ?{len(params)}"
            return (f"{base}{condition}{scope}{order} LIMIT {int(limit)}", params)

        statements = []
        if terms["codes"]:
            statements.append(stmt("m.member_code = ?1", [terms["codes"][0]]))
        if terms["phone"]:
            statements.append(stmt("m.phone >= ?1 AND m.phone < ?2", [terms["phone"], terms["phone"] + HIGH]))
        if terms["has_letters"] and len(terms["text"]) >= 2:
            statements.append(stmt("m.name >= ?1 AND m.name < ?2", [terms["text"], terms["text"] + HIGH], " ORDER BY m.name"))
        if terms["email"]:
            statements.append(stmt("m.email >= ?1 AND m.email < ?2", [terms["email"], terms["email"] + HIGH]))
        return statements

    async def search_word(self, pattern: str, *, limit: int, trainer_id: int | None) -> list[dict[str, Any]]:
        """Fallback for a later word of the name ("Sharma" in "Aarav Sharma")."""
        params: list[Any] = [pattern]
        scope = ""
        if trainer_id:
            params.append(trainer_id)
            scope = " AND m.trainer_id = ?2"
        return await self.db.all(
            f"SELECT {LIST_COLUMNS} FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id "
            f"WHERE m.name LIKE ?1 ESCAPE '\\'{scope} LIMIT {int(limit)}",
            params,
        )

    async def list(
        self, *, status: str | None, trainer_id: int | None, terms: dict[str, Any] | None, today: str, soon: str,
        sort: str, limit: int, offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        bind = Binder()
        clauses: list[str] = []
        if status == "EXPIRING":
            clauses.append("m.status = 'ACTIVE'")
            clauses.append("m.id IN (" + EXPIRING_IDS.format(low=bind(today), high=bind(soon)) + ")")
        elif status:
            clauses.append(f"m.status = {bind(status)}")
        if trainer_id:
            clauses.append(f"m.trainer_id = {bind(trainer_id)}")
        if terms:
            options = [f"(m.name >= {bind(terms['text'])} AND m.name < {bind(terms['text'] + HIGH)})"]
            if terms["codes"]:
                options.append(f"m.member_code = {bind(terms['codes'][0])}")
            if terms["phone"]:
                options.append(f"(m.phone >= {bind(terms['phone'])} AND m.phone < {bind(terms['phone'] + HIGH)})")
            if terms["email"]:
                options.append(f"m.email = {bind(terms['email'])}")
            clauses.append("(" + " OR ".join(options) + ")")
        condition = where(clauses)
        count_params = list(bind.params)
        rows, total = await self.db.batch(
            [
                (
                    f"SELECT {LIST_COLUMNS} FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id {condition} "
                    f"ORDER BY {SORTS.get(sort, SORTS['newest'])} LIMIT {bind(limit)} OFFSET {bind(offset)}",
                    bind.params,
                ),
                (f"SELECT COUNT(*) AS c FROM members m {condition}", count_params),
            ]
        )
        return rows.rows, count_of(total)

    # -- workspace ------------------------------------------------------------------------------
    def workspace_statements(self, member_id: int, month_start: str, *, include_finance: bool) -> list[Statement]:
        statements: list[Statement] = [
            (
                f"SELECT {DETAIL_COLUMNS}, t.name AS trainer_name FROM members m "
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
                "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN attendance_date >= ?2 THEN 1 ELSE 0 END), 0) AS this_month, "
                "MAX(check_in) AS last_check_in FROM attendance WHERE member_id = ?1",
                [member_id, month_start],
            ),
            (
                "SELECT recorded_at, weight, body_fat FROM body_measurements WHERE member_id = ?1 "
                "ORDER BY recorded_at DESC, id DESC LIMIT 1",
                [member_id],
            ),
            ("SELECT COUNT(*) AS c FROM workout_plans WHERE member_id = ?1 AND status = 'ACTIVE'", [member_id]),
            (
                "SELECT u.id, u.status, u.last_login_at, u.must_change_password FROM users u "
                "JOIN members m ON m.user_id = u.id WHERE m.id = ?1",
                [member_id],
            ),
        ]
        if include_finance:
            statements += [
                (
                    "SELECT COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount END), 0) AS total_paid, "
                    "MAX(CASE WHEN status IN ('PAID', 'REFUNDED') THEN payment_date END) AS last_payment_date "
                    "FROM payments WHERE member_id = ?1",
                    [member_id],
                ),
                (
                    "SELECT p.id, p.payment_number, p.amount, p.transaction_reference, p.payment_date, p.created_at, "
                    "pl.name AS plan_name FROM payments p JOIN membership_plans pl ON pl.id = p.plan_id "
                    "WHERE p.member_id = ?1 AND p.status = 'PENDING'",
                    [member_id],
                ),
            ]
        return statements

    async def workspace(self, member_id: int, month_start: str, *, include_finance: bool) -> list[Result]:
        return await self.db.batch(self.workspace_statements(member_id, month_start, include_finance=include_finance))

    async def activity(self, member_id: int, *, include_finance: bool) -> list[Result]:
        statements: list[Statement] = [
            (
                "SELECT id, check_in, method FROM attendance WHERE member_id = ?1 ORDER BY attendance_date DESC LIMIT 8",
                [member_id],
            ),
            (
                "SELECT ms.id, ms.created_at, ms.status, p.name AS plan_name FROM memberships ms "
                "JOIN membership_plans p ON p.id = ms.plan_id WHERE ms.member_id = ?1 ORDER BY ms.id DESC LIMIT 8",
                [member_id],
            ),
            ("SELECT id, recorded_at, weight FROM body_measurements WHERE member_id = ?1 ORDER BY id DESC LIMIT 5", [member_id]),
            ("SELECT id, title, created_at, updated_at FROM workout_plans WHERE member_id = ?1 ORDER BY id DESC LIMIT 5", [member_id]),
            (
                "SELECT n.id, n.type, n.message, n.created_at FROM notifications n JOIN members m ON m.user_id = n.user_id "
                "WHERE m.id = ?1 ORDER BY n.created_at DESC LIMIT 8",
                [member_id],
            ),
        ]
        if include_finance:
            statements.append(
                (
                    "SELECT id, payment_number, amount, payment_method, status, created_at, verified_at FROM payments "
                    "WHERE member_id = ?1 ORDER BY id DESC LIMIT 8",
                    [member_id],
                )
            )
        return await self.db.batch(statements)

    # -- portal / QR ------------------------------------------------------------------------------
    async def qr(self, member_id: int) -> dict[str, Any] | None:
        return await self.db.one("SELECT id, member_code, name, qr_token FROM members WHERE id = ?1", [member_id])

    async def profile(self, member_id: int) -> dict[str, Any] | None:
        return await self.db.one(
            "SELECT m.id, m.member_code, m.name, m.phone, m.email, m.gender, m.date_of_birth, m.address, m.emergency_contact, "
            "m.joining_date, m.status, t.name AS trainer_name FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id "
            "WHERE m.id = ?1",
            [member_id],
        )

    async def active_user_ids(self, segment: str, today: str, soon: str) -> list[int]:
        """Portal users in a broadcast segment (capped)."""
        clauses = {
            "ACTIVE": ("m.status = 'ACTIVE'", []),
            "EXPIRING": ("m.status = 'ACTIVE' AND m.id IN (" + EXPIRING_IDS.format(low="?1", high="?2") + ")", [today, soon]),
            "EXPIRED": ("m.status = 'EXPIRED'", []),
            "ALL": ("m.status IN ('ACTIVE', 'EXPIRED', 'INACTIVE')", []),
        }[segment]
        rows = await self.db.all(
            f"SELECT m.user_id FROM members m WHERE m.user_id IS NOT NULL AND {clauses[0]} ORDER BY m.id LIMIT 2000",
            clauses[1],
        )
        return [r["user_id"] for r in rows]


def _json_ids(ids: list[int]) -> str:
    return "[" + ",".join(str(int(i)) for i in ids) + "]"
