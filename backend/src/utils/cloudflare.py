"""Cloudflare API client for D1 Time Travel (optional; Cloudflare-native, not a third party).

Only used when CF_ACCOUNT_ID, CF_API_TOKEN (D1:Edit) and D1_DATABASE_ID are configured as
Worker secrets. Without them the app shows the equivalent `wrangler d1 time-travel` command.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

from core.config import AppConfig

from .http import HttpError, request

API = "https://api.cloudflare.com/client/v4"


class CloudflareError(Exception):
    pass


@dataclass
class RestoreOutcome:
    bookmark: str | None
    previous_bookmark: str | None
    message: str


def _base(config: AppConfig) -> str:
    return f"{API}/accounts/{quote(config.cf_account_id)}/d1/database/{quote(config.d1_database_id)}/time_travel"


def _headers(config: AppConfig) -> dict[str, str]:
    return {"Authorization": f"Bearer {config.cf_api_token}"}


async def time_travel_restore(config: AppConfig, timestamp_iso: str) -> RestoreOutcome:
    if not config.time_travel_api_enabled:
        raise CloudflareError("Time Travel API access is not configured.")
    try:
        response = await request("POST", f"{_base(config)}/restore?timestamp={quote(timestamp_iso)}", headers=_headers(config))
    except HttpError as exc:
        raise CloudflareError(str(exc)) from None
    body = response.json()
    if not response.ok or not body.get("success", False):
        errors = body.get("errors") or [{"message": f"HTTP {response.status}"}]
        raise CloudflareError("; ".join(str(e.get("message")) for e in errors if isinstance(e, dict)))
    result = body.get("result") or {}
    return RestoreOutcome(
        bookmark=result.get("bookmark"),
        previous_bookmark=result.get("previous_bookmark"),
        message=str(result.get("message") or "Database restored."),
    )
