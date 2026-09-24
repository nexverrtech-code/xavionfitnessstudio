"""/api/me — the member app. Everything is scoped to the signed-in member (never a client id)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from core.errors import NotFound
from repositories.plans import PlanRepository
from schemas.requests import ProfileUpdate, UpiSubmission
from services.attendance_service import AttendanceService
from services.context import Ctx
from services.member_service import MemberService
from services.payment_service import PaymentService
from services.plan_service import PlanService
from services.portal_service import PortalService
from services.progress_service import ProgressService
from services.workout_service import WorkoutService

from .contexts import member_ctx
from .deps import Page, pagination
from .members import month_range
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/me", tags=["member app"])


def _portal(ctx: Ctx) -> PortalService:
    return PortalService(ctx, ctx.user.member_id)


@router.get("/overview")
async def overview(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await _portal(ctx).overview())


@router.get("/profile")
async def profile(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await _portal(ctx).profile())


@router.put("/profile")
async def update_profile(body: ProfileUpdate, ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await _portal(ctx).update_profile(email=body.email, address=body.address, emergency_contact=body.emergency_contact))


@router.get("/membership")
async def membership(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await _portal(ctx).membership())


@router.get("/plans")
async def plans(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok({"items": await PlanService(ctx).list(include_inactive=False)})


@router.get("/upi")
async def upi_details(plan_id: int, ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    plan = await PlanRepository(ctx.db).get(plan_id)
    if not plan or plan["status"] != "ACTIVE":
        raise NotFound("Plan not found.")
    member = await _portal(ctx).profile()
    return ok(await PaymentService(ctx).upi_details(member_code=member["member_code"], plan=plan))


@router.post("/renewals", status_code=201)
async def submit_renewal(body: UpiSubmission, ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    """Member paid the gym's UPI ID and submits the UTR -> PENDING until staff verify it."""
    return ok(await PaymentService(ctx).submit_upi(ctx.user.member_id, body.plan_id, body.utr), status=201)


@router.get("/renewals/pending")
async def pending(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok({"payment": await _portal(ctx).pending()})


@router.delete("/renewals/pending", status_code=204)
async def withdraw(ctx: Ctx = Depends(member_ctx)) -> Response:
    await PaymentService(ctx).withdraw(ctx.user.member_id)
    return no_content()


@router.get("/payments")
async def payments(page: Page = Depends(pagination(20, 100)), ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await _portal(ctx).payments(page))


@router.get("/payments/{payment_id}/receipt")
async def receipt(payment_id: int, ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await PaymentService(ctx).receipt(payment_id, member_scope=ctx.user.member_id))


@router.get("/attendance")
async def attendance(month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    start, end = month_range(ctx, month)
    return ok(await AttendanceService(ctx).member_history(ctx.user.member_id, start, end))


@router.get("/workouts")
async def workouts(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok({"items": await WorkoutService(ctx).for_member(ctx.user.member_id)})


@router.get("/progress")
async def progress(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await ProgressService(ctx).for_member(ctx.user.member_id))


@router.get("/qr")
async def qr(ctx: Ctx = Depends(member_ctx)) -> FastJSON:
    return ok(await MemberService(ctx).qr(ctx.user.member_id))
