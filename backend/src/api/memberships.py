"""/api/memberships — lists, renewal follow-ups, date previews and cancellation.

Memberships are created by confirmed payments (POST /api/payments or approving a UPI payment).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from services.context import Ctx
from services.membership_service import MembershipService

from .contexts import admin_ctx, staff_ctx
from .deps import Page, pagination
from .responses import FastJSON, ok

router = APIRouter(prefix="/memberships", tags=["memberships"])


@router.get("")
async def list_memberships(
    status: str | None = Query(None, pattern="^(ACTIVE|EXPIRING|EXPIRED|UPCOMING|CANCELLED)$"),
    plan_id: int | None = None,
    page: Page = Depends(pagination(20, 100)),
    ctx: Ctx = Depends(staff_ctx),
) -> FastJSON:
    return ok(await MembershipService(ctx).list(page, status=status, plan_id=plan_id))


@router.get("/renewals")
async def renewals(
    window: str = Query("upcoming", pattern="^(upcoming|expired)$"),
    page: Page = Depends(pagination(20, 100)),
    ctx: Ctx = Depends(staff_ctx),
) -> FastJSON:
    return ok(await MembershipService(ctx).renewals_due(page, window=window))


@router.get("/preview")
async def preview(member_id: int, plan_id: int, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await MembershipService(ctx).preview(member_id, plan_id))


@router.post("/{membership_id}/cancel")
async def cancel(membership_id: int, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await MembershipService(ctx).cancel(membership_id))
