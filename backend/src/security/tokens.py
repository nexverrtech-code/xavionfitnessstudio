"""Compact HS256 JWTs built on the standard library (no third-party JWT dependency).

Tokens carry the user id, role and the account's ``token_version``. Bumping the version in
D1 (password change, "sign out everywhere", account disabled) revokes every older token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any

_HEADER = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()


class TokenError(Exception):
    pass


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _signature(signing_input: str, secret: str) -> str:
    return _b64e(hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest())


def create_token(claims: dict[str, Any], secret: str) -> str:
    body = _b64e(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
    signing_input = f"{_HEADER}.{body}"
    return f"{signing_input}.{_signature(signing_input, secret)}"


def decode_token(token: str, secret: str, *, now: int) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != _HEADER:
        raise TokenError("malformed token")
    signing_input = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(parts[2], _signature(signing_input, secret)):
        raise TokenError("bad signature")
    try:
        claims = json.loads(_b64d(parts[1]))
    except (ValueError, TypeError) as exc:
        raise TokenError("bad payload") from exc
    if not isinstance(claims, dict) or not isinstance(claims.get("exp"), int) or claims["exp"] <= now:
        raise TokenError("expired")
    return claims
