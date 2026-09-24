"""/api/auth — sign in, session, password change and first-run setup."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from schemas.requests import ChangePasswordIn, LoginIn, SetupIn
from services.auth_service import AuthService
from services.context import Ctx

from .contexts import public_ctx, temp_ctx
from .responses import FastJSON, no_content, ok

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")


@router.post("/login")
async def login(body: LoginIn, request: Request, ctx: Ctx = Depends(public_ctx)) -> FastJSON:
    return ok(await AuthService(ctx).login(body.identifier, body.password, body.remember, _client_ip(request)))


@router.get("/me")
async def me(ctx: Ctx = Depends(temp_ctx)) -> FastJSON:
    return ok(await AuthService(ctx).me(ctx.user))


@router.post("/change-password")
async def change_password(body: ChangePasswordIn, ctx: Ctx = Depends(temp_ctx)) -> FastJSON:
    return ok(await AuthService(ctx).change_password(ctx.user, body.current_password, body.new_password))


@router.post("/logout-all", status_code=204)
async def logout_all(ctx: Ctx = Depends(temp_ctx)) -> Response:
    await AuthService(ctx).logout_everywhere(ctx.user)
    return no_content()


@router.get("/setup-status")
async def setup_status(ctx: Ctx = Depends(public_ctx)) -> FastJSON:
    return ok(await AuthService(ctx).setup_status())


@router.post("/setup", status_code=201)
async def setup(body: SetupIn, ctx: Ctx = Depends(public_ctx)) -> FastJSON:
    return ok(await AuthService(ctx).setup_first_admin(body.setup_token, body.name, body.email, body.password), status=201)
