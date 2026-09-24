"""/api/progress — body measurements and progress (admins and trainers)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from schemas.requests import MeasurementIn
from services.context import Ctx
from services.progress_service import ProgressService

from .contexts import coach_ctx
from .deps import Page, ensure_member_access, pagination
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/progress", tags=["progress"])


@router.get("")
async def recent(page: Page = Depends(pagination(20, 100)), ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    trainer = ctx.user.trainer_id if ctx.user.role == "TRAINER" else None
    return ok(await ProgressService(ctx).recent(page, trainer_id=trainer))


@router.get("/{member_id}")
async def member_progress(member_id: int, ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, member_id)
    return ok(await ProgressService(ctx).for_member(member_id))


@router.post("/{member_id}", status_code=201)
async def record(member_id: int, body: MeasurementIn, ctx: Ctx = Depends(coach_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, member_id)
    return ok(await ProgressService(ctx).record(member_id, body.model_dump()), status=201)


@router.delete("/entries/{measurement_id}", status_code=204)
async def delete(measurement_id: int, ctx: Ctx = Depends(coach_ctx)) -> Response:
    service = ProgressService(ctx)
    await ensure_member_access(ctx.db, ctx.user, await service.member_of(measurement_id))
    await service.delete(measurement_id)
    return no_content()
