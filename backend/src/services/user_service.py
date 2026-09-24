"""UserService: team accounts (admin / staff) and app logins for trainers and members.

New or reset logins get a one-time temporary password that must be changed at first sign-in.
It is returned once to the admin and never stored in readable form.
"""

from __future__ import annotations

from typing import Any

from core.database import IntegrityError
from core.errors import Conflict, NotFound, ValidationFailed
from models.domain import ROLE_BY_ID, ROLE_IDS
from repositories.members import MemberRepository
from repositories.trainers import TrainerRepository
from repositories.users import UserRepository
from security.passwords import generate_temp_password, hash_password

from .auth_service import forget_user, login_label, user_out
from .context import Ctx


class UserService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.users = UserRepository(ctx.db)

    async def _temp_hash(self) -> tuple[str, str]:
        temp = generate_temp_password()
        return temp, await hash_password(temp, secret=self.ctx.config.auth_secret, iterations=self.ctx.config.password_iterations)

    # -- team (admin / staff) ------------------------------------------------------------------
    async def list_team(self) -> list[dict[str, Any]]:
        return [user_out(r) for r in await self.users.list_team()]

    async def create_team_user(self, *, name: str, email: str | None, phone: str | None, role: str) -> dict[str, Any]:
        if not email and not phone:
            raise ValidationFailed("Add an email or phone number to sign in with.", fields={"email": "Email or phone is required"})
        temp, password_hash = await self._temp_hash()
        try:
            user_id = await self.users.insert(
                role_id=ROLE_IDS[role], name=name, email=email, phone=phone, password_hash=password_hash, now=self.ctx.now,
            )
        except IntegrityError as exc:
            if exc.mentions("email"):
                raise Conflict("This email is already used by another account.", fields={"email": "Already in use"}) from None
            if exc.mentions("phone"):
                raise Conflict("This phone number is already used by another account.", fields={"phone": "Already in use"}) from None
            raise
        return {"user": user_out(await self.users.get(user_id)), "login": email or phone, "temporary_password": temp}

    async def update_team_user(self, user_id: int, *, name: str, email: str | None, phone: str | None) -> dict[str, Any]:
        row = await self.users.get(user_id)
        if not row or ROLE_BY_ID[row["role_id"]] not in ("ADMIN", "STAFF"):
            raise NotFound("User not found.")
        if not email and not phone:
            raise ValidationFailed("Add an email or phone number to sign in with.", fields={"email": "Email or phone is required"})
        try:
            await self.users.update_profile(user_id, name=name, email=email, phone=phone, now=self.ctx.now)
        except IntegrityError as exc:
            field = "email" if exc.mentions("email") else "phone"
            raise Conflict("This sign-in detail is already used by another account.", fields={field: "Already in use"}) from None
        forget_user(user_id)
        return user_out(await self.users.get(user_id))

    async def set_status(self, user_id: int, status: str) -> dict[str, Any]:
        if self.ctx.user and self.ctx.user.id == user_id:
            raise Conflict("You can't change the status of your own account.")
        row = await self.users.get(user_id)
        if not row:
            raise NotFound("User not found.")
        if row["role_id"] == ROLE_IDS["ADMIN"] and status == "DISABLED" and not await self.users.other_active_admins(user_id):
            raise Conflict("At least one active admin is required.")
        await self.users.set_status(user_id, status, self.ctx.now)
        forget_user(user_id)
        return user_out({**row, "status": status})

    async def reset_password(self, user_id: int) -> dict[str, Any]:
        row = await self.users.get(user_id)
        if not row:
            raise NotFound("User not found.")
        temp, password_hash = await self._temp_hash()
        await self.users.reset_credentials(user_id, password_hash, self.ctx.now)
        forget_user(user_id)
        return {"user_id": user_id, "login": login_label(row), "temporary_password": temp}

    # -- member & trainer app logins ------------------------------------------------------------------
    async def member_login(self, member_id: int) -> dict[str, Any]:
        """Create (or reset) the member's app login. The member signs in with their member ID."""
        members = MemberRepository(self.ctx.db)
        member = await members.basic(member_id)
        if not member:
            raise NotFound("Member not found.")
        temp, password_hash = await self._temp_hash()
        if member["user_id"]:
            await self.users.reset_credentials(member["user_id"], password_hash, self.ctx.now, name=member["name"])
            forget_user(member["user_id"])
        else:
            await self.ctx.db.batch(
                [
                    self.users.insert_stmt(role_id=ROLE_IDS["MEMBER"], name=member["name"], password_hash=password_hash, now=self.ctx.now),
                    members.link_user_stmt(member_id, self.ctx.now),
                ]
            )
        return {"login": member["member_code"], "temporary_password": temp}

    async def trainer_login(self, trainer_id: int) -> dict[str, Any]:
        trainers = TrainerRepository(self.ctx.db)
        trainer = await trainers.basic(trainer_id)
        if not trainer:
            raise NotFound("Trainer not found.")
        if trainer["status"] != "ACTIVE":
            raise Conflict("Activate this trainer before creating a login.")
        temp, password_hash = await self._temp_hash()
        if trainer["user_id"]:
            await self.users.reset_credentials(trainer["user_id"], password_hash, self.ctx.now, name=trainer["name"])
            forget_user(trainer["user_id"])
        else:
            await self.ctx.db.batch(
                [
                    self.users.insert_stmt(role_id=ROLE_IDS["TRAINER"], name=trainer["name"], password_hash=password_hash, now=self.ctx.now),
                    trainers.link_user_stmt(trainer_id, self.ctx.now),
                ]
            )
        return {"login": trainer["email"] or trainer["phone"], "temporary_password": temp}

    async def disable_login(self, user_id: int | None) -> None:
        if user_id:
            await self.users.set_status(user_id, "DISABLED", self.ctx.now)
            forget_user(user_id)
