"""/api/expenses — gym expenses (admin only)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from core.errors import ValidationFailed
from schemas.requests import ExpenseIn
from services.context import Ctx
from services.expense_service import ExpenseService

from .contexts import admin_ctx
from .deps import Page, pagination
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("")
async def list_expenses(
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    category: str | None = Query(None, pattern="^(RENT|ELECTRICITY|SALARY|EQUIPMENT|MAINTENANCE|MARKETING|OTHER)$"),
    page: Page = Depends(pagination(20, 100)),
    ctx: Ctx = Depends(admin_ctx),
) -> FastJSON:
    today = ctx.clock.today()
    start, end = from_ or today.replace(day=1), to or today
    if end < start:
        raise ValidationFailed("The end date must be on or after the start date.", fields={"to": "Must be after the start date"})
    return ok(await ExpenseService(ctx).list(page, start=start, end=end, category=category))


@router.post("", status_code=201)
async def create(body: ExpenseIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await ExpenseService(ctx).create(body.model_dump()), status=201)


@router.put("/{expense_id}")
async def update(expense_id: int, body: ExpenseIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await ExpenseService(ctx).update(expense_id, body.model_dump()))


@router.delete("/{expense_id}", status_code=204)
async def delete(expense_id: int, ctx: Ctx = Depends(admin_ctx)) -> Response:
    await ExpenseService(ctx).delete(expense_id)
    return no_content()
