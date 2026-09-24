"""SQLite adapter for tests and the optional local dev server.

D1 is SQLite, so the same migrations and SQL run unchanged. Not used in production.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from .base import Database, DatabaseError, IntegrityError, JsonRows, Result, Statement

_NUMBERED = re.compile(r"\?\d")


def _bindings(sql: str, params: list[Any]) -> Any:
    values = [int(p) if isinstance(p, bool) else p for p in params]
    # D1 binds ?1, ?2 ... positionally; Python's sqlite3 treats them as named, so map by number.
    if _NUMBERED.search(sql):
        return {str(i): v for i, v in enumerate(values, start=1)}
    return values


class SQLiteDatabase(Database):
    def __init__(self, path: str = ":memory:") -> None:
        super().__init__()
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")

    def _run_one(self, sql: str, params: list[Any]) -> Result:
        before = self.conn.total_changes
        cursor = self.conn.execute(sql, _bindings(sql, params))
        rows = [dict(r) for r in cursor.fetchall()] if cursor.description else []
        return Result(rows=rows, changes=self.conn.total_changes - before, last_row_id=cursor.lastrowid or 0)

    async def _execute(self, sql: str, params: list[Any]) -> Result:
        try:
            return self._run_one(sql, params)
        except sqlite3.IntegrityError as exc:
            raise IntegrityError(str(exc)) from None
        except sqlite3.Error as exc:
            raise DatabaseError(str(exc)) from None

    async def _execute_batch(self, statements: list[Statement]) -> list[Result]:
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            results = [self._run_one(sql, params) for sql, params in statements]
        except sqlite3.IntegrityError as exc:
            self.conn.execute("ROLLBACK")
            raise IntegrityError(str(exc)) from None
        except sqlite3.Error as exc:
            self.conn.execute("ROLLBACK")
            raise DatabaseError(str(exc)) from None
        self.conn.execute("COMMIT")
        return results

    async def _execute_json(self, sql: str, params: list[Any]) -> tuple[JsonRows, Result]:
        result = await self._execute(sql, params)
        text = json.dumps(result.rows, separators=(",", ":"), ensure_ascii=False)
        return JsonRows(text, len(result.rows)), Result(rows_read=result.rows_read)

    async def _size_bytes(self) -> int:
        pages = self.conn.execute("PRAGMA page_count").fetchone()[0]
        page_size = self.conn.execute("PRAGMA page_size").fetchone()[0]
        return int(pages) * int(page_size)

    # -- local tooling -----------------------------------------------------------------
    def apply_migrations(self, directory: str | Path) -> list[str]:
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, "
            "applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
        )
        applied = {r[0] for r in self.conn.execute("SELECT name FROM d1_migrations")}
        newly_applied = []
        for path in sorted(Path(directory).glob("*.sql")):
            if path.name in applied:
                continue
            self.conn.executescript(path.read_text(encoding="utf-8"))
            self.conn.execute("INSERT INTO d1_migrations (name) VALUES (?)", [path.name])
            newly_applied.append(path.name)
        return newly_applied

    def execute_script(self, sql: str) -> None:
        self.conn.executescript(sql)
