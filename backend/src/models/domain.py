"""Roles, statuses and other fixed values (mirrors the CHECK constraints in the migrations)."""

from __future__ import annotations

from typing import Literal

# -- roles -------------------------------------------------------------------------------------
ROLE_BY_ID = {1: "ADMIN", 2: "STAFF", 3: "TRAINER", 4: "MEMBER"}
ROLE_IDS = {name: rid for rid, name in ROLE_BY_ID.items()}
STAFF_ROLES = ("ADMIN", "STAFF")

Role = Literal["ADMIN", "STAFF", "TRAINER", "MEMBER"]
TeamRole = Literal["ADMIN", "STAFF"]

# -- members & memberships ---------------------------------------------------------------------
MemberStatus = Literal["ACTIVE", "INACTIVE", "SUSPENDED", "EXPIRED"]
MEMBER_STATUSES = ("ACTIVE", "INACTIVE", "SUSPENDED", "EXPIRED")
MembershipStatus = Literal["ACTIVE", "EXPIRING", "EXPIRED", "CANCELLED"]
EXPIRING_WINDOW_DAYS = 7
Gender = Literal["MALE", "FEMALE", "OTHER"]

# -- payments ----------------------------------------------------------------------------------
PaymentMethod = Literal["CASH", "UPI", "BANK_TRANSFER", "CARD_MANUAL"]
PAYMENT_METHODS = ("CASH", "UPI", "BANK_TRANSFER", "CARD_MANUAL")
REFERENCE_REQUIRED = ("UPI", "BANK_TRANSFER")
PaymentStatus = Literal["PENDING", "PAID", "REJECTED", "FAILED", "REFUNDED"]
PAYMENT_STATUSES = ("PENDING", "PAID", "REJECTED", "FAILED", "REFUNDED")
METHOD_LABELS = {"CASH": "Cash", "UPI": "UPI", "BANK_TRANSFER": "Bank transfer", "CARD_MANUAL": "Card"}

# -- attendance --------------------------------------------------------------------------------
AttendanceMethod = Literal["QR", "MANUAL"]

# -- expenses ----------------------------------------------------------------------------------
ExpenseCategory = Literal["RENT", "ELECTRICITY", "SALARY", "EQUIPMENT", "MAINTENANCE", "MARKETING", "OTHER"]
EXPENSE_CATEGORIES = ("RENT", "ELECTRICITY", "SALARY", "EQUIPMENT", "MAINTENANCE", "MARKETING", "OTHER")

# -- progress ----------------------------------------------------------------------------------
METRICS = ("weight", "height", "body_fat", "chest", "waist", "arm", "thigh")

# -- notifications (in-app only) ---------------------------------------------------------------
NotificationType = Literal[
    "MEMBERSHIP_ACTIVATED", "MEMBERSHIP_RENEWED", "PAYMENT_RECEIVED", "PAYMENT_REJECTED", "PAYMENT_REFUNDED",
    "EXPIRY_7D", "EXPIRY_3D", "EXPIRY_1D", "MEMBERSHIP_EXPIRED", "TRAINER_ASSIGNED", "WELCOME",
    "ANNOUNCEMENT", "STORAGE_ALERT",
]
REMINDER_TYPES = {7: "EXPIRY_7D", 3: "EXPIRY_3D", 1: "EXPIRY_1D"}
