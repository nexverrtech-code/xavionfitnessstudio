"""/api/backups — downloadable backups, verified archiving and restore (ADMIN only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from schemas.requests import ArchiveIn, BackupCreateIn, BackupVerifyIn, RestoreApplyIn, RestoreCheckIn, RestoreCompleteIn
from services.backup_service import BackupService
from services.context import Ctx

from .contexts import admin_ctx
from .responses import FastJSON, ok, raw_json

router = APIRouter(prefix="/backups", tags=["backups"])


@router.get("")
async def history(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    service = BackupService(ctx)
    return ok({"options": service.options(), "items": await service.history()})


@router.post("", status_code=201)
async def create(body: BackupCreateIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).create(body.datasets, body.period_from, body.period_to), status=201)


@router.get("/{backup_id}")
async def get_backup(backup_id: int, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).get(backup_id))


@router.get("/{backup_id}/data")
async def export_page(
    backup_id: int,
    table: str = Query(..., min_length=3, max_length=40),
    after: int = Query(0, ge=0),
    ctx: Ctx = Depends(admin_ctx),
) -> Response:
    """One page of rows (JSON array, id order). The browser keeps requesting with ``after`` =
    the last id until a short page arrives."""
    rows = await BackupService(ctx).export_page(backup_id, table, after)
    return raw_json(rows.text)


@router.post("/{backup_id}/verify")
async def verify(backup_id: int, body: BackupVerifyIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).verify(backup_id, file_name=body.file_name, checksum=body.checksum, counts=body.counts))


@router.post("/{backup_id}/archive")
async def archive(backup_id: int, body: ArchiveIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).archive(backup_id))


@router.post("/{backup_id}/cancel")
async def cancel(backup_id: int, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).cancel(backup_id))


@router.post("/restore/check")
async def restore_check(body: RestoreCheckIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).restore_check(body.table, body.ids))


@router.post("/restore/apply")
async def restore_apply(body: RestoreApplyIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await BackupService(ctx).restore_apply(body.table, body.rows))


@router.post("/restore/complete", status_code=201)
async def restore_complete(body: RestoreCompleteIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(
        await BackupService(ctx).restore_complete(
            file_name=body.file_name, backup_created_at=body.backup_created_at, inserted=body.inserted, skipped=body.skipped,
            datasets=body.datasets,
        ),
        status=201,
    )
