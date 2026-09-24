"""Repository base: all SQL lives in repositories, business rules live in services.

Repositories expose two kinds of methods:
- async queries that run immediately (``get``, ``list`` ...), and
- statement builders (``*_stmt``) that return ``(sql, params)`` so a service can combine
  writes from several repositories into ONE D1 batch — a single atomic transaction.

Every value is a bound parameter; column lists are explicit (no ``SELECT *``).
"""

from __future__ import annotations

from typing import Any

from core.database import Database, Statement


class Binder:
    """Collects bound values for dynamically assembled WHERE clauses: ``bind(x)`` -> ``?N``."""

    def __init__(self, start: list[Any] | None = None) -> None:
        self.params: list[Any] = list(start or [])

    def __call__(self, value: Any) -> str:
        self.params.append(value)
        return f"?{len(self.params)}"


class Repository:
    def __init__(self, db: Database) -> None:
        self.db = db


def where(clauses: list[str]) -> str:
    return ("WHERE " + " AND ".join(clauses)) if clauses else ""


def count_of(result: Any, key: str = "c") -> int:
    row = result.first if hasattr(result, "first") else result
    return int(row[key]) if row and row.get(key) is not None else 0


__all__ = ["Binder", "Repository", "Statement", "count_of", "where"]
