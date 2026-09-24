"""DashboardService: KPIs, trends and recent activity — computed from the database, never
hard-coded. Revenue = money collected (PAID, incl. later-refunded payments) minus refunds."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from core.clock import add_months, iso_z
from repositories.dashboard import DashboardRepository
from utils.formatting import format_inr

from .context import Ctx
from .storage_service import storage_level


class DashboardService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.repo = DashboardRepository(ctx.db)

    async def summary(self) -> dict[str, Any]:
        today = self.ctx.clock.today()
        month_start = today.replace(day=1)
        prev_month_start = add_months(month_start, -1)
        prev_same_day = min(add_months(today, -1), month_start - timedelta(days=1))
        members, expiring, attendance, collected, refunds, pending, expenses, snapshot = await self.repo.summary(
            today=today.isoformat(), yesterday=(today - timedelta(days=1)).isoformat(),
            soon=(today + timedelta(days=7)).isoformat(), month_start=month_start.isoformat(),
            prev_month_start=prev_month_start.isoformat(), prev_same_day=prev_same_day.isoformat(),
        )
        m = members.first or {}
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
            "attendance": {"today": (attendance.first or {}).get("today", 0), "yesterday": (attendance.first or {}).get("yesterday", 0)},
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

    async def charts(self, months: int = 6) -> dict[str, Any]:
        today = self.ctx.clock.today()
        first_month = add_months(today.replace(day=1), -(months - 1))
        attendance_from = today - timedelta(days=29)
        revenue, refunds, expenses, memberships, visits, methods, plans = await self.repo.charts(
            first_month=first_month.isoformat(), today=today.isoformat(), attendance_from=attendance_from.isoformat(),
            month_start=today.replace(day=1).isoformat(),
        )
        revenue_by = {r["month"]: r for r in revenue.rows}
        refunds_by = {r["month"]: r["refunds"] for r in refunds.rows}
        expenses_by = {r["month"]: r["total"] for r in expenses.rows}
        memberships_by = {r["month"]: r for r in memberships.rows}
        visits_by = {r["date"]: r["visits"] for r in visits.rows}
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
                {"date": (d := (attendance_from + timedelta(days=i)).isoformat()), "visits": visits_by.get(d, 0)} for i in range(30)
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
