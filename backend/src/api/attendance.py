"""/api/attendance — QR scans, manual check-in, the daily log and trends."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from core.errors import ValidationFailed
from schemas.requests import MarkAttendanceIn, ScanIn
from services.attendance_service import AttendanceService
from services.context import Ctx

from .contexts import staff_ctx, team_ctx
from .deps import Page, ensure_member_access, pagination
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("/scan")
async def scan(body: ScanIn, ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    return ok(await AttendanceService(ctx).scan(body.code))


@router.post("")
async def mark(body: MarkAttendanceIn, ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    await ensure_member_access(ctx.db, ctx.user, body.member_id)
    return ok(await AttendanceService(ctx).mark(body.member_id))


@router.get("")
async def day_log(day: date | None = Query(None, alias="date"), page: Page = Depends(pagination(50, 100)),
                  ctx: Ctx = Depends(team_ctx)) -> FastJSON:
    trainer = ctx.user.trainer_id if ctx.user.role == "TRAINER" else None
    return ok(await AttendanceService(ctx).day_log(page, day or ctx.clock.today(), trainer_id=trainer))


@router.get("/trend")
async def trend(days: int = Query(30, ge=7, le=90), ctx: Ctx = Depends(staff_ctx)) -> FastJSON:
    today = ctx.clock.today()
    if days > 90:
        raise ValidationFailed("Choose up to 90 days.")
    return ok({"items": await AttendanceService(ctx).daily_counts(today - timedelta(days=days - 1), today)})


@router.delete("/{attendance_id}", status_code=204)
async def delete_entry(attendance_id: int, ctx: Ctx = Depends(staff_ctx)) -> Response:
    await AttendanceService(ctx).delete_entry(attendance_id)
    return no_content()
