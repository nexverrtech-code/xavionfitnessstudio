"""/api/members — registration, search, lists and the member workspace."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from core.clock import add_months
from core.errors import ValidationFailed
from schemas.requests import AppAccessIn, AssignTrainerIn, MemberCreate, MemberStatusIn, MemberUpdate
from services.attendance_service import AttendanceService
from services.context import Ctx
from services.member_service import MemberService
from services.membership_service import MembershipService
from services.payment_service import PaymentService
from services.workout_service import WorkoutService

from .deps import Page, ensure_member_access, pagination
from .contexts import staff_ctx, team_ctx
from .payments import date_range
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/members", tags=["members"])


def _trainer_scope(ctx: Ctx) -> int | None:
    return ctx.user.trainer_id if ctx.user and ctx.user.role == "TRAINER" else None


@router.get("/search")
async def search(q: str = Query(..., min_length=1, max_length=60), ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    return ok({"items": await MemberService(ctx).search(q, trainer_id=_trainer_scope(ctx))})


@router.get("")
async def list_members(
    q: str | None = Query(None, max_length=60),
    status: str | None = Query(None, pattern="^(ACTIVE|EXPIRING|EXPIRED|SUSPENDED|INACTIVE)$"),
    trainer_id: int | None = None,
    sort: str = Query("newest", pattern="^(newest|name|code)$"),
    page: Page = Depends(pagination(20, 100)),
    ctx: Ctx = Depends(team_ctx),
) -> FastJSON:
    scope = _trainer_scope(ctx) or trainer_id
    return ok(await MemberService(ctx).list(page, q=q, status=status, trainer_id=scope, sort=sort))


@router.post("", status_code=201)
async def create(body: MemberCreate, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    values = body.model_dump(exclude={"create_app_login"})
    return ok(await MemberService(ctx).create(values, create_app_login=body.create_app_login), status=201)


@router.get("/{member_id}")
async def workspace(member_id: int, ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, member_id)
    return ok(await MemberService(ctx).workspace(member_id, include_finance=ctx.user.is_staff))


@router.put("/{member_id}")
async def update(member_id: int, body: MemberUpdate, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await MemberService(ctx).update(member_id, body.model_dump()))


@router.post("/{member_id}/status")
async def set_status(member_id: int, body: MemberStatusIn, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await MemberService(ctx).set_status(member_id, body.action))


@router.post("/{member_id}/trainer")
async def assign_trainer(member_id: int, body: AssignTrainerIn, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await MemberService(ctx).assign_trainer(member_id, body.trainer_id))


@router.get("/{member_id}/memberships")
async def memberships(member_id: int, ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, member_id)
    return ok({"items": await MembershipService(ctx).for_member(member_id)})


@router.get("/{member_id}/payments")
async def payments(
    member_id: int,
    period: str | None = Query(None, pattern="^(today|week|month|custom)$"),
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    page: Page = Depends(pagination(20, 100)),
    ctx: Ctx = Depends(staff_ctx),
) -> FastJSON:
    start, end = date_range(ctx, period, from_, to)
    return ok(await PaymentService(ctx).list(page, start=start, end=end, status=None, method=None, member_id=member_id, q=None))


@router.get("/{member_id}/attendance")
async def attendance(member_id: int, month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, member_id)
    start, end = month_range(ctx, month)
    return ok(await AttendanceService(ctx).member_history(member_id, start, end))


@router.get("/{member_id}/workouts")
async def workouts(member_id: int, include_archived: bool = False, ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, member_id)
    return ok({"items": await WorkoutService(ctx).for_member(member_id, include_archived=include_archived)})


@router.get("/{member_id}/activity")
async def activity(member_id: int, ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, member_id)
    return ok({"items": await MemberService(ctx).activity(member_id, include_finance=ctx.user.is_staff)})


@router.get("/{member_id}/qr")
async def qr(member_id: int, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await MemberService(ctx).qr(member_id))


@router.post("/{member_id}/qr/reset")
async def reset_qr(member_id: int, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await MemberService(ctx).reset_qr(member_id))


@router.post("/{member_id}/app-access")
async def enable_app(member_id: int, body: AppAccessIn | None = None, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    """Give, reset or re-enable the member's app login (the member can't sign in before this)."""
    body = body or AppAccessIn()
    return ok(await MemberService(ctx).enable_app(member_id, password=body.password, must_change=body.must_change_password))


@router.delete("/{member_id}/app-access", status_code=204)
async def disable_app(member_id: int, ctx: Ctx = Depends(staff_ctx)) -> Response:
    await MemberService(ctx).disable_app(member_id)
    return no_content()


def month_range(ctx: Ctx, month: str | None) -> tuple[date, date]:
    today = ctx.clock.today()
    if month:
        try:
            start = date.fromisoformat(month + "-01")
        except ValueError:
            raise ValidationFailed("Choose a valid month.") from None
    else:
        start = today.replace(day=1)
    end = add_months(start, 1) - timedelta(days=1)
    return start, end
