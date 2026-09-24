"""Membership status rules — the backend is the single source of truth.

    more than 7 days remaining -> ACTIVE
    7 days or less remaining   -> EXPIRING
    expiry date passed         -> EXPIRED

End dates are inclusive: a 30-day plan starting on the 1st ends on the 30th.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from core.clock import iso_z
from models.domain import EXPIRING_WINDOW_DAYS


def coverage_state(expiry_date: str | None, today: date) -> dict[str, Any]:
    """A member's overall state from the end date of their latest paid membership."""
    if not expiry_date:
        return {"status": "NONE", "expiry_date": None, "days_left": None}
    days = (date.fromisoformat(expiry_date) - today).days
    if days < 0:
        status = "EXPIRED"
    elif days <= EXPIRING_WINDOW_DAYS:
        status = "EXPIRING"
    else:
        status = "ACTIVE"
    return {"status": status, "expiry_date": expiry_date, "days_left": days}


def effective_status(row: dict[str, Any], today: date) -> str:
    """Status of one membership record: dates win over the stored value (the daily job only
    keeps the stored value in sync for reporting)."""
    if row.get("status") == "CANCELLED":
        return "CANCELLED"
    if row["start_date"] > today.isoformat():
        return "UPCOMING"
    return coverage_state(row["end_date"], today)["status"]


def stored_status(end_date: date, today: date) -> str:
    """Value written when a membership is created."""
    return "EXPIRING" if (end_date - today).days <= EXPIRING_WINDOW_DAYS else "ACTIVE"


def end_date_for(start: date, duration_days: int) -> date:
    return start + timedelta(days=duration_days - 1)


def next_start(coverage_end: str | None, today: date) -> date:
    """A renewal starts the day after the current membership ends (no lost days), or today."""
    if coverage_end:
        end = date.fromisoformat(coverage_end)
        if end >= today:
            return end + timedelta(days=1)
    return today


def membership_out(row: dict[str, Any], today: date) -> dict[str, Any]:
    status = effective_status(row, today)
    days_left = None if status == "CANCELLED" else (date.fromisoformat(row["end_date"]) - today).days
    return {
        "id": row["id"],
        "member_id": row.get("member_id"),
        "plan_id": row.get("plan_id"),
        "plan_name": row.get("plan_name"),
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "amount": row.get("amount"),
        "status": status,
        "days_left": days_left,
        "created_at": iso_z(row.get("created_at")),
    }
