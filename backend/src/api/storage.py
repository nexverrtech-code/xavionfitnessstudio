"""/api/storage — database usage monitoring and D1 Time Travel (ADMIN only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from schemas.requests import TimeTravelIn
from services.backup_service import BackupService
from services.context import Ctx
from services.storage_service import StorageService

from .contexts import admin_ctx
from .responses import FastJSON, ok

router = APIRouter(prefix="/storage", tags=["storage"])


@router.get("")
async def overview(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await StorageService(ctx).overview())


@router.post("/refresh")
async def refresh(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await StorageService(ctx).refresh())


@router.get("/time-travel")
async def time_travel(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(BackupService(ctx).time_travel_info())


@router.post("/time-travel/restore")
async def time_travel_restore(body: TimeTravelIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).time_travel_restore(body.timestamp))
