"""Time helpers for a single-timezone gym.

Timestamps are stored as UTC ``YYYY-MM-DD HH:MM:SS`` strings (sortable, SQLite-native).
Business dates (attendance day, membership start/end, expense date) use the gym's local
calendar. A fixed UTC offset is used instead of zoneinfo: India has no DST, and this keeps
the Worker free of tzdata.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta, timezone

TS_FORMAT = "%Y-%m-%d %H:%M:%S"


def fmt_ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(TS_FORMAT)


def parse_ts(value: str) -> datetime:
    return datetime.strptime(value[:19].replace("T", " "), TS_FORMAT).replace(tzinfo=timezone.utc)


def iso_z(value: str | None) -> str | None:
    """'2026-09-23 10:15:00' -> '2026-09-23T10:15:00Z' for the API."""
    if not value:
        return None
    return value[:19].replace(" ", "T") + "Z"


def add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


class Clock:
    # Tests may freeze time by assigning an aware UTC datetime here.
    frozen: datetime | None = None

    def __init__(self, utc_offset_minutes: int = 330) -> None:
        self.offset_minutes = utc_offset_minutes
        self.tz = timezone(timedelta(minutes=utc_offset_minutes))

    def utcnow(self) -> datetime:
        now = Clock.frozen or datetime.now(timezone.utc)
        return now.replace(microsecond=0)

    def now_ts(self) -> str:
        return fmt_ts(self.utcnow())

    def local_now(self) -> datetime:
        return self.utcnow().astimezone(self.tz)

    def today(self) -> date:
        return self.local_now().date()

    def day_start_utc(self, d: date) -> str:
        """UTC timestamp of local midnight at the start of ``d``."""
        return fmt_ts(datetime.combine(d, time.min, tzinfo=self.tz))

    def day_range_utc(self, start: date, end_inclusive: date) -> tuple[str, str]:
        return self.day_start_utc(start), self.day_start_utc(end_inclusive + timedelta(days=1))

    def local_date_of(self, ts: str) -> date:
        return parse_ts(ts).astimezone(self.tz).date()

    @property
    def sqlite_modifier(self) -> str:
        """SQLite date modifier that shifts UTC timestamps to local time, e.g. '+330 minutes'."""
        return f"{self.offset_minutes:+d} minutes"
