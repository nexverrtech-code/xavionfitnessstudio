"""Compact JSON responses.

Routes return ``FastJSON`` directly, which skips FastAPI's generic ``jsonable_encoder`` walk
(services already return plain JSON types). ``raw_json`` sends JSON text produced elsewhere
(D1's own serialisation) without re-encoding it in Python.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.responses import JSONResponse, Response


class FastJSON(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def ok(data: Any, *, status: int = 200, cache_seconds: int | None = None, public: bool = False) -> FastJSON:
    headers = {}
    if cache_seconds:
        headers["Cache-Control"] = f"{'public' if public else 'private'}, max-age={cache_seconds}"
    return FastJSON(data, status_code=status, headers=headers or None)


def raw_json(text: str) -> Response:
    return Response(content=text.encode("utf-8"), media_type="application/json")


def no_content() -> Response:
    return Response(status_code=204)
