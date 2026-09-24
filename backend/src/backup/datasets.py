"""What a SmartGym backup contains, and how each table is exported, archived and restored.

A backup is a ZIP the admin downloads (built in the browser from data this Worker streams):

    metadata.json, members.csv, memberships.csv, payments.csv, refunds.csv, attendance.csv,
    expenses.csv, workout_history.csv, notifications.csv, progress.csv

workout_history.csv holds workout plans and their exercises together (one row per exercise,
plan columns repeated); the browser joins / splits the two tables.

Rules:
- ``members`` is reference data: always exported, never archived (history depends on it).
- Archiving removes only *eligible* rows of the chosen period that existed when the backup
  was taken (row id <= the recorded watermark). Payments awaiting verification, active
  workout plans and anything newer are never removed.
- Restoring only ADDS rows whose id is missing. Existing records are never overwritten, and
  rows whose parent records no longer exist are skipped (and reported).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Data sets the admin can select (members.csv is always added).
SELECTABLE = ("attendance", "payments", "memberships", "expenses", "workouts", "notifications", "progress")
LABELS = {
    "members": "Members",
    "attendance": "Attendance",
    "payments": "Payments & refunds",
    "memberships": "Memberships",
    "expenses": "Expenses",
    "workouts": "Workout history",
    "notifications": "Notifications",
    "progress": "Progress (body measurements)",
}


@dataclass(frozen=True)
class Table:
    name: str                      # SQL table
    dataset: str                   # selection it belongs to
    file: str                      # CSV file in the ZIP
    columns: tuple[str, ...]       # exported / restored columns, in CSV order
    types: dict[str, str]          # column -> int | real | text (for restore typing)
    period: str | None             # SQL condition on the period (?P1 = from, ?P2 = to), alias t
    archive: str | None = None     # extra eligibility condition for archiving (alias t); None = not archivable
    required: dict[str, str] = field(default_factory=dict)   # column -> parent table (row skipped if missing)
    optional: dict[str, str] = field(default_factory=dict)   # column -> parent table (NULL if missing)
    restore_filter: str | None = None  # extra restore condition on the JSON row (alias j)
    defaults: dict[str, str] = field(default_factory=dict)   # extra column -> SQL value on restore


def _types(ints: str = "", reals: str = "", texts: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for kind, names in (("int", ints), ("real", reals), ("text", texts)):
        for name in names.split():
            out[name] = kind
    return out


TIMESTAMP_PERIOD = "t.{col} >= ?P1 AND t.{col} < date(?P2, '+1 day')"

TABLES: tuple[Table, ...] = (
    Table(
        name="members", dataset="members", file="members.csv",
        columns=("id", "member_code", "name", "phone", "email", "gender", "date_of_birth", "address", "emergency_contact",
                 "joining_date", "trainer_id", "status", "created_by", "created_at", "updated_at"),
        types=_types("id trainer_id created_by",
                     texts="member_code name phone email gender date_of_birth address emergency_contact joining_date status "
                           "created_at updated_at"),
        period=None,
        optional={"trainer_id": "trainers", "created_by": "users"},
        # QR tokens are never written to backup files; restored members get a fresh one.
        defaults={"qr_token": "lower(hex(randomblob(16)))"},
    ),
    Table(
        name="memberships", dataset="memberships", file="memberships.csv",
        columns=("id", "member_id", "plan_id", "start_date", "end_date", "amount", "status", "created_by", "created_at", "updated_at"),
        types=_types("id member_id plan_id amount created_by", texts="start_date end_date status created_at updated_at"),
        period="t.end_date BETWEEN ?P1 AND ?P2",
        # Only memberships that have ended and are no longer referenced by a kept payment.
        archive="t.end_date < ?TODAY AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.membership_id = t.id)",
        required={"member_id": "members", "plan_id": "membership_plans"},
        optional={"created_by": "users"},
    ),
    Table(
        name="refunds", dataset="payments", file="refunds.csv",
        columns=("id", "payment_id", "amount", "refund_method", "refund_reference", "refund_reason", "refund_date",
                 "created_by", "created_at"),
        types=_types("id payment_id amount created_by",
                     texts="refund_method refund_reference refund_reason refund_date created_at"),
        period="t.payment_id IN (SELECT x.id FROM payments x WHERE x.payment_date BETWEEN ?P1 AND ?P2)",
        archive="1 = 1",
        required={"payment_id": "payments"},
        optional={"created_by": "users"},
        restore_filter=(
            "EXISTS (SELECT 1 FROM payments x WHERE x.id = json_extract(j.value, '$.payment_id') "
            "AND x.status IN ('PAID', 'REFUNDED') AND x.amount >= json_extract(j.value, '$.amount'))"
        ),
    ),
    Table(
        name="payments", dataset="payments", file="payments.csv",
        columns=("id", "payment_number", "member_id", "membership_id", "plan_id", "amount", "payment_method",
                 "transaction_reference", "status", "payment_date", "verified_by", "verified_at", "notes", "created_by",
                 "created_at", "updated_at"),
        types=_types("id member_id membership_id plan_id amount verified_by created_by",
                     texts="payment_number payment_method transaction_reference status payment_date verified_at notes "
                           "created_at updated_at"),
        period="t.payment_date BETWEEN ?P1 AND ?P2",
        # Never archive a payment that is still waiting for verification.
        archive="t.status != 'PENDING' AND NOT EXISTS (SELECT 1 FROM refunds x WHERE x.payment_id = t.id)",
        required={"member_id": "members", "plan_id": "membership_plans"},
        optional={"verified_by": "users", "created_by": "users"},
        restore_filter=(
            "(json_extract(j.value, '$.membership_id') IS NULL OR EXISTS (SELECT 1 FROM memberships x "
            "WHERE x.id = json_extract(j.value, '$.membership_id') AND x.member_id = json_extract(j.value, '$.member_id')))"
        ),
    ),
    Table(
        name="attendance", dataset="attendance", file="attendance.csv",
        columns=("id", "member_id", "attendance_date", "check_in", "check_out", "method", "created_at"),
        types=_types("id member_id", texts="attendance_date check_in check_out method created_at"),
        period="t.attendance_date BETWEEN ?P1 AND ?P2",
        archive="1 = 1",
        required={"member_id": "members"},
    ),
    Table(
        name="expenses", dataset="expenses", file="expenses.csv",
        columns=("id", "category", "amount", "description", "expense_date", "created_by", "created_at", "updated_at"),
        types=_types("id amount created_by", texts="category description expense_date created_at updated_at"),
        period="t.expense_date BETWEEN ?P1 AND ?P2",
        archive="1 = 1",
        optional={"created_by": "users"},
    ),
    Table(
        name="workout_exercises", dataset="workouts", file="workout_history.csv",
        columns=("id", "workout_plan_id", "position", "exercise_name", "sets", "reps", "weight", "rest_seconds", "notes"),
        types=_types("id workout_plan_id position sets rest_seconds", "weight", "exercise_name reps notes"),
        period="t.workout_plan_id IN (SELECT x.id FROM workout_plans x WHERE "
               + TIMESTAMP_PERIOD.format(col="updated_at").replace("t.", "x.") + ")",
        archive="t.workout_plan_id IN (SELECT x.id FROM workout_plans x WHERE x.status = 'ARCHIVED')",
        required={"workout_plan_id": "workout_plans"},
    ),
    Table(
        name="workout_plans", dataset="workouts", file="workout_history.csv",
        columns=("id", "member_id", "trainer_id", "title", "day_label", "notes", "status", "created_by", "created_at", "updated_at"),
        types=_types("id member_id trainer_id created_by", texts="title day_label notes status created_at updated_at"),
        period=TIMESTAMP_PERIOD.format(col="updated_at"),
        # Active plans are in use and never archived; exercises go first (see order below).
        archive="t.status = 'ARCHIVED' AND NOT EXISTS (SELECT 1 FROM workout_exercises x WHERE x.workout_plan_id = t.id)",
        required={"member_id": "members"},
        optional={"trainer_id": "trainers", "created_by": "users"},
    ),
    Table(
        name="body_measurements", dataset="progress", file="progress.csv",
        columns=("id", "member_id", "weight", "height", "body_fat", "chest", "waist", "arm", "thigh", "recorded_at", "created_by"),
        types=_types("id member_id created_by", "weight height body_fat chest waist arm thigh", "recorded_at"),
        period=TIMESTAMP_PERIOD.format(col="recorded_at"),
        archive="1 = 1",
        required={"member_id": "members"},
        optional={"created_by": "users"},
    ),
    Table(
        name="notifications", dataset="notifications", file="notifications.csv",
        columns=("id", "user_id", "type", "message", "status", "created_at", "read_at"),
        types=_types("id user_id", texts="type message status created_at read_at"),
        period=TIMESTAMP_PERIOD.format(col="created_at"),
        archive="1 = 1",
        required={"user_id": "users"},
    ),
)

BY_NAME = {t.name: t for t in TABLES}

# Archive order: children before parents so foreign keys and guards are always satisfied.
ARCHIVE_ORDER = ("refunds", "payments", "memberships", "attendance", "workout_exercises", "workout_plans",
                 "body_measurements", "notifications", "expenses")
# Restore order: parents before children.
RESTORE_ORDER = ("members", "memberships", "payments", "refunds", "attendance", "expenses", "workout_plans",
                 "workout_exercises", "body_measurements", "notifications")


def tables_for(datasets: list[str]) -> list[Table]:
    """Tables exported for a selection (members always included), in restore order."""
    chosen = {"members", *datasets}
    return [BY_NAME[name] for name in RESTORE_ORDER if BY_NAME[name].dataset in chosen]


_TOKEN = re.compile(r"\?(P1|P2|TODAY)(?![A-Za-z0-9_])")


def render(sql: str, values: dict[str, Any], params: list[Any]) -> str:
    """Replace ?P1 / ?P2 / ?TODAY with numbered placeholders, appending each value to ``params``
    once. D1 requires the number of bound values to match the statement exactly."""
    mapping: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        token = match.group(1)
        if token not in mapping:
            params.append(values[token])
            mapping[token] = f"?{len(params)}"
        return mapping[token]

    return _TOKEN.sub(replace, sql)
