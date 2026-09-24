"""The daily scheduled Worker (Cloudflare Cron Trigger, 06:00 IST).

    1. membership statuses: ACTIVE -> EXPIRING -> EXPIRED, members -> EXPIRED   (indexed on end_date)
    2. in-app reminders 7 / 3 / 1 days before expiry and once after expiry       (de-duplicated)
    3. clean-up of non-critical data only: old notifications, unfinished backups
    4. storage snapshot (database size + row counts) and admin storage alerts

About a dozen D1 statements in total — well inside the Free plan's 50 per invocation — and
no frontend polling is ever used for any of this.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from core.clock import Clock, fmt_ts
from core.config import AppConfig
from core.database import Database
from repositories.backups import BackupRepository
from repositories.memberships import MembershipRepository
from services.context import Ctx
from services.notification_service import NotificationService
from services.storage_service import StorageService

logger = logging.getLogger("smartgym.jobs")

DAILY_CRON = "30 0 * * *"


async def sync_membership_statuses(ctx: Ctx) -> dict[str, int]:
    today = ctx.clock.today()
    now = ctx.now
    repo = MembershipRepository(ctx.db)
    members, expired, expiring = await ctx.db.batch(
        [
            repo.expire_members_stmt(today.isoformat(), now),
            repo.mark_expired_stmt(today.isoformat(), now),
            repo.mark_expiring_stmt(today.isoformat(), (today + timedelta(days=7)).isoformat(), now),
        ]
    )
    return {"members_expired": members.changes, "memberships_expired": expired.changes, "memberships_expiring": expiring.changes}


async def cleanup(ctx: Ctx) -> dict[str, int]:
    notifications = await NotificationService(ctx).cleanup()
    stale = await BackupRepository(ctx.db).expire_stale(fmt_ts(ctx.clock.utcnow() - timedelta(days=7)))
    return {"notifications_removed": notifications, "unverified_backups_closed": stale}


async def storage(ctx: Ctx) -> dict[str, Any]:
    service = StorageService(ctx)
    snapshot = await service.take_snapshot()
    alerts = await service.alert_if_needed()
    return {"db_bytes": snapshot["db_bytes"], "alerts": alerts}


async def run_daily_jobs(db: Database, config: AppConfig) -> dict[str, Any]:
    ctx = Ctx(db=db, clock=Clock(config.gym_utc_offset_minutes), config=config)
    report: dict[str, Any] = {}
    for name, job in (
        ("memberships", sync_membership_statuses),
        ("reminders", lambda c: NotificationService(c).run_reminders()),
        ("cleanup", cleanup),
        ("storage", storage),
    ):
        try:
            report[name] = await job(ctx)
        except Exception:  # one failing job must not block the others
            logger.exception("scheduled job %s failed", name)
            report[name] = "failed"
    logger.info("daily run %s", report)
    return report
