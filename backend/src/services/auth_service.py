"""AuthService: sign-in, sessions, password changes and first-run setup.

Sign in with an email address, phone number or (members) member ID. Five wrong passwords lock
the account for 15 minutes; an optional Workers Rate Limiting binding throttles per IP.
"""

from __future__ import annotations

import hmac
import time
from datetime import timedelta
from typing import Any

from core.cache import TTLCache
from core.clock import fmt_ts, iso_z, parse_ts
from core.errors import Conflict, Forbidden, TooManyRequests, Unauthorized, ValidationFailed
from models.domain import ROLE_BY_ID, ROLE_IDS
from models.session import CurrentUser
from repositories.users import UserRepository
from security.passwords import hash_password, needs_rehash, password_problem, verify_password
from security.rate_limit import check_login_rate
from security.tokens import create_token
from utils.formatting import digits_only, member_code_candidates, normalize_phone

from .context import Ctx

MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15

# Session users are cached briefly per isolate (saves one D1 read per request). Revocations
# take effect immediately on the isolate that handles them and within 30 s everywhere else.
session_cache = TTLCache(30, 1024)


def forget_user(user_id: int) -> None:
    session_cache.pop(user_id)


def login_label(row: dict[str, Any]) -> str:
    """What the person types to sign in (shown with temporary passwords)."""
    return row.get("member_code") or row.get("email") or row.get("phone") or ""


def user_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "role": ROLE_BY_ID[row["role_id"]],
        "email": row.get("email"),
        "phone": row.get("phone"),
        "login": login_label(row) or None,
        "member_id": row.get("member_id"),
        "trainer_id": row.get("trainer_id"),
        "status": row.get("status"),
        "must_change_password": bool(row.get("must_change_password")),
        "last_login_at": iso_z(row.get("last_login_at")),
    }


class AuthService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.users = UserRepository(ctx.db)

    # -- helpers -------------------------------------------------------------------------------
    def _secret(self) -> dict[str, Any]:
        return {"secret": self.ctx.config.auth_secret, "iterations": self.ctx.config.password_iterations}

    def issue_token(self, row: dict[str, Any], remember: bool) -> tuple[str, int]:
        role = ROLE_BY_ID[row["role_id"]]
        now = int(time.time())
        config = self.ctx.config
        if role == "MEMBER":
            ttl = config.member_token_days * 86_400
        elif remember:
            ttl = config.remember_token_days * 86_400
        else:
            ttl = config.staff_token_hours * 3_600
        expires = now + ttl
        claims = {"sub": str(row["id"]), "role": role, "ver": row["token_version"], "iat": now, "exp": expires}
        return create_token(claims, config.jwt_secret), expires

    async def _identify(self, identifier: str) -> list[dict[str, Any]]:
        text = identifier.strip()
        email = text.lower() if "@" in text else None
        member_code = None
        phone = None
        if not email:
            settings = await self.ctx.settings()
            codes = member_code_candidates(text, settings["member_code_prefix"]) if any(c.isalpha() for c in text) else []
            member_code = codes[0] if codes else None
            digits = digits_only(text)
            if not member_code and len(digits) >= 7 and len(digits) == len(text.replace(" ", "").replace("+", "").replace("-", "")):
                phone = normalize_phone(text, self.ctx.config.default_country_code)
        if not (email or phone or member_code):
            return []
        return await self.users.find_for_login(email=email, phone=phone, member_code=member_code)

    # -- sign in -------------------------------------------------------------------------------
    async def login(self, identifier: str, password: str, remember: bool, client_ip: str) -> dict[str, Any]:
        await check_login_rate(self.ctx.env, f"login:{client_ip}")
        rows = await self._identify(identifier)
        if len(rows) > 1:
            await verify_password(password, None, **self._secret())
            raise Unauthorized("More than one account uses these details. Sign in with your member ID or email instead.")
        row = rows[0] if rows else None
        if row is None:
            await verify_password(password, None, **self._secret())  # equal timing for unknown accounts
            raise Unauthorized("Incorrect login or password.", code="INVALID_CREDENTIALS")

        now_dt = self.ctx.clock.utcnow()
        if row["locked_until"] and parse_ts(row["locked_until"]) > now_dt:
            minutes = max(1, int((parse_ts(row["locked_until"]) - now_dt).total_seconds() // 60) + 1)
            raise TooManyRequests(f"Too many failed attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}.")

        if not await verify_password(password, row["password_hash"], **self._secret()):
            failed = row["failed_logins"] + 1
            locked_until = fmt_ts(now_dt + timedelta(minutes=LOCK_MINUTES)) if failed >= MAX_FAILED_LOGINS else None
            await self.users.record_failure(row["id"], 0 if locked_until else failed, locked_until)
            if locked_until:
                raise TooManyRequests(f"Too many failed attempts. Try again in {LOCK_MINUTES} minutes.")
            raise Unauthorized("Incorrect login or password.", code="INVALID_CREDENTIALS")

        if row["status"] != "ACTIVE":
            raise Forbidden("This account is disabled. Please contact the gym.")
        if row.get("trainer_id") and row.get("trainer_status") != "ACTIVE":
            raise Forbidden("This trainer account is inactive. Please contact the gym admin.")

        new_hash = None
        if needs_rehash(row["password_hash"], self.ctx.config.password_iterations):
            new_hash = await hash_password(password, **self._secret())
        await self.users.record_success(row["id"], self.ctx.now, new_hash)
        token, expires = self.issue_token(row, remember)
        return {"token": token, "expires_at": expires, "user": user_out(row)}

    async def me(self, user: CurrentUser) -> dict[str, Any]:
        row = await self.users.get(user.id)
        return user_out(row) if row else {}

    async def change_password(self, user: CurrentUser, current: str, new: str) -> dict[str, Any]:
        row = await self.users.get(user.id)
        if not row or not await verify_password(current, row["password_hash"], **self._secret()):
            raise ValidationFailed("Your current password is incorrect.", fields={"current_password": "Incorrect password"})
        problem = password_problem(new)
        if problem:
            raise ValidationFailed(problem, fields={"new_password": problem})
        if hmac.compare_digest(current, new):
            raise ValidationFailed("Choose a password different from the current one.", fields={"new_password": "Must be different"})
        version = row["token_version"] + 1  # signs out every other device
        await self.users.change_password(user.id, await hash_password(new, **self._secret()), version, self.ctx.now)
        forget_user(user.id)
        updated = {**row, "token_version": version, "must_change_password": 0}
        token, expires = self.issue_token(updated, remember=False)
        return {"token": token, "expires_at": expires, "user": user_out(updated)}

    async def logout_everywhere(self, user: CurrentUser) -> None:
        await self.users.bump_token_version(user.id)
        forget_user(user.id)

    # -- first-run setup ---------------------------------------------------------------------------
    async def setup_status(self) -> dict[str, bool]:
        has_admin = await self.users.has_admin()
        return {"needs_setup": not has_admin, "setup_enabled": bool(self.ctx.config.setup_token) and not has_admin}

    async def setup_first_admin(self, setup_token: str, name: str, email: str, password: str) -> dict[str, Any]:
        """One-time bootstrap: only while no admin exists and SETUP_TOKEN is configured."""
        expected = self.ctx.config.setup_token
        if not expected or not hmac.compare_digest(setup_token, expected):
            raise Forbidden("Setup is not available.")
        if await self.users.has_admin():
            raise Conflict("SmartGym is already set up. Please sign in.")
        problem = password_problem(password)
        if problem:
            raise ValidationFailed(problem, fields={"password": problem})
        user_id = await self.users.insert(
            role_id=ROLE_IDS["ADMIN"], name=name, email=email.lower(), password_hash=await hash_password(password, **self._secret()),
            now=self.ctx.now, must_change_password=False,
        )
        row = await self.users.get(user_id)
        token, expires = self.issue_token(row, remember=False)
        return {"token": token, "expires_at": expires, "user": user_out(row)}
