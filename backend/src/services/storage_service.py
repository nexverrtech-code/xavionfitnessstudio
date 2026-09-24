"""StorageService: database usage against the D1 Free limit, before it becomes a problem.

SmartGym's own thresholds (not Cloudflare limits):

    < 70 %   HEALTHY
    70–80 %  MONITOR
    80–90 %  WARNING
    90–95 %  CRITICAL
    > 95 %   ARCHIVE_REQUIRED

The daily job stores a snapshot (size + row counts); the Data & Backup page reads it. Per-table
sizes are estimates (D1 reports only the total database size).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from core.errors import TooManyRequests
from repositories.storage import StorageRepository

from .context import Ctx
from .notification_service import NotificationService

LEVELS = ((70, "HEALTHY"), (80, "MONITOR"), (90, "WARNING"), (95, "CRITICAL"))
# Approximate bytes per row including index entries; scaled to the real database size.
ROW_BYTES = {
    "members": 330, "users": 260, "trainers": 240, "membership_plans": 200, "memberships": 150, "payments": 290,
    "refunds": 180, "attendance": 120, "workout_plans": 200, "workout_exercises": 110, "body_measurements": 120,
    "notifications": 230, "expenses": 160, "settings": 80, "backups": 260, "storage_snapshots": 420,
}
ARCHIVABLE = {
    "attendance": "attendance", "payments": "payments", "refunds": "payments", "memberships": "memberships",
    "notifications": "notifications", "expenses": "expenses", "workout_plans": "workouts",
    "workout_exercises": "workouts", "body_measurements": "progress",
}


def storage_level(percent: float) -> str:
    for limit, name in LEVELS:
        if percent < limit:
            return name
    return "ARCHIVE_REQUIRED"


def human_bytes(value: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1000 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1000
    return f"{value:.1f} GB"


class StorageService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.repo = StorageRepository(ctx.db)

    async def take_snapshot(self) -> dict[str, Any]:
        db_bytes = await self.repo.database_bytes()
        counts = await self.repo.row_counts()
        today = self.ctx.clock.today()
        await self.repo.save_snapshot(today.isoformat(), db_bytes, counts, self.ctx.now)
        await self.repo.prune_snapshots((today - timedelta(days=400)).isoformat())
        return {"date": today.isoformat(), "db_bytes": db_bytes, "counts": counts}

    async def refresh(self) -> dict[str, Any]:
        """Admin "Refresh now": re-measure, at most every 10 minutes (row counts read every row)."""
        snapshots = await self.repo.snapshots(1)
        if snapshots and snapshots[0]["snapshot_date"] == self.ctx.clock.today().isoformat():
            taken = snapshots[0]["created_at"]
            recent = self.ctx.clock.utcnow() - timedelta(minutes=10)
            if taken >= recent.strftime("%Y-%m-%d %H:%M:%S"):
                raise TooManyRequests("Storage was measured a few minutes ago. Try again in a little while.")
        await self.take_snapshot()
        return await self.overview()

    async def overview(self) -> dict[str, Any]:
        config = self.ctx.config
        snapshots = await self.repo.snapshots(120)
        if not snapshots:
            await self.take_snapshot()
            snapshots = await self.repo.snapshots(120)
        latest = snapshots[0]
        used = latest["db_bytes"]
        limit = config.d1_max_bytes
        percent = used / limit * 100 if limit else 0.0
        level = storage_level(percent)
        today = self.ctx.clock.today()

        # Growth: compare with the snapshot closest to 30 days earlier.
        older = next((s for s in snapshots if s["snapshot_date"] <= (today - timedelta(days=30)).isoformat()), snapshots[-1])
        span_days = max(1, (date.fromisoformat(latest["snapshot_date"]) - date.fromisoformat(older["snapshot_date"])).days)
        byte_growth = (used - older["db_bytes"]) / span_days if older is not latest else 0.0

        counts = latest["counts"]
        estimated = {t: counts.get(t, 0) * ROW_BYTES.get(t, 150) for t in counts}
        total_estimated = sum(estimated.values()) or 1
        payload_bytes = max(used - 120_000, 0)  # schema / page overhead
        oldest = await self.repo.oldest()
        tables = []
        for name, rows in sorted(counts.items(), key=lambda kv: -estimated.get(kv[0], 0)):
            previous = older["counts"].get(name, rows)
            tables.append(
                {
                    "table": name,
                    "rows": rows,
                    "estimated_bytes": int(payload_bytes * estimated[name] / total_estimated),
                    "rows_per_day": round((rows - previous) / span_days, 1) if older is not latest else None,
                    "dataset": ARCHIVABLE.get(name),
                    "oldest": oldest.get(name),
                }
            )
        settings = await self.ctx.settings()
        cutoff = _months_ago(today, settings["archive_after_months"])
        days_to_warning = None
        if byte_growth > 0 and percent < 80:
            days_to_warning = int((limit * 0.8 - used) / byte_growth)
        return {
            "used_bytes": used,
            "limit_bytes": limit,
            "remaining_bytes": max(limit - used, 0),
            "percent": round(percent, 2),
            "status": level,
            "thresholds": [{"below": b, "status": s} for b, s in LEVELS] + [{"below": None, "status": "ARCHIVE_REQUIRED"}],
            "as_of": latest["snapshot_date"],
            "measured_at": latest["created_at"].replace(" ", "T") + "Z",
            "growth_bytes_per_day": round(byte_growth),
            "days_until_warning": days_to_warning,
            "tables": tables,
            "archive_suggestion": {
                "before": cutoff.isoformat(),
                "archive_after_months": settings["archive_after_months"],
                "candidates": [
                    {"table": t["table"], "dataset": t["dataset"], "oldest": t["oldest"]}
                    for t in tables
                    if t["dataset"] and t["oldest"] and t["oldest"] < cutoff.isoformat()
                ],
            },
            "history": [{"date": s["snapshot_date"], "bytes": s["db_bytes"]} for s in reversed(snapshots[:90])],
            "d1": {
                "plan_limit_bytes": limit,
                "time_travel_days": config.d1_time_travel_days,
                "free_daily_rows_read": 5_000_000,
                "free_daily_rows_written": 100_000,
            },
        }

    async def alert_if_needed(self) -> int:
        """Daily: tell admins in-app while storage is at WARNING or above."""
        settings = await self.ctx.settings()
        if not settings["storage_alerts_enabled"]:
            return 0
        snapshots = await self.repo.snapshots(1)
        if not snapshots:
            return 0
        used, limit = snapshots[0]["db_bytes"], self.ctx.config.d1_max_bytes
        percent = used / limit * 100 if limit else 0
        level = storage_level(percent)
        if level in ("HEALTHY", "MONITOR"):
            return 0
        return await NotificationService(self.ctx).storage_alert(level=level, percent=percent, used=human_bytes(used), limit=human_bytes(limit))


def _months_ago(today: date, months: int) -> date:
    month_index = today.month - 1 - months
    year = today.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)
