"""/api/workouts — workout plans (admins and trainers; trainers only for assigned members)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from schemas.requests import CopyWorkoutIn, WorkoutIn, WorkoutUpdate
from services.context import Ctx
from services.workout_service import WorkoutService

from .contexts import coach_ctx
from .deps import Page, ensure_member_access, pagination
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/workouts", tags=["workouts"])


@router.get("")
async def recent(page: Page = Depends(pagination(20, 100)), ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    trainer = ctx.user.trainer_id if ctx.user.role == "TRAINER" else None
    return ok(await WorkoutService(ctx).recent(page, trainer_id=trainer))


@router.get("/{plan_id}")
async def get_workout(plan_id: int, ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    service = WorkoutService(ctx)
    await ensure_member_access(ctx.db, ctx.user, await service.member_of(plan_id))
    return ok(await service.get(plan_id))


@router.post("", status_code=201)
async def create(body: WorkoutIn, ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, body.member_id)
    values = body.model_dump(exclude={"member_id"})
    return ok(await WorkoutService(ctx).create(body.member_id, values), status=201)


@router.put("/{plan_id}")
async def update(plan_id: int, body: WorkoutUpdate, ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    service = WorkoutService(ctx)
    await ensure_member_access(ctx.db, ctx.user, await service.member_of(plan_id))
    return ok(await service.update(plan_id, body.model_dump()))


@router.post("/{plan_id}/copy", status_code=201)
async def copy(plan_id: int, body: CopyWorkoutIn, ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    service = WorkoutService(ctx)
    await ensure_member_access(ctx.db, ctx.user, await service.member_of(plan_id))
    await ensure_member_access(ctx.db, ctx.user, body.member_id)
    return ok(await service.copy(plan_id, body.member_id), status=201)


@router.delete("/{plan_id}", status_code=204)
async def delete(plan_id: int, ctx: Ctx = Depends(coach_ctx)) -> Response:
    service = WorkoutService(ctx)
    await ensure_member_access(ctx.db, ctx.user, await service.member_of(plan_id))
    await service.delete(plan_id)
    return no_content()
