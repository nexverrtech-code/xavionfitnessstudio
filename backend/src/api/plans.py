"""/api/membership-plans — admin-defined plans (Monthly, Quarterly, Half Yearly, Yearly, custom)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from schemas.requests import PlanIn
from services.context import Ctx
from services.plan_service import PlanService

from .contexts import admin_ctx, staff_ctx
from .responses import FastJSON, ok

router = APIRouter(prefix="/membership-plans", tags=["membership plans"])


@router.get("")
async def list_plans(include_inactive: bool = False, stats: bool = False, ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    return ok({"items": await PlanService(ctx).list(include_inactive=include_inactive, with_stats=stats)})


@router.post("", status_code=201)
async def create(body: PlanIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await PlanService(ctx).save(body.model_dump()), status=201)


@router.put("/{plan_id}")
async def update(plan_id: int, body: PlanIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await PlanService(ctx).save(body.model_dump(), plan_id))
