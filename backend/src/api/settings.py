"""/api/settings (admin) and /api/config (public gym profile for the login screen)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends

from services import settings_service
from services.context import Ctx

from .contexts import admin_ctx, public_ctx
from .responses import FastJSON, ok

router = APIRouter(tags=["settings"])


@router.get("/config")
async def public_config(ctx: Ctx = Depends(public_ctx)) -> FastJSON:
    settings = await ctx.settings()
    return ok(
        {
            "gym_name": settings["gym_name"],
            "currency": settings["currency"],
            "member_code_prefix": settings["member_code_prefix"],
            "timezone": ctx.config.gym_timezone,
        },
        cache_seconds=300,
        public=True,
    )


@router.get("/settings")
async def get_settings(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await ctx.settings())


@router.put("/settings")
async def update_settings(changes: dict[str, Any] = Body(...), ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await settings_service.update_settings(ctx.db, ctx.clock, changes))
