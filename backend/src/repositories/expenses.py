"""ExpenseRepository: gym expenses (rent, electricity, salary ...)."""

from __future__ import annotations

from typing import Any

from .base import Repository, count_of

EXPENSE_COLUMNS = "e.id, e.category, e.amount, e.description, e.expense_date, e.created_by, e.created_at, e.updated_at"


class ExpenseRepository(Repository):
    async def list(self, *, start: str, end: str, category: str | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int, int, list[dict[str, Any]]]:
        params: list[Any] = [start, end]
        clause = ""
        if category:
            params.append(category)
            clause = " AND e.category = ?3"
        n = len(params)
        rows, totals, by_category = await self.db.batch(
            [
                (
                    f"SELECT {EXPENSE_COLUMNS}, u.name AS created_by_name FROM expenses e LEFT JOIN users u ON u.id = e.created_by "
                    f"WHERE e.expense_date BETWEEN ?1 AND ?2{clause} ORDER BY e.expense_date DESC, e.id DESC "
                    f"LIMIT ?{n + 1} OFFSET ?{n + 2}",
                    [*params, limit, offset],
                ),
                (
                    f"SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total FROM expenses e WHERE e.expense_date BETWEEN ?1 AND ?2{clause}",
                    params,
                ),
                (
                    "SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses "
                    "WHERE expense_date BETWEEN ?1 AND ?2 GROUP BY category ORDER BY total DESC",
                    params[:2],
                ),
            ]
        )
        first = totals.first or {}
        return rows.rows, count_of(totals), int(first.get("total") or 0), by_category.rows

    async def insert(self, values: dict[str, Any], created_by: int | None, now: str) -> dict[str, Any]:
        return await self.db.one(
            "INSERT INTO expenses (category, amount, description, expense_date, created_by, created_at, updated_at) "
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id, category, amount, description, expense_date, created_by, created_at, updated_at",
            [values["category"], values["amount"], values.get("description"), values["expense_date"], created_by, now],
        )

    async def update(self, expense_id: int, values: dict[str, Any], now: str) -> dict[str, Any] | None:
        return await self.db.one(
            "UPDATE expenses SET category = ?2, amount = ?3, description = ?4, expense_date = ?5, updated_at = ?6 WHERE id = ?1 "
            "RETURNING id, category, amount, description, expense_date, created_by, created_at, updated_at",
            [expense_id, values["category"], values["amount"], values.get("description"), values["expense_date"], now],
        )

    async def delete(self, expense_id: int) -> int:
        return (await self.db.run("DELETE FROM expenses WHERE id = ?1", [expense_id])).changes
