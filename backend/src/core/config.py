"""Runtime configuration.

Values come from Cloudflare Worker vars / secrets (``env``) in production, and from
``os.environ`` for tests and the local SQLite dev server. Secrets are read only here, on the
server; nothing in this module is ever exposed to the React app.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, fields
from typing import Any

DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me"
DEV_AUTH_SECRET = "dev-only-insecure-auth-secret-change-me"


class ConfigError(RuntimeError):
    """Raised when a required production setting (such as JWT_SECRET) is missing."""


def _read(env: Any, name: str) -> str | None:
    if env is None:
        value = os.environ.get(name)
    elif isinstance(env, dict):
        value = env.get(name)
    else:
        try:
            value = getattr(env, name)
        except Exception:  # missing var on the JS env proxy
            return None
    if value is None:
        return None
    try:
        text = str(value).strip()
    except Exception:
        return None
    return text or None


@dataclass(frozen=True)
class AppConfig:
    environment: str = "development"
    # Signs sign-in tokens (HS256).
    jwt_secret: str = DEV_JWT_SECRET
    # Server-side password pepper: passwords are HMAC-ed with this secret before PBKDF2, so a
    # copy of the database alone is not enough to attack them offline.
    auth_secret: str = DEV_AUTH_SECRET
    allowed_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    gym_timezone: str = "Asia/Kolkata"
    gym_utc_offset_minutes: int = 330
    default_country_code: str = "91"
    staff_token_hours: int = 12
    remember_token_days: int = 7
    member_token_days: int = 30
    # Sized for the Workers Free plan's 10 ms CPU budget per request (see README → Security).
    password_iterations: int = 20_000
    setup_token: str = ""
    # Cloudflare D1 Free plan: 500 MB per database, 7 days of Time Travel.
    d1_max_bytes: int = 500_000_000
    d1_time_travel_days: int = 7
    d1_database_name: str = "smartgym-db"
    # Optional: lets an admin run a D1 Time Travel restore from Data & Backup.
    cf_account_id: str = ""
    cf_api_token: str = ""
    d1_database_id: str = ""

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def time_travel_api_enabled(self) -> bool:
        return bool(self.cf_account_id and self.cf_api_token and self.d1_database_id)

    def origin_allowed(self, origin: str) -> bool:
        return "*" in self.allowed_origins or origin in self.allowed_origins


_INT_FIELDS = {f.name for f in fields(AppConfig) if f.type in ("int", int)}


def load_config(env: Any = None, **overrides: Any) -> AppConfig:
    values: dict[str, Any] = {}
    for f in fields(AppConfig):
        raw = _read(env, f.name.upper())
        if raw is None:
            continue
        if f.name == "allowed_origins":
            values[f.name] = tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())
        elif f.name in _INT_FIELDS:
            try:
                values[f.name] = int(raw)
            except ValueError as exc:
                raise ConfigError(f"{f.name.upper()} must be an integer") from exc
        else:
            values[f.name] = raw
    values.update(overrides)
    config = AppConfig(**values)

    if config.is_production:
        if config.jwt_secret == DEV_JWT_SECRET or len(config.jwt_secret) < 32:
            raise ConfigError("JWT_SECRET must be set to a random value of at least 32 characters")
        if config.auth_secret == DEV_AUTH_SECRET or len(config.auth_secret) < 32:
            raise ConfigError("AUTH_SECRET must be set to a random value of at least 32 characters")
        if "*" in config.allowed_origins:
            raise ConfigError("ALLOWED_ORIGINS must list explicit origins in production")
    if not 1_000 <= config.password_iterations <= 100_000:
        # 100k is the Workers WebCrypto PBKDF2 ceiling.
        raise ConfigError("PASSWORD_ITERATIONS must be between 1000 and 100000")
    return config


_cached: AppConfig | None = None


def config_from_worker_env(env: Any) -> AppConfig:
    """Vars and secrets are fixed per deployment, so parse them once per isolate."""
    global _cached
    if _cached is None:
        _cached = load_config(env)
    return _cached
