"""BackupRepository: backup audit rows, period previews, export pages, archive deletes and
restore inserts — all generated from the table definitions in ``backup.datasets``."""

from __future__ import annotations

from typing import Any

from backup.datasets import BY_NAME, Table, render
from core.database import JsonRows

from .base import Repository, Statement

BACKUP_COLUMNS = (
    "b.id, b.kind, b.status, b.tables, b.period_from, b.period_to, b.watermarks, b.record_count, b.file_name, b.checksum, "
    "b.notes, b.created_by, b.created_at, b.verified_by, b.verified_at, b.archived_by, b.archived_at, b.archived_count"
)
_WITH_NAMES = (
    f"SELECT {BACKUP_COLUMNS}, cu.name AS created_by_name, vu.name AS verified_by_name, au.name AS archived_by_name "
    "FROM backups b LEFT JOIN users cu ON cu.id = b.created_by LEFT JOIN users vu ON vu.id = b.verified_by "
    "LEFT JOIN users au ON au.id = b.archived_by "
)


def _values(period_from: str | None, period_to: str | None, today: str | None = None) -> dict[str, Any]:
    return {"P1": period_from, "P2": period_to, "TODAY": today}


class BackupRepository(Repository):
    # -- audit rows ------------------------------------------------------------------------------
    async def create(
        self, *, kind: str, status: str, tables: str, period_from: str | None, period_to: str | None,
        watermarks: str | None, record_count: int, file_name: str | None, notes: str | None, created_by: int | None, now: str,
    ) -> int:
        row = await self.db.one(
            "INSERT INTO backups (kind, status, tables, period_from, period_to, watermarks, record_count, file_name, notes, "
            "created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id",
            [kind, status, tables, period_from, period_to, watermarks, record_count, file_name, notes, created_by, now],
        )
        return row["id"]

    async def get(self, backup_id: int) -> dict[str, Any] | None:
        return await self.db.one(_WITH_NAMES + "WHERE b.id = ?1", [backup_id])

    async def history(self, limit: int = 50) -> list[dict[str, Any]]:
        return await self.db.all(_WITH_NAMES + "ORDER BY b.id DESC LIMIT ?1", [limit])

    async def mark_verified(self, backup_id: int, *, by: int | None, now: str, file_name: str, checksum: str) -> int:
        result = await self.db.run(
            "UPDATE backups SET status = 'VERIFIED', verified_by = ?2, verified_at = ?3, file_name = ?4, checksum = ?5 "
            "WHERE id = ?1 AND kind = 'BACKUP' AND status IN ('CREATED', 'VERIFIED')",
            [backup_id, by, now, file_name, checksum],
        )
        return result.changes

    async def start_archive(self, backup_id: int, *, by: int | None, now: str) -> int:
        """Only one archive may run at a time (it unlocks the history-delete guards for its period)."""
        result = await self.db.run(
            "UPDATE backups SET status = 'ARCHIVING', archived_by = ?2, archived_at = ?3 "
            "WHERE id = ?1 AND kind = 'BACKUP' AND status = 'VERIFIED' "
            "AND NOT EXISTS (SELECT 1 FROM backups x WHERE x.status = 'ARCHIVING' AND x.id != ?1)",
            [backup_id, by, now],
        )
        return result.changes

    async def add_archived(self, backup_id: int, count: int) -> None:
        await self.db.run("UPDATE backups SET archived_count = archived_count + ?2 WHERE id = ?1", [backup_id, count])

    async def finish_archive(self, backup_id: int, now: str) -> None:
        await self.db.run(
            "UPDATE backups SET status = 'ARCHIVED', archived_at = ?2 WHERE id = ?1 AND status = 'ARCHIVING'", [backup_id, now]
        )

    async def cancel(self, backup_id: int) -> int:
        result = await self.db.run(
            "UPDATE backups SET status = 'CANCELLED' WHERE id = ?1 AND kind = 'BACKUP' AND status IN ('CREATED', 'VERIFIED')",
            [backup_id],
        )
        return result.changes

    async def expire_stale(self, before: str) -> int:
        """Backups that were never verified are cancelled after a week (temporary records)."""
        result = await self.db.run(
            "UPDATE backups SET status = 'CANCELLED' WHERE kind = 'BACKUP' AND status = 'CREATED' AND created_at < ?1", [before]
        )
        return result.changes

    # -- previews & watermarks -------------------------------------------------------------------
    async def preview(self, tables: list[Table], period_from: str, period_to: str, today: str) -> list[dict[str, Any]]:
        """Rows per table in the period, rows eligible for archiving, and the current max id."""
        statements: list[Statement] = []
        values = _values(period_from, period_to, today)
        for table in tables:
            params: list[Any] = []
            condition = render(table.period, values, params) if table.period else "1 = 1"
            eligible = render(table.archive, values, params) if table.archive and table.period else "0"
            statements.append(
                (
                    f"SELECT COUNT(*) AS rows, COALESCE(SUM(CASE WHEN {eligible} THEN 1 ELSE 0 END), 0) AS eligible, "
                    f"(SELECT MAX(id) FROM {table.name}) AS max_id FROM {table.name} t WHERE {condition}",
                    params,
                )
            )
        results = await self.db.batch(statements)
        out = []
        for table, result in zip(tables, results):
            row = result.first or {}
            out.append(
                {
                    "table": table.name,
                    "rows": int(row.get("rows") or 0),
                    "eligible": int(row.get("eligible") or 0),
                    "max_id": int(row.get("max_id") or 0),
                }
            )
        return out

    # -- export ------------------------------------------------------------------------------------
    async def export_page(
        self, table: Table, *, period_from: str | None, period_to: str | None, max_id: int, after_id: int, limit: int
    ) -> JsonRows:
        params: list[Any] = []
        condition = render(table.period, _values(period_from, period_to), params) if table.period else "1 = 1"
        params += [after_id, max_id, limit]
        n = len(params)
        columns = ", ".join(f"t.{c}" for c in table.columns)
        return await self.db.rows_json(
            f"SELECT {columns} FROM {table.name} t WHERE {condition} AND t.id > ?{n - 2} AND t.id <= ?{n - 1} "
            f"ORDER BY t.id LIMIT ?{n}",
            params,
        )

    # -- archive -----------------------------------------------------------------------------------
    async def archive_chunk(self, table: Table, *, period_from: str, period_to: str, today: str, max_id: int, limit: int) -> int:
        params: list[Any] = []
        values = _values(period_from, period_to, today)
        condition = f"{render(table.period or '0', values, params)} AND {render(table.archive or '0', values, params)}"
        params += [max_id, limit]
        n = len(params)
        result = await self.db.run(
            f"DELETE FROM {table.name} WHERE id IN (SELECT t.id FROM {table.name} t WHERE {condition} "
            f"AND t.id <= ?{n - 1} ORDER BY t.id LIMIT ?{n})",
            params,
        )
        return result.changes

    # -- restore -----------------------------------------------------------------------------------
    async def existing_ids(self, table_name: str, ids: list[int]) -> list[int]:
        rows = await self.db.all(
            f"SELECT id FROM {BY_NAME[table_name].name} WHERE id IN (SELECT value FROM json_each(?1))",
            ["[" + ",".join(str(int(i)) for i in ids) + "]"],
        )
        return [r["id"] for r in rows]

    async def restore_rows(self, table_name: str, rows_json: str) -> int:
        """INSERT OR IGNORE: rows whose id already exists are skipped, never overwritten; rows
        whose parent records are missing are filtered out."""
        table = BY_NAME[table_name]
        columns = list(table.columns) + list(table.defaults)
        values = []
        for column in table.columns:
            source = f"json_extract(j.value, '$.{column}')"
            parent = table.optional.get(column)
            if parent:
                values.append(f"CASE WHEN EXISTS (SELECT 1 FROM {parent} p WHERE p.id = {source}) THEN {source} END")
            else:
                values.append(source)
        values += list(table.defaults.values())
        checks = [
            f"EXISTS (SELECT 1 FROM {parent} p WHERE p.id = json_extract(j.value, '$.{column}'))"
            for column, parent in table.required.items()
        ]
        if table.restore_filter:
            checks.append(table.restore_filter)
        condition = " AND ".join(checks) if checks else "1 = 1"
        result = await self.db.run(
            f"INSERT OR IGNORE INTO {table.name} ({', '.join(columns)}) SELECT {', '.join(values)} "
            f"FROM json_each(?1) j WHERE {condition}",
            [rows_json],
        )
        return result.changes
