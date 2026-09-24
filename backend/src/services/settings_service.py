"""Gym settings: defaults in code, admin overrides in the small ``settings`` table.

Settings change rarely, so business logic reads them from a short per-isolate cache (15 s).
Screens that show them — the public gym profile and the Settings page — read them fresh, so a
change (e.g. a new gym name) appears everywhere as soon as it is saved.
"""

from __future__ import annotations

import re
from typing import Any

from core.cache import TTLCache
from core.clock import Clock
from core.database import Database
from core.errors import ValidationFailed
from repositories.settings import SettingsRepository
from utils.formatting import is_valid_email
from utils.upi import is_valid_vpa

DEFAULTS: dict[str, str] = {
    "gym_name": "SmartGym",
    "gym_address": "",
    "gym_phone": "",
    "gym_email": "",
    "currency": "INR",
    "member_code_prefix": "GYM",
    # Direct UPI (the gym's own UPI ID; members pay from any UPI app and submit the UTR).
    "upi_enabled": "1",
    "upi_id": "",
    "upi_name": "",
    # In-app notifications.
    "reminders_enabled": "1",
    "notify_payment": "1",
    "notify_activation": "1",
    "notify_renewal": "1",
    "notify_trainer": "1",
    # Attendance.
    "attendance_checkout": "0",
    "attendance_grace_days": "0",
    "attendance_cooldown_minutes": "10",
    # Data retention (agreed with the gym owner).
    "notification_retention_days": "180",
    "archive_after_months": "24",
    "storage_alerts_enabled": "1",
}

BOOL_KEYS = {
    "upi_enabled", "reminders_enabled", "notify_payment", "notify_activation", "notify_renewal", "notify_trainer",
    "attendance_checkout", "storage_alerts_enabled",
}
INT_KEYS = {
    "attendance_grace_days": (0, 7),
    "attendance_cooldown_minutes": (1, 240),
    "notification_retention_days": (30, 730),
    "archive_after_months": (6, 120),
}

_cache = TTLCache(15, 2)


def _parse(key: str, raw: str) -> Any:
    if key in BOOL_KEYS:
        return raw == "1"
    if key in INT_KEYS:
        try:
            return int(raw)
        except ValueError:
            return int(DEFAULTS[key])
    return raw


async def get_settings(db: Database, *, fresh: bool = False) -> dict[str, Any]:
    cached = None if fresh else _cache.get("settings")
    if cached is not None:
        return cached
    stored = await SettingsRepository(db).all()
    raw = dict(DEFAULTS)
    raw.update({k: v for k, v in stored.items() if k in DEFAULTS})
    settings = {key: _parse(key, value) for key, value in raw.items()}
    _cache.set("settings", settings)
    return settings


def invalidate_cache() -> None:
    _cache.clear()


def _validate(key: str, value: Any) -> str:
    if key not in DEFAULTS:
        raise ValidationFailed("Unknown setting.", fields={key: "Unknown setting"})
    if key in BOOL_KEYS:
        if not isinstance(value, bool):
            raise ValidationFailed("Invalid value.", fields={key: "Must be on or off"})
        return "1" if value else "0"
    if key in INT_KEYS:
        low, high = INT_KEYS[key]
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise ValidationFailed("Invalid value.", fields={key: f"Must be between {low} and {high}"})
        return str(value)
    text = " ".join(str(value or "").split())
    if key == "gym_name" and not 2 <= len(text) <= 60:
        raise ValidationFailed("Gym name is required.", fields={key: "Use 2–60 characters"})
    if key == "gym_address" and len(text) > 200:
        raise ValidationFailed("Address is too long.", fields={key: "Use at most 200 characters"})
    if key == "gym_phone" and text and not re.fullmatch(r"[0-9+\-\s()]{7,20}", text):
        raise ValidationFailed("Enter a valid phone number.", fields={key: "Enter a valid phone number"})
    if key == "gym_email" and text and not is_valid_email(text):
        raise ValidationFailed("Enter a valid email address.", fields={key: "Enter a valid email address"})
    if key == "currency" and not re.fullmatch(r"[A-Z]{3}", text):
        raise ValidationFailed("Invalid currency.", fields={key: "Use a 3-letter currency code such as INR"})
    if key == "member_code_prefix" and not re.fullmatch(r"[A-Z]{2,5}", text):
        raise ValidationFailed("Invalid member ID prefix.", fields={key: "Use 2–5 capital letters"})
    if key == "upi_id" and text and not is_valid_vpa(text):
        raise ValidationFailed("Enter a valid UPI ID.", fields={key: "Enter a valid UPI ID such as smartgym@upi"})
    if key == "upi_name" and len(text) > 40:
        raise ValidationFailed("Display name is too long.", fields={key: "Use at most 40 characters"})
    return text


async def update_settings(db: Database, clock: Clock, changes: dict[str, Any]) -> dict[str, Any]:
    validated = {key: _validate(key, value) for key, value in changes.items()}
    if "upi_enabled" in changes or "upi_id" in changes:
        current = await get_settings(db)
        enabled = changes.get("upi_enabled", current["upi_enabled"])
        upi_id = validated.get("upi_id", current["upi_id"])
        if enabled and not upi_id:
            raise ValidationFailed("Add your UPI ID to accept UPI payments.", fields={"upi_id": "Required when UPI is on"})
    if validated:
        await SettingsRepository(db).save(validated, clock.now_ts())
    invalidate_cache()
    return await get_settings(db, fresh=True)
