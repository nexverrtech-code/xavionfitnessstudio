"""Role-scoped service contexts for the routers (the dependency validates the role first)."""

from __future__ import annotations

from typing import Awaitable, Callable

from fastapi import Depends, Request

from core.clock import Clock
from core.config import AppConfig
from core.database import Database
from models.session import CurrentUser
from services.context import Ctx

from .deps import (
    current_user,
    current_user_allow_temp,
    get_clock,
    get_config,
    get_db,
    require_admin,
    require_member,
    require_roles,
    require_staff,
    require_team,
)


def context_dependency(user_dependency: Callable[..., Awaitable[CurrentUser]] | None = None):
    if user_dependency is None:

        async def anonymous(
            request: Request,
            db: Database = Depends(get_db),
            config: AppConfig = Depends(get_config),
            clock: Clock = Depends(get_clock),
        ) -> Ctx:
            return Ctx(db=db, clock=clock, config=config, env=request.scope.get("env"))

        return anonymous

    async def authenticated(
        request: Request,
        user: CurrentUser = Depends(user_dependency),
        db: Database = Depends(get_db),
        config: AppConfig = Depends(get_config),
        clock: Clock = Depends(get_clock),
    ) -> Ctx:
        return Ctx(db=db, clock=clock, config=config, user=user, env=request.scope.get("env"))

    return authenticated


public_ctx = context_dependency(None)
temp_ctx = context_dependency(current_user_allow_temp)  # works before a temporary password is changed
any_ctx = context_dependency(current_user)
team_ctx = context_dependency(require_team)  # admin, staff, trainer
staff_ctx = context_dependency(require_staff)  # admin, staff
admin_ctx = context_dependency(require_admin)
member_ctx = context_dependency(require_member)
coach_ctx = context_dependency(require_roles("ADMIN", "TRAINER"))  # workouts and progress
trainer_ctx = context_dependency(require_roles("TRAINER"))
