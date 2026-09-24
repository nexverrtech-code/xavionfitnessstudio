"""/api/dashboard — admin / staff KPIs, charts and activity, and the trainer dashboard."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from services.context import Ctx
from services.dashboard_service import DashboardService
from services.trainer_service import TrainerService

from .contexts import staff_ctx, trainer_ctx
from .responses import FastJSON, ok

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
async def summary(ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await DashboardService(ctx).summary())


@router.get("/charts")
async def charts(months: int = Query(6, ge=3, le=12), ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok(await DashboardService(ctx).charts(months))


@router.get("/activity")
async def activity(ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok({"items": await DashboardService(ctx).activity()})


@router.get("/trainer")
async def trainer_dashboard(ctx: Ctx = Depends(trainer_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).dashboard(ctx.user.trainer_id))
