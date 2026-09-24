"""/api/payments — record, verify (approve / reject), refund and list payments; receipts."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, Query

from core.errors import NotFound, ValidationFailed
from repositories.members import MemberRepository
from repositories.plans import PlanRepository
from schemas.requests import DeskPaymentIn, RefundIn, RejectPaymentIn
from services.context import Ctx
from services.payment_service import PaymentService

from .contexts import admin_ctx, staff_ctx
from .deps import Page, pagination
from .responses import FastJSON, ok

router = APIRouter(prefix="/payments", tags=["payments"])


def date_range(ctx: Ctx, period: str | None, start: date | None, end: date | None) -> tuple[str | None, str | None]:
    """Today / This week / This month / Custom date (inclusive, gym-local dates)."""
    today = ctx.clock.today()
    if period == "today":
        return today.isoformat(), today.isoformat()
    if period == "week":
        return (today - timedelta(days=today.weekday())).isoformat(), today.isoformat()
    if period == "month":
        return today.replace(day=1).isoformat(), today.isoformat()
    if start and end and end < start:
        raise ValidationFailed("The end date must be on or after the start date.", fields={"to": "Must be after the start date"})
    return (start.isoformat() if start else None), (end.isoformat() if end else None)


@router.get("")
async def list_payments(
    period: str | None = Query(None, pattern="^(today|week|month|custom)$"),
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    status: str | None = Query(None, pattern="^(PENDING|PAID|REJECTED|FAILED|REFUNDED)$"),
    method: str | None = Query(None, pattern="^(CASH|UPI|BANK_TRANSFER|CARD_MANUAL)$"),
    member_id: int | None = None,
    q: str | None = Query(None, max_length=64),
    page: Page = Depends(pagination(20, 100)),
    ctx: Ctx = Depends(staff_ctx),
) -> FastJSON:
    start, end = date_range(ctx, period, from_, to)
    return ok(await PaymentService(ctx).list(page, start=start, end=end, status=status, method=method, member_id=member_id, q=q))


@router.get("/pending")
async def pending(page: Page = Depends(pagination(20, 100)), ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).pending(page))


@router.get("/summary")
async def summary(ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).summary())


@router.get("/upi")
async def upi_details(member_id: int, plan_id: int, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    """The gym's UPI QR for a member paying at the desk (amount + note pre-filled)."""
    member, plan = await MemberRepository(ctx.db).basic(member_id), await PlanRepository(ctx.db).get(plan_id)
    if not member or not plan:
        raise NotFound("Member or plan not found.")
    return ok(await PaymentService(ctx).upi_details(member_code=member["member_code"], plan=plan))


@router.post("", status_code=201)
async def record(
    body: DeskPaymentIn,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key", min_length=8, max_length=64),
    ctx: Ctx = Depends(staff_ctx),
) -> FastJSON:
    result = await PaymentService(ctx).record(body.model_dump(), idempotency_key)
    return ok(result, status=200 if result["replayed"] else 201)


@router.get("/{payment_id}")
async def get_payment(payment_id: int, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).get(payment_id))


@router.post("/{payment_id}/approve")
async def approve(payment_id: int, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).approve(payment_id))


@router.post("/{payment_id}/reject")
async def reject(payment_id: int, body: RejectPaymentIn, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).reject(payment_id, body.reason, body.status))


@router.post("/{payment_id}/refund")
async def refund(payment_id: int, body: RefundIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).refund(payment_id, body.model_dump()))


@router.get("/{payment_id}/receipt")
async def receipt(payment_id: int, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).receipt(payment_id))
