"""/api/settings (admin), /api/config (public gym profile) and /api/manifest.webmanifest.

The gym profile and the web-app manifest are read fresh (never from the per-isolate cache and
never cached by browsers), so a new gym name shows everywhere as soon as it is saved.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import Response

from services import settings_service
from services.context import Ctx

from .contexts import admin_ctx, public_ctx
from .responses import FastJSON, ok

router = APIRouter(tags=["settings"])

ICONS = [
    {"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    {"src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
]


def short_name(name: str) -> str:
    """Home-screen label: the whole name when it fits (12 characters), else its first word."""
    if len(name) <= 12:
        return name
    first = name.split()[0]
    return first if len(first) <= 12 else name[:12].rstrip()


def web_app_manifest(gym_name: str) -> dict[str, Any]:
    return {
        "name": gym_name,
        "short_name": short_name(gym_name),
        "description": f"{gym_name}: membership, QR check-in, UPI renewals, workouts and progress.",
        "id": "/",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "display_override": ["standalone", "minimal-ui"],
        "background_color": "#0a0b0e",
        "theme_color": "#16181d",
        "categories": ["fitness", "business", "productivity"],
        "icons": ICONS,
        "shortcuts": [
            {"name": "Scan attendance", "short_name": "Scan", "url": "/attendance", "icons": [ICONS[0]]},
            {"name": "My QR", "short_name": "My QR", "url": "/portal/qr", "icons": [ICONS[0]]},
        ],
    }


@router.get("/config")
async def public_config(ctx: Ctx = Depends(public_ctx)) -> FastJSON:
    settings = await settings_service.get_settings(ctx.db, fresh=True)
    return ok(
        {
            "gym_name": settings["gym_name"],
            "currency": settings["currency"],
            "member_code_prefix": settings["member_code_prefix"],
            "timezone": ctx.config.gym_timezone,
        }
    )


@router.get("/manifest.webmanifest", include_in_schema=False)
async def manifest(ctx: Ctx = Depends(public_ctx)) -> Response:
    """The installable app carries the gym's own name (browsers re-read it now and then)."""
    settings = await settings_service.get_settings(ctx.db, fresh=True)
    body = json.dumps(web_app_manifest(settings["gym_name"]), ensure_ascii=False, separators=(",", ":"))
    return Response(content=body.encode("utf-8"), media_type="application/manifest+json", headers={"Cache-Control": "public, max-age=600"})


@router.get("/settings")
async def get_settings(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await settings_service.get_settings(ctx.db, fresh=True))


@router.put("/settings")
async def update_settings(changes: dict[str, Any] = Body(...), ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await settings_service.update_settings(ctx.db, ctx.clock, changes))
