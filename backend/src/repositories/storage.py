"""StorageRepository: database size, row counts and daily snapshots for storage monitoring.

The database size comes from D1 itself (the ``size_after`` value D1 reports with every query).
Exact row counts are only taken in the daily snapshot or on an explicit refresh — the
Data & Backup page normally reads the stored snapshot, which costs one row read.
"""

from __future__ import annotations

from typing import Any

from .base import Repository

# Every table SmartGym owns (monitoring covers all of them).
TABLES = (
    "members", "users", "trainers", "membership_plans", "memberships", "payments", "refunds", "attendance",
    "workout_plans", "workout_exercises", "body_measurements", "notifications", "expenses", "settings",
    "backups", "storage_snapshots",
)
# Oldest record per archivable table (index-backed where it matters).
OLDEST = {
    "attendance": "SELECT MIN(attendance_date) FROM attendance",
    "payments": "SELECT MIN(payment_date) FROM payments",
    "memberships": "SELECT MIN(end_date) FROM memberships WHERE status IN ('EXPIRED', 'CANCELLED')",
    "notifications": "SELECT substr(MIN(created_at), 1, 10) FROM notifications",
    "expenses": "SELECT MIN(expense_date) FROM expenses",
    "body_measurements": "SELECT substr(MIN(recorded_at), 1, 10) FROM body_measurements",
    "workout_plans": "SELECT substr(MIN(updated_at), 1, 10) FROM workout_plans WHERE status = 'ARCHIVED'",
}


class StorageRepository(Repository):
    async def database_bytes(self) -> int:
        return await self.db.size_bytes()

    async def row_counts(self) -> dict[str, int]:
        """All table counts in ONE statement (the Free plan allows 50 statements per invocation)."""
        row = await self.db.one("SELECT " + ", ".join(f"(SELECT COUNT(*) FROM {t}) AS {t}" for t in TABLES))
        return {table: int((row or {}).get(table) or 0) for table in TABLES}

    async def oldest(self) -> dict[str, str | None]:
        row = await self.db.one("SELECT " + ", ".join(f"({sql}) AS {table}" for table, sql in OLDEST.items()))
        return {table: (row or {}).get(table) for table in OLDEST}

    async def save_snapshot(self, day: str, db_bytes: int, counts: dict[str, int], now: str) -> None:
        packed = ",".join(f"{table}:{count}" for table, count in counts.items())
        await self.db.run(
            "INSERT INTO storage_snapshots (snapshot_date, db_bytes, row_counts, created_at) VALUES (?1, ?2, ?3, ?4) "
            "ON CONFLICT (snapshot_date) DO UPDATE SET db_bytes = excluded.db_bytes, row_counts = excluded.row_counts, "
            "created_at = excluded.created_at",
            [day, db_bytes, packed, now],
        )

    async def snapshots(self, limit: int = 120) -> list[dict[str, Any]]:
        rows = await self.db.all(
            "SELECT snapshot_date, db_bytes, row_counts, created_at FROM storage_snapshots ORDER BY snapshot_date DESC LIMIT ?1",
            [limit],
        )
        for row in rows:
            counts: dict[str, int] = {}
            for part in (row.get("row_counts") or "").split(","):
                name, _, value = part.partition(":")
                if name and value.isdigit():
                    counts[name] = int(value)
            row["counts"] = counts
        return rows

    async def prune_snapshots(self, before: str) -> int:
        return (await self.db.run("DELETE FROM storage_snapshots WHERE snapshot_date < ?1", [before])).changes
