"""Per-IP sign-in throttle using the optional Workers Rate Limiting binding (LOGIN_LIMITER).

Account lockout after repeated wrong passwords is enforced in D1 regardless; this binding
only adds a cheap, in-memory first line of defence against password spraying.
"""

from __future__ import annotations

import json
from typing import Any

from core.database.d1 import raw_binding
from core.errors import TooManyRequests


async def check_login_rate(env: Any, key: str) -> None:
    limiter = getattr(env, "LOGIN_LIMITER", None) if env is not None else None
    if limiter is None:
        return
    try:
        import js  # type: ignore[import-not-found]

        outcome = await raw_binding(limiter).limit(js.JSON.parse(json.dumps({"key": key})))
        allowed = bool(outcome.success)
    except Exception:  # never block sign-in because the limiter itself failed
        return
    if not allowed:
        raise TooManyRequests("Too many sign-in attempts. Please wait a minute and try again.")
