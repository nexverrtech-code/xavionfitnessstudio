"""Reusable Pydantic field types with friendly validation messages."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict

from utils.formatting import clean_text, is_valid_email, normalize_phone


class Model(BaseModel):
    """Request bodies reject unknown fields (no mass assignment) and trim strings."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _collapse(value: Any) -> Any:
    return clean_text(value) if isinstance(value, str) else value


def _length(min_length: int, max_length: int, label: str):
    def check(value: str) -> str:
        if len(value) < min_length:
            raise ValueError(f"{label} must be at least {min_length} characters")
        if len(value) > max_length:
            raise ValueError(f"{label} must be at most {max_length} characters")
        return value

    return check


def _optional_length(max_length: int, label: str):
    def check(value: str | None) -> str | None:
        if value is not None and len(value) > max_length:
            raise ValueError(f"{label} must be at most {max_length} characters")
        return value

    return check


def _phone(value: str) -> str:
    digits = normalize_phone(value)
    if not 7 <= len(digits) <= 15:
        raise ValueError("Enter a valid phone number")
    if len(digits) == 10 and digits[0] not in "6789":
        raise ValueError("Enter a valid 10-digit mobile number")
    return digits


def _email(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    value = value.strip().lower()
    if not is_valid_email(value):
        raise ValueError("Enter a valid email address")
    return value


def _empty_to_none(value: Any) -> Any:
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _past_date(value: date | None) -> date | None:
    # One day of slack for the gym's timezone (IST is ahead of the Worker's UTC clock);
    # services re-check against the gym-local date.
    if value is not None and value > date.today() + timedelta(days=1):
        raise ValueError("Date cannot be in the future")
    return value


Name = Annotated[str, BeforeValidator(_collapse), AfterValidator(_length(2, 80, "Name"))]
Phone = Annotated[str, AfterValidator(_phone)]
OptionalEmail = Annotated[str | None, BeforeValidator(_empty_to_none), AfterValidator(_email)]
OptionalPhone = Annotated[str | None, BeforeValidator(_empty_to_none), AfterValidator(lambda v: None if v is None else _phone(v))]
PastDate = Annotated[date | None, BeforeValidator(_empty_to_none), AfterValidator(_past_date)]


def optional_text(max_length: int, label: str = "Text"):
    return Annotated[
        str | None,
        BeforeValidator(lambda v: _empty_to_none(_collapse(v))),
        AfterValidator(_optional_length(max_length, label)),
    ]


def required_text(min_length: int, max_length: int, label: str):
    return Annotated[str, BeforeValidator(_collapse), AfterValidator(_length(min_length, max_length, label))]
