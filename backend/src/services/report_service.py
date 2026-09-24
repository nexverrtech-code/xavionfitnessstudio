"""ReportService: member, membership, payment, attendance and expense reports, on demand.

The Worker returns the figures and rows as JSON; the browser turns them into CSV or PDF.
Nothing is generated or stored on the server, which keeps CPU time within the Workers Free
plan and D1 free of files.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from core.errors import ValidationFailed
from repositories.reports import ReportRepository

from .context import Ctx

ROW_CAP = 10_000
KINDS = ("members", "memberships", "payments", "attendance", "expenses")
TITLES = {
    "members": "Member Report",
    "memberships": "Membership Report",
    "payments": "Payment Report",
    "attendance": "Attendance Report",
    "expenses": "Expense Report",
}


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


class ReportService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.repo = ReportRepository(ctx.db)

    async def build(self, kind: str, start: date | None, end: date | None) -> str:
        """Report as a JSON document (string): summary figures + detail rows (capped)."""
        if kind not in KINDS:
            raise ValidationFailed("Unknown report.")
        today = self.ctx.clock.today()
        start = start or today.replace(day=1)
        end = end or today
        if end < start:
            raise ValidationFailed("The end date must be on or after the start date.", fields={"to": "Must be after the start date"})
        if (end - start).days > 731:
            raise ValidationFailed("Choose a period of up to two years.", fields={"from": "Up to two years"})
        low, high = start.isoformat(), end.isoformat()
        summary: dict[str, Any]
        if kind == "members":
            summary = dict((await self.repo.member_summary(low, high)).first or {})
            fetch = self.repo.member_rows
        elif kind == "memberships":
            summary = {"plans": (await self.repo.membership_by_plan(low, high, today.isoformat())).rows}
            fetch = self.repo.membership_rows
        elif kind == "payments":
            methods, refunds, statuses = await self.repo.payment_by_method(low, high)
            by_method = {r["method"]: r for r in methods.rows}
            collected = sum(r["amount"] for r in methods.rows)
            refunded = (refunds.first or {}).get("amount", 0)
            summary = {
                "methods": [
                    {"method": m, "count": by_method.get(m, {}).get("count", 0), "amount": by_method.get(m, {}).get("amount", 0)}
                    for m in ("CASH", "UPI", "BANK_TRANSFER", "CARD_MANUAL")
                ],
                "collected": collected,
                "refunds": refunded,
                "refund_count": (refunds.first or {}).get("count", 0),
                "total_revenue": collected - refunded,
                "statuses": statuses.rows,
            }
            fetch = self.repo.payment_rows
        elif kind == "attendance":
            daily = (await self.repo.attendance_daily(low, high)).rows
            weekly: dict[str, dict[str, int]] = {}
            monthly: dict[str, dict[str, int]] = {}
            for r in daily:
                d = date.fromisoformat(r["date"])
                week = weekly.setdefault(_week_start(d).isoformat(), {"visits": 0, "days": 0})
                month = monthly.setdefault(r["date"][:7], {"visits": 0, "days": 0})
                for bucket in (week, month):
                    bucket["visits"] += r["visits"]
                    bucket["days"] += 1
            summary = {
                "total_visits": sum(r["visits"] for r in daily),
                "daily": daily,
                "weekly": [{"week_start": k, **v} for k, v in sorted(weekly.items())],
                "monthly": [{"month": k, **v} for k, v in sorted(monthly.items())],
            }
            fetch = self.repo.attendance_rows
        else:
            categories = (await self.repo.expense_by_category(low, high)).rows
            summary = {"categories": categories, "total": sum(c["amount"] for c in categories)}
            fetch = self.repo.expense_rows

        # Detail rows arrive as JSON text straight from D1 and are never parsed here. One extra row
        # is requested to detect a cut-off; in that rare case the capped page is fetched again.
        rows = await fetch(low, high, ROW_CAP + 1)
        truncated = rows.count > ROW_CAP
        if truncated:
            rows = await fetch(low, high, ROW_CAP)
        settings = await self.ctx.settings()
        head = {
            "kind": kind,
            "title": TITLES[kind],
            "gym_name": settings["gym_name"],
            "from": low,
            "to": high,
            "generated_at": self.ctx.clock.now_ts().replace(" ", "T") + "Z",
            "summary": summary,
            "truncated": truncated,
            "row_cap": ROW_CAP,
        }
        return json.dumps(head, separators=(",", ":"), ensure_ascii=False)[:-1] + ',"rows":' + rows.text + "}"
