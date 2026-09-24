"""Request bodies for every write endpoint. Pydantic validates, trims and bounds all input, and
unknown fields are rejected (no mass assignment)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BeforeValidator, Field, field_validator, model_validator

from models.domain import ExpenseCategory, Gender, PaymentMethod, TeamRole

from .common import Model, Name, OptionalEmail, OptionalPhone, PastDate, Phone, _empty_to_none, optional_text, required_text

Amount = Annotated[int, Field(ge=100, le=100_000_000)]  # paise: ₹1 .. ₹10 lakh per entry
OptionalAmount = Annotated[int | None, BeforeValidator(_empty_to_none), Field(ge=100, le=100_000_000)]
OptionalId = Annotated[int | None, BeforeValidator(_empty_to_none)]
OptionalDate = Annotated[date | None, BeforeValidator(_empty_to_none)]


# -- auth & users ------------------------------------------------------------------------------
class LoginIn(Model):
    identifier: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class ChangePasswordIn(Model):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class SetupIn(Model):
    setup_token: str = Field(min_length=8, max_length=200)
    name: Name
    email: Annotated[str, Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")]
    password: str = Field(min_length=8, max_length=128)


class TeamUserIn(Model):
    name: Name
    email: OptionalEmail = None
    phone: OptionalPhone = None
    role: TeamRole = "STAFF"


class TeamUserUpdate(Model):
    name: Name
    email: OptionalEmail = None
    phone: OptionalPhone = None


class UserStatusIn(Model):
    status: Literal["ACTIVE", "DISABLED"]


# -- members ---------------------------------------------------------------------------------
class MemberBase(Model):
    name: Name
    phone: Phone
    email: OptionalEmail = None
    gender: Annotated[Gender | None, BeforeValidator(_empty_to_none)] = None
    date_of_birth: PastDate = None
    address: optional_text(250, "Address") = None
    emergency_contact: optional_text(80, "Emergency contact") = None
    trainer_id: OptionalId = None

    @field_validator("date_of_birth")
    @classmethod
    def _reasonable_age(cls, value: date | None) -> date | None:
        if value is not None and not 1900 <= value.year <= date.today().year - 3:
            raise ValueError("Enter a valid date of birth")
        return value


class MemberCreate(MemberBase):
    joining_date: PastDate = None
    create_app_login: bool = True


class MemberUpdate(MemberBase):
    joining_date: date


class MemberStatusIn(Model):
    action: Literal["SUSPEND", "REACTIVATE", "DEACTIVATE"]


class AssignTrainerIn(Model):
    trainer_id: OptionalId = None


class ProfileUpdate(Model):
    """Contact details a member may change themselves."""

    email: OptionalEmail = None
    address: optional_text(250, "Address") = None
    emergency_contact: optional_text(80, "Emergency contact") = None


# -- trainers --------------------------------------------------------------------------------
class TrainerIn(Model):
    name: Name
    phone: Phone
    email: OptionalEmail = None
    specialization: optional_text(80, "Specialization") = None
    joining_date: PastDate = None


class TrainerStatusIn(Model):
    status: Literal["ACTIVE", "INACTIVE"]


class TrainerMembersIn(Model):
    member_ids: list[int] = Field(min_length=1, max_length=200)


# -- membership plans ----------------------------------------------------------------------------
class PlanIn(Model):
    name: required_text(2, 60, "Plan name")
    duration_days: int = Field(ge=1, le=1830)
    price: Amount
    description: optional_text(200, "Description") = None
    status: Literal["ACTIVE", "INACTIVE"] = "ACTIVE"


# -- payments ----------------------------------------------------------------------------------
class DeskPaymentIn(Model):
    """Staff record a payment they have received; it activates the membership immediately."""

    member_id: int
    plan_id: int
    payment_method: PaymentMethod = "CASH"
    amount: OptionalAmount = None  # defaults to the plan price
    transaction_reference: optional_text(64, "Reference") = None
    payment_date: OptionalDate = None
    start_date: OptionalDate = None
    notes: optional_text(200, "Notes") = None


class UpiSubmission(Model):
    plan_id: int
    utr: str = Field(min_length=12, max_length=20)


class RejectPaymentIn(Model):
    reason: required_text(3, 160, "Reason")
    status: Literal["REJECTED", "FAILED"] = "REJECTED"


class RefundIn(Model):
    amount: OptionalAmount = None  # defaults to the full payment
    refund_method: PaymentMethod
    refund_reference: optional_text(64, "Refund reference") = None
    refund_reason: required_text(3, 200, "Reason")
    refund_date: OptionalDate = None
    cancel_membership: bool = True


# -- attendance ------------------------------------------------------------------------------
class ScanIn(Model):
    code: str = Field(min_length=1, max_length=120)


class MarkAttendanceIn(Model):
    member_id: int


# -- workouts & progress -----------------------------------------------------------------------------
class ExerciseIn(Model):
    exercise_name: required_text(2, 80, "Exercise name")
    sets: Annotated[int | None, BeforeValidator(_empty_to_none), Field(ge=1, le=50)] = None
    reps: optional_text(16, "Reps") = None
    weight: Annotated[float | None, BeforeValidator(_empty_to_none), Field(ge=0, le=1000)] = None
    rest_seconds: Annotated[int | None, BeforeValidator(_empty_to_none), Field(ge=0, le=1800)] = None
    notes: optional_text(120, "Notes") = None


class WorkoutIn(Model):
    member_id: int
    title: required_text(2, 80, "Workout title")
    day_label: optional_text(30, "Day") = None
    notes: optional_text(250, "Notes") = None
    exercises: list[ExerciseIn] = Field(min_length=1, max_length=40)


class WorkoutUpdate(Model):
    title: required_text(2, 80, "Workout title")
    day_label: optional_text(30, "Day") = None
    notes: optional_text(250, "Notes") = None
    status: Literal["ACTIVE", "ARCHIVED"] = "ACTIVE"
    exercises: list[ExerciseIn] = Field(min_length=1, max_length=40)


class CopyWorkoutIn(Model):
    member_id: int


def _measure(low: float, high: float):
    return Annotated[float | None, BeforeValidator(_empty_to_none), Field(ge=low, le=high)]


class MeasurementIn(Model):
    date: PastDate = None
    weight: _measure(10, 400) = None
    height: _measure(50, 260) = None
    body_fat: _measure(1, 75) = None
    chest: _measure(30, 250) = None
    waist: _measure(30, 250) = None
    arm: _measure(10, 100) = None
    thigh: _measure(20, 150) = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "MeasurementIn":
        if all(getattr(self, m) is None for m in ("weight", "height", "body_fat", "chest", "waist", "arm", "thigh")):
            raise ValueError("Enter at least one measurement")
        return self


# -- expenses & notifications ---------------------------------------------------------------------
class ExpenseIn(Model):
    category: ExpenseCategory
    amount: Amount
    description: optional_text(200, "Description") = None
    expense_date: PastDate = None


class AnnouncementIn(Model):
    message: required_text(3, 280, "Message")
    member_ids: list[int] | None = Field(default=None, max_length=200)
    segment: Literal["ACTIVE", "EXPIRING", "EXPIRED", "ALL"] | None = None

    @model_validator(mode="after")
    def _audience(self) -> "AnnouncementIn":
        if not self.member_ids and not self.segment:
            raise ValueError("Choose who should receive the message")
        return self


# -- data & backup --------------------------------------------------------------------------------------
class BackupCreateIn(Model):
    datasets: list[str] = Field(min_length=1, max_length=8)
    period_from: date
    period_to: date


class BackupVerifyIn(Model):
    file_name: str = Field(min_length=5, max_length=120)
    checksum: str = Field(pattern=r"^[0-9a-f]{64}$")
    counts: dict[str, int]


class ArchiveIn(Model):
    """Both flags must be true: the admin downloaded + verified the backup and confirms removal."""

    backup_verified: Literal[True]
    confirm: Literal[True]


class RestoreCheckIn(Model):
    table: str = Field(min_length=3, max_length=40)
    ids: list[int] = Field(max_length=5000)


class RestoreApplyIn(Model):
    table: str = Field(min_length=3, max_length=40)
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=500)


class RestoreCompleteIn(Model):
    file_name: str = Field(min_length=5, max_length=120)
    backup_created_at: str | None = Field(default=None, max_length=40)
    inserted: int = Field(ge=0)
    skipped: int = Field(ge=0)
    datasets: list[str] = Field(default_factory=list, max_length=10)


class TimeTravelIn(Model):
    timestamp: datetime
    confirm_text: Literal["RESTORE"]
