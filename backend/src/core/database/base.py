"""Database interface shared by the D1 adapter (Workers) and the SQLite adapter (tests/local).

All SQL uses bound parameters (``?N``) — never string-built values. ``batch`` executes its
statements atomically: on D1 a batch is one SQL transaction, so multi-step business changes
(payment + membership + member status) fully commit or fully roll back.

Keep D1 Free-plan limits in mind: at most 50 statements per Worker invocation and 100 bound
parameters per statement.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Sequence

Params = Sequence[Any]
Statement = tuple[str, list[Any]]


class DatabaseError(Exception):
    """A database failure. The message is for logs only, never for API clients."""

    @property
    def daily_limit_reached(self) -> bool:
        text = str(self).lower()
        return "limit" in text and ("daily" in text or "exceeded" in text)


class IntegrityError(DatabaseError):
    """A constraint (UNIQUE / CHECK / FOREIGN KEY / trigger) rejected the write."""

    def mentions(self, *needles: str) -> bool:
        text = str(self).lower()
        return any(n.lower() in text for n in needles)


@dataclass
class Result:
    rows: list[dict[str, Any]] = field(default_factory=list)
    changes: int = 0
    last_row_id: int = 0
    rows_read: int = 0
    rows_written: int = 0
    size_after: int | None = None  # database size in bytes reported by D1

    @property
    def first(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None


@dataclass
class JsonRows:
    """Rows serialised as a JSON array by the runtime, plus how many there are."""

    text: str
    count: int


@dataclass
class QueryStats:
    statements: int = 0
    round_trips: int = 0
    rows_read: int = 0
    rows_written: int = 0
    duration_ms: float = 0.0


class Database:
    def __init__(self) -> None:
        self.stats = QueryStats()

    # -- adapter hooks -------------------------------------------------------------
    async def _execute(self, sql: str, params: list[Any]) -> Result:  # pragma: no cover
        raise NotImplementedError

    async def _execute_batch(self, statements: list[Statement]) -> list[Result]:  # pragma: no cover
        raise NotImplementedError

    async def _execute_json(self, sql: str, params: list[Any]) -> tuple[JsonRows, Result]:  # pragma: no cover
        raise NotImplementedError

    async def _size_bytes(self) -> int:  # pragma: no cover
        raise NotImplementedError

    # -- public API ----------------------------------------------------------------
    async def run(self, sql: str, params: Params = ()) -> Result:
        started = time.perf_counter()
        try:
            result = await self._execute(sql, list(params))
        finally:
            self._track(1, started)
        self._count(result)
        return result

    async def all(self, sql: str, params: Params = ()) -> list[dict[str, Any]]:
        return (await self.run(sql, params)).rows

    async def one(self, sql: str, params: Params = ()) -> dict[str, Any] | None:
        return (await self.run(sql, params)).first

    async def value(self, sql: str, params: Params = (), default: Any = None) -> Any:
        row = await self.one(sql, params)
        if not row:
            return default
        value = next(iter(row.values()))
        return default if value is None else value

    async def batch(self, statements: Sequence[Statement]) -> list[Result]:
        if not statements:
            return []
        started = time.perf_counter()
        try:
            results = await self._execute_batch([(sql, list(params)) for sql, params in statements])
        finally:
            self._track(len(statements), started)
        for result in results:
            self._count(result)
        return results

    async def rows_json(self, sql: str, params: Params = ()) -> JsonRows:
        """Result rows as a JSON array string, serialised natively by the runtime.

        Used for large exports (backups, report detail rows): the rows never become Python
        objects, which keeps Worker CPU time tiny on the Free plan.
        """
        started = time.perf_counter()
        try:
            rows, result = await self._execute_json(sql, list(params))
        finally:
            self._track(1, started)
        self._count(result)
        return rows

    async def size_bytes(self) -> int:
        """Current database size in bytes."""
        return await self._size_bytes()

    # -- stats (exposed as a Server-Timing header) ----------------------------------
    def _track(self, statements: int, started: float) -> None:
        self.stats.statements += statements
        self.stats.round_trips += 1
        self.stats.duration_ms += (time.perf_counter() - started) * 1000

    def _count(self, result: Result) -> None:
        self.stats.rows_read += result.rows_read
        self.stats.rows_written += result.rows_written


def placeholders(count: int, start: int = 1) -> str:
    """'?1, ?2, ?3' for an IN (...) list of bound values."""
    return ", ".join(f"?{i}" for i in range(start, start + count))
