"""Outbound HTTP (used only for the optional Cloudflare API call behind D1 Time Travel).

Uses the Workers ``fetch`` API inside Cloudflare, and urllib (in a thread) under CPython.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

from core.runtime import IN_WORKER


@dataclass
class HttpResponse:
    status: int
    text: str

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def json(self) -> Any:
        try:
            return json.loads(self.text) if self.text else {}
        except ValueError:
            return {}


class HttpError(Exception):
    pass


async def request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: str | None = None,
    json_body: Any = None,
    timeout: float = 30.0,
) -> HttpResponse:
    headers = dict(headers or {})
    if json_body is not None:
        body = json.dumps(json_body, separators=(",", ":"))
        headers.setdefault("Content-Type", "application/json")
    if IN_WORKER:
        return await _worker_fetch(method, url, headers, body, timeout)
    return await asyncio.to_thread(_urllib_fetch, method, url, headers, body, timeout)


async def _worker_fetch(method, url, headers, body, timeout) -> HttpResponse:  # pragma: no cover
    import js  # type: ignore[import-not-found]
    from pyodide.ffi import to_js  # type: ignore[import-not-found]

    init: dict[str, Any] = {"method": method, "headers": headers, "signal": js.AbortSignal.timeout(int(timeout * 1000))}
    if body is not None:
        init["body"] = body
    try:
        response = await js.fetch(url, to_js(init, dict_converter=js.Object.fromEntries))
        text = await response.text()
    except Exception as exc:
        raise HttpError(f"{method} {url} failed: {exc}") from None
    return HttpResponse(status=int(response.status), text=str(text))


def _urllib_fetch(method, url, headers, body, timeout) -> HttpResponse:
    import urllib.error
    import urllib.request

    data = body.encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed Cloudflare API URL
            return HttpResponse(status=resp.status, text=resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        return HttpResponse(status=exc.code, text=exc.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise HttpError(f"{method} {url} failed: {exc}") from None
