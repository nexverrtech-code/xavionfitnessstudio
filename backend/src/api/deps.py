"""FastAPI dependencies: database, config, clock, authentication, role checks and pagination.

Frontend route guards are only UX — every endpoint re-checks the role here, and member /
trainer data access is scoped server-side from the authenticated user, never from a
client-supplied id.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Query, Request

from core.clock import Clock
from core.config import AppConfig
from core.database import Database
from core.errors import Forbidden, NotFound, Unauthorized
from models.domain import ROLE_BY_ID
from models.session import CurrentUser
from repositories.members import MemberRepository
from repositories.users import UserRepository
from security.tokens import TokenError, decode_token
from services.auth_service import session_cache


def get_db(request: Request) -> Database:
    return request.state.db


def get_config(request: Request) -> AppConfig:
    return request.state.config


_clocks: dict[int, Clock] = {}


def get_clock(config: AppConfig = Depends(get_config)) -> Clock:
    clock = _clocks.get(config.gym_utc_offset_minutes)
    if clock is None:
        clock = _clocks[config.gym_utc_offset_minutes] = Clock(config.gym_utc_offset_minutes)
    return clock


async def _session_row(db: Database, user_id: int) -> dict[str, Any] | None:
    cached = session_cache.get(user_id)
    if cached is not None:
        return cached
    row = await UserRepository(db).session_user(user_id)
    if row:
        session_cache.set(user_id, row)
    return row


async def _authenticate(request: Request) -> CurrentUser:
    header = request.headers.get("authorization") or ""
    if not header.lower().startswith("bearer "):
        raise Unauthorized("Please sign in to continue.", code="AUTH_REQUIRED")
    config: AppConfig = request.state.config
    try:
        claims = decode_token(header[7:].strip(), config.jwt_secret, now=int(time.time()))
        user_id = int(claims["sub"])
    except (TokenError, KeyError, ValueError, TypeError):
        raise Unauthorized("Your session has expired. Please sign in again.", code="SESSION_EXPIRED") from None
    row = await _session_row(request.state.db, user_id)
    if not row or row["status"] != "ACTIVE" or row["token_version"] != claims.get("ver"):
        raise Unauthorized("Your session has ended. Please sign in again.", code="SESSION_EXPIRED")
    return CurrentUser(
        id=row["id"],
        role=ROLE_BY_ID[row["role_id"]],
        name=row["name"],
        member_id=row["member_id"],
        trainer_id=row["trainer_id"],
        must_change_password=bool(row["must_change_password"]),
        token_version=row["token_version"],
    )


async def current_user_allow_temp(request: Request) -> CurrentUser:
    """For /auth endpoints that must work before a temporary password is changed."""
    return await _authenticate(request)


async def current_user(request: Request) -> CurrentUser:
    user = await _authenticate(request)
    if user.must_change_password:
        raise Forbidden("Please set a new password to continue.", code="PASSWORD_CHANGE_REQUIRED")
    return user


def require_roles(*roles: str):
    async def dependency(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in roles:
            raise Forbidden("You don't have access to this area.")
        return user

    return dependency


require_admin = require_roles("ADMIN")
require_staff = require_roles("ADMIN", "STAFF")
require_team = require_roles("ADMIN", "STAFF", "TRAINER")
require_member = require_roles("MEMBER")


@dataclass(frozen=True)
class Page:
    page: int
    limit: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.limit

    def wrap(self, items: list[Any], total: int) -> dict[str, Any]:
        return {"items": items, "page": self.page, "limit": self.limit, "total": total, "pages": max(1, -(-total // self.limit))}


def pagination(default_limit: int = 20, max_limit: int = 100):
    """Lists are always paginated (20 / 50 / 100 per page) — never thousands of rows at once."""

    def dependency(
        page: int = Query(1, ge=1, le=100_000),
        limit: int = Query(default_limit, ge=1, le=max_limit),
    ) -> Page:
        return Page(page=page, limit=limit)

    return dependency


async def ensure_member_access(db: Database, user: CurrentUser, member_id: int) -> None:
    """Staff see every member; trainers only their assigned members; members only themselves.
    Unauthorised lookups answer 404 so ids can't be probed."""
    if user.is_staff:
        return
    if user.role == "MEMBER":
        if user.member_id != member_id:
            raise NotFound("Member not found.")
        return
    if user.role == "TRAINER":
        trainer_id = await MemberRepository(db).trainer_of(member_id)
        if trainer_id is None or trainer_id != user.trainer_id:
            raise NotFound("Member not found.")
        return
    raise NotFound("Member not found.")
