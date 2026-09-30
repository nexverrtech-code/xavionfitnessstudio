"""/api/messages — automatic WhatsApp / email: status, recent deliveries and a test send (admin)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends

from schemas.common import Model
from services.context import Ctx
from services.message_service import MessageService

from .contexts import admin_ctx
from .responses import FastJSON, ok

router = APIRouter(prefix="/messages", tags=["messages"])


class TestMessageIn(Model):
    channel: Literal["WHATSAPP", "EMAIL"]
    to: str


@router.get("")
async def overview(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await MessageService(ctx).overview())


@router.post("/test")
async def send_test(body: TestMessageIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await MessageService(ctx).send_test(body.channel, body.to[:120]))
