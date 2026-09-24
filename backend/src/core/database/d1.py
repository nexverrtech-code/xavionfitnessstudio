"""Cloudflare D1 adapter (runs inside Python Workers / Pyodide).

Values cross the Python <-> JS boundary as JSON. This avoids Pyodide conversion quirks:
Python ``None`` becomes JS ``null`` (D1 rejects ``undefined``), and result rows come back
as plain Python dicts with ``None`` for NULL in one native ``JSON.stringify`` call instead
of a per-value proxy conversion.

Newer Workers runtime SDKs wrap bindings in a converting Python proxy. The adapter unwraps
to the raw JS binding when it can, and otherwise falls back to the wrapper's own API.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from .base import Database, DatabaseError, IntegrityError, JsonRows, Result, Statement

try:  # Only importable inside the Workers runtime.
    import js  # type: ignore[import-not-found]
    from pyodide.ffi import JsProxy, to_js  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - CPython (tests / local dev)
    js = None
    JsProxy = ()  # type: ignore[assignment,misc]
    to_js = None

_CONSTRAINT_WORDS = ("constraint", "immutable", "cannot be", "can only be", "belongs to a different", "must match", "invalid payment")


def raw_binding(binding: Any) -> Any:
    """Return the underlying JS object of a (possibly SDK-wrapped) Worker binding."""
    inner = getattr(binding, "_binding", None)
    if JsProxy and isinstance(inner, JsProxy):
        return inner
    return binding


def _clean(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _translate(exc: Exception) -> DatabaseError:
    message = str(exc)
    if any(word in message.lower() for word in _CONSTRAINT_WORDS):
        return IntegrityError(message)
    return DatabaseError(message)


def _meta_result(meta: Any, rows: list[dict[str, Any]] | None = None) -> Result:
    meta = meta or {}
    size = meta.get("size_after")
    return Result(
        rows=rows or [],
        changes=int(meta.get("changes") or 0),
        last_row_id=int(meta.get("last_row_id") or 0),
        rows_read=int(meta.get("rows_read") or 0),
        rows_written=int(meta.get("rows_written") or 0),
        size_after=int(size) if size is not None else None,
    )


def _to_result(payload: Any) -> Result:
    return _meta_result(payload.get("meta"), [dict(row) for row in (payload.get("results") or [])])


class D1Database(Database):
    def __init__(self, binding: Any) -> None:
        super().__init__()
        if js is None:
            raise RuntimeError("D1Database can only be used inside Cloudflare Workers")
        raw = raw_binding(binding)
        self._raw = isinstance(raw, JsProxy)
        self._db = raw if self._raw else binding

    def _prepare(self, sql: str, params: list[Any]) -> Any:
        values = [_clean(p) for p in params]
        statement = self._db.prepare(sql)
        if not values:
            return statement
        if self._raw:
            return statement.bind.apply(statement, js.JSON.parse(json.dumps(values)))
        return statement.bind(*values)  # SDK wrapper converts None -> null itself

    def _decode(self, response: Any) -> Any:
        return json.loads(js.JSON.stringify(response)) if self._raw else response

    async def _execute(self, sql: str, params: list[Any]) -> Result:
        try:
            response = await self._prepare(sql, params).all()
        except Exception as exc:  # JsException
            raise _translate(exc) from None
        return _to_result(self._decode(response))

    async def _execute_batch(self, statements: list[Statement]) -> list[Result]:
        prepared = [self._prepare(sql, params) for sql, params in statements]
        try:
            response = await self._db.batch(to_js(prepared) if self._raw else prepared)
        except Exception as exc:
            raise _translate(exc) from None
        return [_to_result(item) for item in self._decode(response)]

    async def _execute_json(self, sql: str, params: list[Any]) -> tuple[JsonRows, Result]:
        try:
            response = await self._prepare(sql, params).all()
        except Exception as exc:
            raise _translate(exc) from None
        if self._raw:
            # Native JSON.stringify of just the rows; only the small meta object is decoded.
            text = str(js.JSON.stringify(response.results))
            meta = json.loads(js.JSON.stringify(response.meta))
            return JsonRows(text, int(response.results.length)), _meta_result(meta)
        rows = response.get("results") or []
        return JsonRows(json.dumps(rows, separators=(",", ":")), len(rows)), _meta_result(response.get("meta"))

    async def _size_bytes(self) -> int:
        result = await self._execute("SELECT 1 AS ok", [])
        return int(result.size_after or 0)
