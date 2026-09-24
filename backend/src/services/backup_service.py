"""BackupService: downloadable backups, verified archiving, restore and D1 Time Travel.

    Create backup (choose data + period)  -> counts + watermarks recorded (status CREATED)
    Browser downloads every page, builds SmartGym_Backup_<period>.zip and saves it
    Admin re-opens the saved file; the browser checks it -> Verify       (status VERIFIED)
    Admin ticks "I have downloaded and verified this backup" -> Archive  (status ARCHIVING)
    Eligible rows are removed in small chunks                             (status ARCHIVED)

Nothing is deleted without a verified backup and an explicit admin confirmation. The
database itself refuses to delete payments or membership history outside an archive run.
Archiving works in chunks so it respects the D1 Free plan's daily write allowance: if the
allowance runs out, the archive pauses and continues when resumed (e.g. the next day).

D1 Time Travel (7 days on Free) is short-term disaster recovery only; long-term history is
protected by the downloaded backups.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backup.datasets import ARCHIVE_ORDER, BY_NAME, LABELS, RESTORE_ORDER, SELECTABLE, tables_for
from core.clock import iso_z
from core.database import DatabaseError, JsonRows
from core.errors import Conflict, NotFound, ServiceUnavailable, ValidationFailed
from repositories.backups import BackupRepository
from utils.cloudflare import CloudflareError, time_travel_restore

from . import settings_service
from .auth_service import session_cache
from .context import Ctx

EXPORT_PAGE = 1000
ARCHIVE_CHUNK = 500
ARCHIVE_BUDGET = 2000          # rows removed per request (each also rewrites its index entries)
MIN_ARCHIVE_AGE_DAYS = 60      # the newest two months are never archived
RESTORE_BATCH = 500


def _file_name(period_from: str, period_to: str) -> str:
    start, end = date.fromisoformat(period_from), date.fromisoformat(period_to)
    if start.month == 1 and start.day == 1 and end.month == 12 and end.day == 31:
        return f"SmartGym_Backup_{start.year}.zip" if start.year == end.year else f"SmartGym_Backup_{start.year}-{end.year}.zip"
    return f"SmartGym_Backup_{period_from}_to_{period_to}.zip"


def _pack(stats: list[dict[str, Any]]) -> str:
    return ",".join(f"{s['table']}:{s['max_id']}:{s['rows']}" for s in stats)


def _unpack(text: str | None) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for part in (text or "").split(","):
        bits = part.split(":")
        if len(bits) == 3 and bits[1].isdigit() and bits[2].isdigit():
            out[bits[0]] = {"max_id": int(bits[1]), "rows": int(bits[2])}
    return out


def backup_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "status": row["status"],
        "datasets": [d for d in (row["tables"] or "").split(",") if d],
        "period_from": row["period_from"],
        "period_to": row["period_to"],
        "record_count": row["record_count"],
        "file_name": row["file_name"],
        "checksum": row["checksum"],
        "notes": row["notes"],
        "created_by_name": row.get("created_by_name"),
        "created_at": iso_z(row["created_at"]),
        "verified_by_name": row.get("verified_by_name"),
        "verified_at": iso_z(row["verified_at"]),
        "archived_by_name": row.get("archived_by_name"),
        "archived_at": iso_z(row["archived_at"]),
        "archived_count": row["archived_count"],
    }


class BackupService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.repo = BackupRepository(ctx.db)

    # -- backups -----------------------------------------------------------------------------------
    def options(self) -> dict[str, Any]:
        latest_archivable = self.ctx.clock.today() - timedelta(days=MIN_ARCHIVE_AGE_DAYS)
        return {
            "datasets": [{"key": key, "label": LABELS[key]} for key in SELECTABLE],
            "always_included": [{"key": "members", "label": LABELS["members"]}],
            "latest_archivable_date": latest_archivable.isoformat(),
            "export_page_size": EXPORT_PAGE,
        }

    async def history(self) -> list[dict[str, Any]]:
        return [backup_out(r) for r in await self.repo.history()]

    def _manifest(self, row: dict[str, Any]) -> dict[str, Any]:
        stats = _unpack(row["watermarks"])
        tables = tables_for([d for d in row["tables"].split(",") if d])
        return {
            "backup": backup_out(row),
            "tables": [
                {
                    "table": t.name,
                    "dataset": t.dataset,
                    "file": t.file,
                    "columns": list(t.columns),
                    "types": t.types,
                    "rows": stats.get(t.name, {}).get("rows", 0),
                    "archivable": bool(t.archive),
                }
                for t in tables
            ],
        }

    async def create(self, datasets: list[str], period_from: date, period_to: date) -> dict[str, Any]:
        chosen = sorted(set(datasets))
        if not chosen or any(d not in SELECTABLE for d in chosen):
            raise ValidationFailed("Choose the data to back up.", fields={"datasets": "Choose at least one data set"})
        today = self.ctx.clock.today()
        if period_to < period_from:
            raise ValidationFailed("The end date must be on or after the start date.", fields={"period_to": "Must be after the start date"})
        if period_to > today:
            raise ValidationFailed("The period can't end in the future.", fields={"period_to": "Can't be in the future"})
        tables = tables_for(chosen)
        stats = await self.repo.preview(tables, period_from.isoformat(), period_to.isoformat(), today.isoformat())
        record_count = sum(s["rows"] for s in stats)
        backup_id = await self.repo.create(
            kind="BACKUP", status="CREATED", tables=",".join(chosen), period_from=period_from.isoformat(),
            period_to=period_to.isoformat(), watermarks=_pack(stats), record_count=record_count,
            file_name=_file_name(period_from.isoformat(), period_to.isoformat()), notes=None,
            created_by=self.ctx.actor_id, now=self.ctx.now,
        )
        manifest = await self.get(backup_id)
        manifest["eligible_for_archive"] = {s["table"]: s["eligible"] for s in stats}
        return manifest

    async def _row(self, backup_id: int) -> dict[str, Any]:
        row = await self.repo.get(backup_id)
        if not row or row["kind"] != "BACKUP":
            raise NotFound("Backup not found.")
        return row

    async def get(self, backup_id: int) -> dict[str, Any]:
        return self._manifest(await self._row(backup_id))

    async def export_page(self, backup_id: int, table_name: str, after_id: int) -> JsonRows:
        row = await self._row(backup_id)
        if row["status"] not in ("CREATED", "VERIFIED"):
            raise Conflict("This backup can no longer be downloaded. Create a new backup.")
        table = BY_NAME.get(table_name)
        if not table or table.name not in {t.name for t in tables_for(row["tables"].split(","))}:
            raise NotFound("This backup doesn't include that data.")
        stats = _unpack(row["watermarks"]).get(table.name, {"max_id": 0})
        return await self.repo.export_page(
            table, period_from=row["period_from"] if table.period else None, period_to=row["period_to"] if table.period else None,
            max_id=stats["max_id"], after_id=max(0, after_id), limit=EXPORT_PAGE,
        )

    async def verify(self, backup_id: int, *, file_name: str, checksum: str, counts: dict[str, int]) -> dict[str, Any]:
        """The browser re-read the saved ZIP, re-checked every file's SHA-256 against its
        metadata and counted the rows; here the counts are matched against the backup record."""
        row = await self._row(backup_id)
        if row["status"] not in ("CREATED", "VERIFIED"):
            raise Conflict(f"This backup is already {row['status'].lower()}.")
        expected = _unpack(row["watermarks"])
        mismatched = [
            f"{name} ({counts.get(name, 0)} of {stats['rows']})"
            for name, stats in expected.items()
            if counts.get(name, 0) != stats["rows"]
        ]
        if mismatched:
            raise ValidationFailed(
                "This file doesn't match the backup — some records are missing: " + ", ".join(mismatched) + ". Download it again.",
                code="BACKUP_MISMATCH",
            )
        await self.repo.mark_verified(backup_id, by=self.ctx.actor_id, now=self.ctx.now, file_name=file_name, checksum=checksum)
        return await self.get(backup_id)

    async def cancel(self, backup_id: int) -> dict[str, Any]:
        await self._row(backup_id)
        if not await self.repo.cancel(backup_id):
            raise Conflict("Only backups that haven't been archived can be cancelled.")
        return await self.get(backup_id)

    # -- archive -------------------------------------------------------------------------------------
    async def archive(self, backup_id: int) -> dict[str, Any]:
        row = await self._row(backup_id)
        today = self.ctx.clock.today()
        if row["status"] == "ARCHIVED":
            return {"status": "ARCHIVED", "done": True, "removed_now": 0, "archived_count": row["archived_count"]}
        if row["status"] not in ("VERIFIED", "ARCHIVING"):
            raise Conflict("Verify the downloaded backup before archiving.")
        if row["period_to"] > (today - timedelta(days=MIN_ARCHIVE_AGE_DAYS)).isoformat():
            raise ValidationFailed(f"Only data older than {MIN_ARCHIVE_AGE_DAYS} days can be archived. Choose an earlier period.")
        if row["status"] == "VERIFIED" and not await self.repo.start_archive(backup_id, by=self.ctx.actor_id, now=self.ctx.now):
            raise Conflict("Another archive is in progress. Let it finish first.")
        chosen = set(row["tables"].split(","))
        stats = _unpack(row["watermarks"])
        removed = 0
        paused = None
        try:
            for name in ARCHIVE_ORDER:
                table = BY_NAME[name]
                if table.dataset not in chosen or name not in stats:
                    continue
                while removed < ARCHIVE_BUDGET:
                    deleted = await self.repo.archive_chunk(
                        table, period_from=row["period_from"], period_to=row["period_to"], today=today.isoformat(),
                        max_id=stats[name]["max_id"], limit=min(ARCHIVE_CHUNK, ARCHIVE_BUDGET - removed),
                    )
                    removed += deleted
                    if deleted < ARCHIVE_CHUNK:
                        break
                if removed >= ARCHIVE_BUDGET:
                    break
        except DatabaseError as exc:
            if not exc.daily_limit_reached:
                raise
            paused = "The D1 daily write allowance has been used up. The archive is paused — resume it tomorrow."
        if removed:
            await self.repo.add_archived(backup_id, removed)
        done = paused is None and removed < ARCHIVE_BUDGET
        if done:
            await self.repo.finish_archive(backup_id, self.ctx.now)
        refreshed = await self.repo.get(backup_id)
        return {
            "status": refreshed["status"],
            "done": done,
            "paused": paused,
            "removed_now": removed,
            "archived_count": refreshed["archived_count"],
        }

    # -- restore ---------------------------------------------------------------------------------------
    async def restore_check(self, table_name: str, ids: list[int]) -> dict[str, Any]:
        if table_name not in RESTORE_ORDER:
            raise ValidationFailed("Unknown table in backup.")
        existing = await self.repo.existing_ids(table_name, ids) if ids else []
        return {"table": table_name, "checked": len(ids), "existing": existing}

    async def restore_apply(self, table_name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        if table_name not in RESTORE_ORDER:
            raise ValidationFailed("Unknown table in backup.")
        table = BY_NAME[table_name]
        clean: list[dict[str, Any]] = []
        invalid = 0
        for raw in rows[:RESTORE_BATCH]:
            item = _coerce(raw, table.columns, table.types)
            if item is None:
                invalid += 1
            else:
                clean.append(item)
        inserted = 0
        if clean:
            try:
                inserted = await self.repo.restore_rows(table_name, json.dumps(clean, separators=(",", ":"), ensure_ascii=False))
            except DatabaseError as exc:
                if exc.daily_limit_reached:
                    raise ServiceUnavailable("The D1 daily write allowance has been used up. Resume the restore tomorrow.") from None
                raise
        return {"table": table_name, "received": len(rows), "inserted": inserted, "skipped": len(rows) - inserted}

    async def restore_complete(self, *, file_name: str, backup_created_at: str | None, inserted: int, skipped: int, datasets: list[str]) -> dict[str, Any]:
        note = f"Added {inserted} records, skipped {skipped} (already present or missing parent records)."
        if backup_created_at:
            note = f"Backup of {backup_created_at[:10]}. " + note
        backup_id = await self.repo.create(
            kind="RESTORE", status="COMPLETED", tables=",".join(sorted(set(d for d in datasets if d)))[:200] or "members",
            period_from=None, period_to=None, watermarks=None, record_count=inserted, file_name=file_name[:120],
            notes=note[:200], created_by=self.ctx.actor_id, now=self.ctx.now,
        )
        return backup_out(await self.repo.get(backup_id))

    # -- D1 Time Travel ------------------------------------------------------------------------------------
    def time_travel_info(self) -> dict[str, Any]:
        config = self.ctx.config
        now = self.ctx.clock.utcnow()
        return {
            "retention_days": config.d1_time_travel_days,
            "earliest": iso_z((now - timedelta(days=config.d1_time_travel_days)).strftime("%Y-%m-%d %H:%M:%S")),
            "api_enabled": config.time_travel_api_enabled,
            "database_name": config.d1_database_name,
            "cli_command": f"npx wrangler d1 time-travel restore {config.d1_database_name} --timestamp=<UNIX_SECONDS>",
        }

    async def time_travel_restore(self, timestamp: datetime) -> dict[str, Any]:
        config = self.ctx.config
        now = self.ctx.clock.utcnow()
        when = timestamp.astimezone(timezone.utc) if timestamp.tzinfo else timestamp.replace(tzinfo=timezone.utc)
        if when >= now:
            raise ValidationFailed("Choose a moment in the past.", fields={"timestamp": "Must be in the past"})
        if when < now - timedelta(days=config.d1_time_travel_days):
            raise ValidationFailed(
                f"Time Travel only reaches back {config.d1_time_travel_days} days. Use a downloaded backup for older data.",
                fields={"timestamp": f"Within the last {config.d1_time_travel_days} days"},
            )
        if not config.time_travel_api_enabled:
            raise Conflict("In-app restore isn't configured. Run the command shown on this page instead.")
        iso = when.strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            outcome = await time_travel_restore(config, iso)
        except CloudflareError as exc:
            raise ServiceUnavailable(f"The restore could not be started: {exc}") from None
        # The database now reflects the earlier point in time; record the restore in it.
        await self.repo.create(
            kind="TIME_TRAVEL", status="COMPLETED", tables="database", period_from=None, period_to=None, watermarks=None,
            record_count=0, file_name=None, notes=f"Restored to {iso}. Undo bookmark: {outcome.previous_bookmark or '-'}"[:200],
            created_by=self.ctx.actor_id, now=self.ctx.now,
        )
        # Cached settings and sessions may describe the replaced database state.
        settings_service.invalidate_cache()
        session_cache.clear()
        return {"restored_to": iso, "bookmark": outcome.bookmark, "previous_bookmark": outcome.previous_bookmark, "message": outcome.message}


def _coerce(raw: Any, columns: tuple[str, ...], types: dict[str, str]) -> dict[str, Any] | None:
    """Keep known columns with the right types; reject malformed rows."""
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    try:
        for column in columns:
            value = raw.get(column)
            if value is None or value == "":
                out[column] = None
                continue
            kind = types.get(column, "text")
            if kind == "int":
                out[column] = int(value)
            elif kind == "real":
                out[column] = float(value)
            else:
                text = str(value)
                if len(text) > 400:
                    return None
                out[column] = text
    except (TypeError, ValueError):
        return None
    if not isinstance(out.get("id"), int) or out["id"] <= 0:
        return None
    return out
