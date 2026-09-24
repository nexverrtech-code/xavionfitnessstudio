"""ExpenseService: rent, electricity, salary, equipment, maintenance, marketing and other costs."""

from __future__ import annotations

from datetime import date
from typing import Any

from core.clock import iso_z
from core.errors import NotFound, ValidationFailed
from repositories.expenses import ExpenseRepository

from .context import Ctx


def expense_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "category": row["category"],
        "amount": row["amount"],
        "description": row.get("description"),
        "expense_date": row["expense_date"],
        "created_by_name": row.get("created_by_name"),
        "created_at": iso_z(row.get("created_at")),
    }


class ExpenseService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.expenses = ExpenseRepository(ctx.db)

    def _date(self, value: date | None) -> str:
        chosen = value or self.ctx.clock.today()
        if chosen > self.ctx.clock.today():
            raise ValidationFailed("Expense date can't be in the future.", fields={"expense_date": "Can't be in the future"})
        return chosen.isoformat()

    async def list(self, page, *, start: date, end: date, category: str | None) -> dict[str, Any]:
        rows, total, amount, by_category = await self.expenses.list(
            start=start.isoformat(), end=end.isoformat(), category=category, limit=page.limit, offset=page.offset
        )
        result = page.wrap([expense_out(r) for r in rows], total)
        result.update({"total_amount": amount, "by_category": by_category})
        return result

    async def create(self, values: dict[str, Any]) -> dict[str, Any]:
        row = await self.expenses.insert({**values, "expense_date": self._date(values.get("expense_date"))}, self.ctx.actor_id, self.ctx.now)
        return expense_out(row)

    async def update(self, expense_id: int, values: dict[str, Any]) -> dict[str, Any]:
        row = await self.expenses.update(expense_id, {**values, "expense_date": self._date(values.get("expense_date"))}, self.ctx.now)
        if not row:
            raise NotFound("Expense not found.")
        return expense_out(row)

    async def delete(self, expense_id: int) -> None:
        if not await self.expenses.delete(expense_id):
            raise NotFound("Expense not found.")
