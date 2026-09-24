"""Member attendance QR codes.

The QR contains only ``SG1.<token>`` where the token is 128 random bits stored in
``members.qr_token``. It encodes no name, phone, email, address, payment or membership
details — not even the internal member id. The backend resolves the token to the member,
and staff can issue a new token (invalidating the old QR) at any time. The QR image is
drawn by the app; it is never stored.
"""

from __future__ import annotations

import re
import secrets

PREFIX = "SG1."
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,40}$")


def new_qr_token() -> str:
    return secrets.token_urlsafe(16)  # 22 characters


def qr_payload(token: str) -> str:
    return f"{PREFIX}{token}"


def looks_like_qr(code: str) -> bool:
    return code.strip().startswith(PREFIX)


def token_from_payload(code: str) -> str | None:
    """Return the token from a scanned QR payload, or None if it isn't one of ours."""
    text = code.strip()
    if not text.startswith(PREFIX):
        return None
    token = text[len(PREFIX):]
    return token if _TOKEN.match(token) else None
