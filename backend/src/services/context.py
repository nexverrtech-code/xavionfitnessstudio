"""Per-request service context: database, clock, config, the signed-in user, Worker env and
lazily loaded gym settings. Services receive a Ctx; they never touch FastAPI objects."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.clock import Clock
from core.config import AppConfig
from core.database import Database
from models.session import CurrentUser

from . import settings_service


@dataclass
class Ctx:
    db: Database
    clock: Clock
    config: AppConfig
    user: CurrentUser | None = None
    env: Any = None
    _settings: dict[str, Any] | None = None

    async def settings(self) -> dict[str, Any]:
        if self._settings is None:
            self._settings = await settings_service.get_settings(self.db)
        return self._settings

    def refresh_settings(self, settings: dict[str, Any]) -> None:
        self._settings = settings

    @property
    def actor_id(self) -> int | None:
        return self.user.id if self.user else None

    @property
    def now(self) -> str:
        return self.clock.now_ts()
