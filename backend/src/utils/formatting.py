"""Small formatting / normalisation helpers shared across services."""

from __future__ import annotations

import re
from datetime import date

_NON_DIGITS = re.compile(r"\D+")
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,120}\.[A-Za-z]{2,24}$")
_CODE_INPUT = re.compile(r"^([A-Za-z]{1,6})?\s*-?\s*0*(\d{1,7})$")

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def digits_only(value: str) -> str:
    return _NON_DIGITS.sub("", value or "")


def normalize_phone(value: str, country_code: str = "91") -> str:
    """Store phones as local digits: '+91 98765-43210' -> '9876543210'."""
    digits = digits_only(value)
    if country_code and len(digits) == len(country_code) + 10 and digits.startswith(country_code):
        digits = digits[len(country_code):]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def is_valid_email(value: str) -> bool:
    return bool(_EMAIL.match(value or ""))


def clean_text(value: str | None, max_length: int | None = None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    if max_length is not None:
        text = text[:max_length]
    return text or None


def format_member_code(prefix: str, number: int) -> str:
    return f"{prefix}{number:06d}"


def member_code_candidates(query: str, prefix: str) -> list[str]:
    """'gym12', 'GYM000012', '12' -> ['GYM000012'] (member-code lookups are exact matches)."""
    match = _CODE_INPUT.match(query.strip())
    if not match:
        return []
    letters, number = match.group(1), int(match.group(2))
    if letters and letters.upper() != prefix.upper():
        return [f"{letters.upper()}{number:06d}"]
    return [format_member_code(prefix.upper(), number)]


def format_inr(paise: int, *, symbol: str = "₹") -> str:
    """Indian digit grouping: 250000000 paise -> '₹25,00,000'."""
    negative = paise < 0
    rupees, fraction = divmod(abs(int(paise)), 100)
    text = str(rupees)
    if len(text) > 3:
        head, tail = text[:-3], text[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        text = ",".join(groups + [tail])
    if fraction:
        text += f".{fraction:02d}"
    return f"{'-' if negative else ''}{symbol}{text}"


def format_date(value: str | date | None) -> str:
    """'2026-12-22' -> '22 Dec 2026'."""
    if not value:
        return ""
    d = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    return f"{d.day:02d} {MONTHS[d.month - 1]} {d.year}"


def sql_format_date(expression: str) -> str:
    """SQLite expression rendering a 'YYYY-MM-DD' column as '22 Dec 2026' (used to build
    reminder messages inside a single INSERT ... SELECT)."""
    return (
        f"(substr({expression}, 9, 2) || ' ' || "
        f"substr('JanFebMarAprMayJunJulAugSepOctNovDec', (CAST(substr({expression}, 6, 2) AS INTEGER) - 1) * 3 + 1, 3) "
        f"|| ' ' || substr({expression}, 1, 4))"
    )


def sql_first_name(expression: str) -> str:
    """SQLite expression for the first word of a name."""
    return f"substr({expression}, 1, instr({expression} || ' ', ' ') - 1)"


def first_name(name: str) -> str:
    return (name or "").split(" ")[0] or name


def receipt_number(payment_number: str) -> str:
    """Receipt numbers mirror the payment number: PAY-2026-000123 -> RCT-2026-000123."""
    return "RCT" + payment_number[3:] if payment_number.startswith("PAY") else payment_number


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
