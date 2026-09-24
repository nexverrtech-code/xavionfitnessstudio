"""/api/notifications — in-app notifications: everyone's inbox, admin log and announcements."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from schemas.requests import AnnouncementIn
from services.context import Ctx
from services.notification_service import NotificationService

from .contexts import admin_ctx, any_ctx
from .deps import Page, pagination
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/inbox")
async def inbox(ctx: Ctx = Depends(any_ctx)) -> FastJSON:
    return ok(await NotificationService(ctx).inbox(ctx.user.id))


@router.get("/unread")
async def unread(ctx: Ctx = Depends(any_ctx)) -> FastJSON:
    return ok({"unread": await NotificationService(ctx).unread(ctx.user.id)})


@router.post("/read-all", status_code=204)
async def read_all(ctx: Ctx = Depends(any_ctx)) -> Response:
    await NotificationService(ctx).mark_read(ctx.user.id)
    return no_content()


@router.post("/{notification_id}/read", status_code=204)
async def read_one(notification_id: int, ctx: Ctx = Depends(any_ctx)) -> Response:
    await NotificationService(ctx).mark_read(ctx.user.id, notification_id)
    return no_content()


@router.get("")
async def log(
    kind: str | None = Query(None, alias="type", max_length=30),
    status: str | None = Query(None, pattern="^(UNREAD|READ)$"),
    member_id: int | None = None,
    days: int = Query(30, ge=1, le=365),
    page: Page = Depends(pagination(20, 100)),
    ctx: Ctx = Depends(admin_ctx),
) -> FastJSON:
    return ok(await NotificationService(ctx).log(page, kind=kind, status=status, member_id=member_id, days=days))


@router.post("/send")
async def send(body: AnnouncementIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await NotificationService(ctx).announce(member_ids=body.member_ids, segment=body.segment, message=body.message))


@router.post("/run-reminders")
async def run_reminders(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await NotificationService(ctx).run_reminders())
