"""/api/users — team accounts (admin only). Trainer and member logins are managed from their
own records (/api/trainers/{id}/account, /api/members/{id}/app-access)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from schemas.requests import TeamUserIn, TeamUserUpdate, UserStatusIn
from services.context import Ctx
from services.user_service import UserService

from .contexts import admin_ctx
from .responses import FastJSON, ok

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
async def list_team(ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok({"items": await UserService(ctx).list_team()})


@router.post("", status_code=201)
async def create(body: TeamUserIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await UserService(ctx).create_team_user(name=body.name, email=body.email, phone=body.phone, role=body.role), status=201)


@router.put("/{user_id}")
async def update(user_id: int, body: TeamUserUpdate, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await UserService(ctx).update_team_user(user_id, name=body.name, email=body.email, phone=body.phone))


@router.post("/{user_id}/status")
async def set_status(user_id: int, body: UserStatusIn, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await UserService(ctx).set_status(user_id, body.status))


@router.post("/{user_id}/reset-password")
async def reset_password(user_id: int, ctx: Ctx = Depends(admin_ctx)) -> FastJSON:
    return ok(await UserService(ctx).reset_password(user_id))
