"""DashboardService: KPIs, trends and recent activity — computed from the database, never
hard-coded. Revenue = money collected (PAID, incl. later-refunded payments) minus refunds."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from core.cache import TTLCache
from core.clock import add_months, iso_z
from repositories.dashboard import DashboardRepository
from utils.formatting import format_inr

from .attendance_service import VisitRules
from .context import Ctx
from .storage_service import storage_level


_history = TTLCache(3600, 16)


class DashboardService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.repo = DashboardRepository(ctx.db)

    async def summary(self) -> dict[str, Any]:
        today = self.ctx.clock.today()
        month_start = today.replace(day=1)
        prev_month_start = add_months(month_start, -1)
        prev_same_day = min(add_months(today, -1), month_start - timedelta(days=1))
        rules = VisitRules.build(await self.ctx.settings(), self.ctx.now)
        members, expiring, attendance, collected, refunds, pending, expenses, snapshot = await self.repo.summary(
            today=today.isoformat(), yesterday=(today - timedelta(days=1)).isoformat(),
            soon=(today + timedelta(days=7)).isoformat(), month_start=month_start.isoformat(),
            prev_month_start=prev_month_start.isoformat(), prev_same_day=prev_same_day.isoformat(),
            open_after=rules.open_after,
        )
        m = members.first or {}
        seen = attendance.first or {}
        paid, back = collected.first or {}, refunds.first or {}
        month_revenue = int(paid.get("month") or 0) - int(back.get("month") or 0)
        month_expenses = int((expenses.first or {}).get("total") or 0)
        out: dict[str, Any] = {
            "date": today.isoformat(),
            "members": {
                "total": m.get("total", 0),
                "active": m.get("active", 0),
                "expired": m.get("expired", 0),
                "inactive": m.get("inactive", 0),
                "suspended": m.get("suspended", 0),
                "expiring": (expiring.first or {}).get("c", 0),
                "joined_this_month": m.get("joined_this_month", 0),
            },
            # today / yesterday = members present (once a day however many visits).
            "attendance": {
                "today": seen.get("today", 0),
                "yesterday": seen.get("yesterday", 0),
                "visits_today": seen.get("today_visits", 0),
                "in_gym": seen.get("in_gym", 0) if rules.checkout else None,
            },
            "revenue": {
                "today": int(paid.get("today") or 0) - int(back.get("today") or 0),
                "month": month_revenue,
                "month_payments": paid.get("month_count", 0),
                "month_refunds": int(back.get("month") or 0),
                "previous_month_same_period": int(paid.get("prev_period") or 0) - int(back.get("prev_period") or 0),
            },
            "pending_payments": {"count": (pending.first or {}).get("c", 0), "amount": (pending.first or {}).get("amount", 0)},
            "expenses": {"month": month_expenses},
            "net_revenue": month_revenue - month_expenses,
        }
        snap = snapshot.first
        if snap and self.ctx.user and self.ctx.user.is_admin:
            percent = snap["db_bytes"] / self.ctx.config.d1_max_bytes * 100
            out["storage"] = {"percent": round(percent, 1), "level": storage_level(percent), "as_of": snap["snapshot_date"]}
        return out

    async def _chart_history(self, months: int, today: date, first_month: date, month_start: date,
                             attendance_from: date) -> list[list[dict[str, Any]]]:
        """Months before this one and days before today, computed at most once a day (this isolate's
        memory, then one D1 row) instead of on every dashboard visit: the bulk of the chart rows.
        ponytail: a change dated in an earlier month (or a removed past visit) reaches the charts the
        next day; reports always read live. Clear dashboard_cache if it must show at once."""
        key = f"charts:{months}:{today.isoformat()}"
        history = _history.get(key)
        if history is None:
            raw = await self.repo.cached(key)
            if raw:
                history = json.loads(raw)
            else:
                results = await self.repo.chart_history(first_month=first_month.isoformat(), month_start=month_start.isoformat(),
                                                        attendance_from=attendance_from.isoformat(), today=today.isoformat())
                history = [r.rows for r in results]
                await self.repo.cache(key, json.dumps(history, separators=(",", ":")), self.ctx.now)
            _history.set(key, history)
        return history

    async def charts(self, months: int = 6) -> dict[str, Any]:
        today = self.ctx.clock.today()
        month_start = today.replace(day=1)
        first_month = add_months(month_start, -(months - 1))
        attendance_from = today - timedelta(days=29)
        past = await self._chart_history(months, today, first_month, month_start, attendance_from)
        *live, methods, plans = await self.repo.chart_live(
            month_start=month_start.isoformat(), today=today.isoformat(), tomorrow=(today + timedelta(days=1)).isoformat()
        )
        # Past and live rows never overlap (earlier months / days vs this month / today).
        revenue, refunds, expenses, memberships, visits = (old + new.rows for old, new in zip(past, live))
        revenue_by = {r["month"]: r for r in revenue}
        refunds_by = {r["month"]: r["refunds"] for r in refunds}
        expenses_by = {r["month"]: r["total"] for r in expenses}
        memberships_by = {r["month"]: r for r in memberships}
        visits_by = {r["date"]: r for r in visits}
        month_keys = [add_months(first_month, i).strftime("%Y-%m") for i in range(months)]
        return {
            "revenue_trend": [
                {
                    "month": key,
                    "revenue": revenue_by.get(key, {}).get("revenue", 0) - refunds_by.get(key, 0),
                    "expenses": expenses_by.get(key, 0),
                    "payments": revenue_by.get(key, {}).get("payments", 0),
                }
                for key in month_keys
            ],
            "membership_trend": [
                {
                    "month": key,
                    "new": memberships_by.get(key, {}).get("total", 0) - memberships_by.get(key, {}).get("renewals", 0),
                    "renewals": memberships_by.get(key, {}).get("renewals", 0),
                }
                for key in month_keys
            ],
            "attendance_trend": [
                {
                    "date": (d := (attendance_from + timedelta(days=i)).isoformat()),
                    "members": visits_by.get(d, {}).get("members", 0),
                    "visits": visits_by.get(d, {}).get("visits", 0),
                }
                for i in range(30)
            ],
            "payment_methods": methods.rows,
            "plan_distribution": plans.rows,
        }

    async def activity(self, limit: int = 14) -> list[dict[str, Any]]:
        joined, paid, memberships, visits, expenses, pending, refunds = await self.repo.activity()
        events: list[dict[str, Any]] = []
        for r in joined.rows:
            events.append({"type": "MEMBER_JOINED", "at": iso_z(r["created_at"]), "title": f"New member registered · {r['name']}", "member_id": r["id"]})
        for r in paid.rows:
            events.append({"type": "PAYMENT_RECEIVED", "at": iso_z(r["verified_at"]),
                           "title": f"Payment received · {format_inr(r['amount'])} from {r['name']}", "member_id": r["member_id"]})
        for r in memberships.rows:
            verb = "Membership renewed" if r["is_renewal"] else "Membership started"
            events.append({"type": "MEMBERSHIP", "at": iso_z(r["created_at"]), "title": f"{verb} · {r['name']} ({r['plan']})", "member_id": r["member_id"]})
        for r in visits.rows:
            events.append({"type": "ATTENDANCE", "at": iso_z(r["check_in"]), "title": f"Attendance marked · {r['name']}", "member_id": r["member_id"]})
        for r in expenses.rows:
            events.append({"type": "EXPENSE", "at": iso_z(r["created_at"]),
                           "title": f"Expense recorded · {r['category'].title()} {format_inr(r['amount'])}", "member_id": None})
        for r in pending.rows:
            events.append({"type": "PAYMENT_PENDING", "at": iso_z(r["created_at"]),
                           "title": f"UPI payment awaiting verification · {r['name']}", "member_id": r["member_id"]})
        for r in refunds.rows:
            events.append({"type": "REFUND", "at": iso_z(r["created_at"]),
                           "title": f"Refund recorded · {format_inr(r['amount'])} to {r['name']}", "member_id": r["member_id"]})
        events.sort(key=lambda e: e["at"] or "", reverse=True)
        return events[:limit]
