"""Password hashing: HMAC pepper + PBKDF2-HMAC-SHA256 + 16-byte random salt.

    stored = pbkdf2p_sha256$<iterations>$<salt>$<hash>
    hash   = PBKDF2-SHA256(HMAC-SHA256(AUTH_SECRET, password), salt, iterations)

Why this shape (Cloudflare Workers Free plan):
- A Free-plan Worker gets ~10 ms of CPU per request. PBKDF2 at 100,000 iterations costs
  ~25 ms and regularly trips "Error 1102: exceeded resource limits". The default here
  (20,000 iterations, ~5 ms on native WebCrypto) fits inside the budget.
- The pepper (AUTH_SECRET, a Worker secret that never touches D1) means a copy of the
  database alone is useless for offline password guessing, which is what high iteration
  counts would otherwise have to defend against.
- The iteration count is stored per hash. Raising PASSWORD_ITERATIONS (e.g. on the Workers
  Paid plan) upgrades each user's hash transparently at their next sign-in.

Inside Workers the derivation runs on native WebCrypto; under CPython (tests, scripts) it
uses hashlib. Both produce identical hashes.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from core.runtime import IN_WORKER

ALGORITHM = "pbkdf2p_sha256"
MIN_ITERATIONS, MAX_ITERATIONS = 1_000, 100_000
_TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L


def _pepper(password: str, secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), password.encode("utf-8"), hashlib.sha256).digest()


async def _derive(material: bytes, salt: bytes, iterations: int) -> bytes:
    if IN_WORKER:
        return await _derive_webcrypto(material, salt, iterations)
    return hashlib.pbkdf2_hmac("sha256", material, salt, iterations, dklen=32)


def _u8(data: bytes):  # pragma: no cover - Workers only
    import js  # type: ignore[import-not-found]

    array = js.Uint8Array.new(len(data))
    array.assign(data)
    return array


async def _derive_webcrypto(material: bytes, salt: bytes, iterations: int) -> bytes:  # pragma: no cover
    import js  # type: ignore[import-not-found]
    from pyodide.ffi import to_js  # type: ignore[import-not-found]

    subtle = js.crypto.subtle
    key = await subtle.importKey("raw", _u8(material), "PBKDF2", False, to_js(["deriveBits"]))
    algorithm = to_js(
        {"name": "PBKDF2", "hash": "SHA-256", "salt": _u8(salt), "iterations": iterations},
        dict_converter=js.Object.fromEntries,
    )
    bits = await subtle.deriveBits(algorithm, key, 256)
    return js.Uint8Array.new(bits).to_bytes()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _encode(iterations: int, salt: bytes, digest: bytes) -> str:
    return f"{ALGORITHM}${iterations}${_b64(salt)}${_b64(digest)}"


async def hash_password(password: str, *, secret: str, iterations: int) -> str:
    salt = secrets.token_bytes(16)
    digest = await _derive(_pepper(password, secret), salt, iterations)
    return _encode(iterations, salt, digest)


def hash_password_sync(password: str, *, secret: str, iterations: int) -> str:
    """CPython-only helper for seed / admin bootstrap scripts."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", _pepper(password, secret), salt, iterations, dklen=32)
    return _encode(iterations, salt, digest)


def _parse(encoded: str) -> tuple[int, bytes, bytes] | None:
    try:
        algorithm, iterations_text, salt_text, hash_text = encoded.split("$")
        iterations = int(iterations_text)
        salt, expected = _unb64(salt_text), _unb64(hash_text)
    except (ValueError, TypeError, AttributeError):
        return None
    if algorithm != ALGORITHM or not MIN_ITERATIONS <= iterations <= MAX_ITERATIONS:
        return None
    return iterations, salt, expected


async def verify_password(password: str, encoded: str | None, *, secret: str, iterations: int) -> bool:
    """Constant-work check. For unknown accounts (``encoded`` is None) the same derivation
    runs against a throwaway salt so response timing doesn't reveal which logins exist."""
    parsed = _parse(encoded) if encoded else None
    if parsed is None:
        await _derive(_pepper(password, secret), b"smartgym-dummy-salt", iterations)
        return False
    rounds, salt, expected = parsed
    actual = await _derive(_pepper(password, secret), salt, rounds)
    return hmac.compare_digest(actual, expected)


def needs_rehash(encoded: str, iterations: int) -> bool:
    parsed = _parse(encoded)
    return parsed is None or parsed[0] < iterations


def generate_temp_password() -> str:
    """Readable one-time password such as ``K7PX-M4QA`` (≈40 bits; must be changed at first sign-in)."""
    chars = "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(8))
    return f"{chars[:4]}-{chars[4:]}"


def password_problem(password: str) -> str | None:
    """Return a human-readable reason if the password is too weak, else None."""
    if len(password) < 8:
        return "Use at least 8 characters."
    if len(password) > 128:
        return "Use at most 128 characters."
    if password.isdigit() or password.isalpha():
        return "Mix letters with numbers or symbols."
    if password.lower() in {"password1", "password123", "12345678a", "smartgym1", "welcome123", "admin@123"}:
        return "This password is too common."
    return None
