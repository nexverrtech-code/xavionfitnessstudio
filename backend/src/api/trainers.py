"""/api/trainers — trainer profiles, status, logins and member assignment."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from schemas.requests import TrainerIn, TrainerMembersIn, TrainerStatusIn
from services.context import Ctx
from services.trainer_service import TrainerService

from .contexts import admin_ctx, staff_ctx
from .deps import Page, pagination
from .responses import FastJSON, ok

router = APIRouter(prefix="/trainers", tags=["trainers"])


@router.get("")
async def list_trainers(status: str | None = Query(None, pattern="^(ACTIVE|INACTIVE)$"), ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    # Staff need the active list to assign trainers; profiles are managed by admins.
    if ctx.user.role == "STAFF":
        status = "ACTIVE"
    return ok({"items": await TrainerService(ctx).list(status=status)})


@router.post("", status_code=201)
async def create(body: TrainerIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).create(body.model_dump()), status=201)


@router.get("/{trainer_id}")
async def get_trainer(trainer_id: int, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).get(trainer_id))


@router.put("/{trainer_id}")
async def update(trainer_id: int, body: TrainerIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).update(trainer_id, body.model_dump()))


@router.post("/{trainer_id}/status")
async def set_status(trainer_id: int, body: TrainerStatusIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).set_status(trainer_id, body.status))


@router.post("/{trainer_id}/account")
async def enable_login(trainer_id: int, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).enable_login(trainer_id))


@router.get("/{trainer_id}/members")
async def assigned_members(trainer_id: int, page: Page = Depends(pagination(50, 100)), ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).assigned_members(trainer_id, page))


@router.post("/{trainer_id}/members")
async def assign_members(trainer_id: int, body: TrainerMembersIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await TrainerService(ctx).assign_members(trainer_id, body.member_ids))
