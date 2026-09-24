"""The authenticated user of a request."""

from __future__ import annotations

from dataclasses import dataclass

from .domain import STAFF_ROLES


@dataclass(frozen=True)
class CurrentUser:
    id: int
    role: str
    name: str
    member_id: int | None
    trainer_id: int | None
    must_change_password: bool
    token_version: int

    @property
    def is_staff(self) -> bool:
        return self.role in STAFF_ROLES

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"
