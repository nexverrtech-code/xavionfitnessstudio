"""PaymentService — every way money comes in, with no payment gateway (Version 1).

    Desk payment (cash / UPI / bank transfer / card on the gym's own terminal)
        -> recorded by staff, who confirm the money was received -> PAID -> membership activated
    Direct UPI (member app)
        -> member pays the gym's UPI ID -> submits the UTR -> PENDING
        -> staff verify the UTR against the bank statement -> PAID -> membership activated
           (or REJECTED / FAILED -> no membership)
    Refunds are only RECORDED here; the money is returned outside SmartGym.

A membership row is created only once a payment is PAID, with dates computed by the backend,
in the same D1 batch (one transaction) as the payment change. Entering a UTR never activates
anything by itself.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from core.clock import fmt_ts, iso_z
from core.database import IntegrityError
from core.errors import Conflict, NotFound, ValidationFailed
from repositories.members import MemberRepository
from repositories.memberships import MembershipRepository
from repositories.payments import PaymentRepository
from repositories.plans import PlanRepository
from utils.formatting import format_date, format_inr, member_code_candidates, receipt_number
from utils.upi import build_upi_uri, normalize_reference, normalize_utr

from .context import Ctx
from .membership_rules import coverage_state, membership_out
from .notification_service import NotificationService

DUPLICATE_REFERENCE = "This transaction reference has already been submitted."


def payment_out(row: dict[str, Any]) -> dict[str, Any]:
    confirmed = row["status"] in ("PAID", "REFUNDED")
    return {
        "id": row["id"],
        "payment_number": row["payment_number"],
        "receipt_number": receipt_number(row["payment_number"]) if confirmed else None,
        "member_id": row["member_id"],
        "member_name": row.get("member_name"),
        "member_code": row.get("member_code"),
        "plan_id": row["plan_id"],
        "plan_name": row.get("plan_name"),
        "membership_id": row.get("membership_id"),
        "membership": {"start_date": row["start_date"], "end_date": row["end_date"]} if row.get("start_date") else None,
        "amount": row["amount"],
        "payment_method": row["payment_method"],
        "transaction_reference": row.get("transaction_reference"),
        "status": row["status"],
        "payment_date": row["payment_date"],
        "verified_by_name": row.get("verified_by_name"),
        "verified_at": iso_z(row.get("verified_at")),
        "notes": row.get("notes"),
        "created_at": iso_z(row.get("created_at")),
        "refund": (
            {
                "amount": row["refund_amount"],
                "method": row["refund_method"],
                "reference": row["refund_reference"],
                "reason": row["refund_reason"],
                "date": row["refund_date"],
            }
            if row.get("refund_amount")
            else None
        ),
    }


class PaymentService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.payments = PaymentRepository(ctx.db)
        self.memberships = MembershipRepository(ctx.db)
        self.members = MemberRepository(ctx.db)
        self.plans = PlanRepository(ctx.db)
        self.notifications = NotificationService(ctx)

    # -- shared checks -------------------------------------------------------------------------
    async def _member_and_plan(self, member_id: int, plan_id: int) -> tuple[dict[str, Any], dict[str, Any]]:
        member, plan = await self.members.basic(member_id), await self.plans.get(plan_id)
        if not member:
            raise NotFound("Member not found.")
        if not plan or plan["status"] != "ACTIVE":
            raise ValidationFailed("This plan is not available.", fields={"plan_id": "Choose an active plan"})
        return member, plan

    @staticmethod
    def _reference(method: str, value: str | None) -> str | None:
        if method == "UPI":
            utr = normalize_utr(value or "")
            if not utr:
                raise ValidationFailed("Enter the 12-digit UTR / UPI reference number.",
                                       fields={"transaction_reference": "The UTR has 12 digits"})
            return utr
        if method == "BANK_TRANSFER":
            reference = normalize_reference(value)
            if not reference:
                raise ValidationFailed("Enter the bank transfer reference.",
                                       fields={"transaction_reference": "Use 4–64 letters, digits, - or /"})
            return reference
        if value:
            reference = normalize_reference(value)
            if not reference:
                raise ValidationFailed("Enter a valid reference.", fields={"transaction_reference": "Use 4–64 letters, digits, - or /"})
            return reference
        return None

    def _check_date(self, value: date | None, *, field: str, back_days: int, ahead_days: int = 0) -> date:
        today = self.ctx.clock.today()
        chosen = value or today
        if not today - timedelta(days=back_days) <= chosen <= today + timedelta(days=ahead_days):
            window = f"within the last {back_days} days" + (f" or the next {ahead_days} days" if ahead_days else "")
            raise ValidationFailed(f"Choose a date {window}.", fields={field: f"Must be {window}"})
        return chosen

    async def _membership_events(self, member: dict[str, Any], payment: dict[str, Any], membership: dict[str, Any] | None, renewal: bool) -> list:
        events: list[tuple[str, dict[str, Any]]] = [
            ("PAYMENT_RECEIVED", {"amount": format_inr(payment["amount"]), "method": payment["payment_method"],
                                  "number": payment["payment_number"]}),
        ]
        if membership:
            events.append(
                ("MEMBERSHIP_RENEWED" if renewal else "MEMBERSHIP_ACTIVATED",
                 {"plan": membership["plan_name"], "start": format_date(membership["start_date"]), "end": format_date(membership["end_date"])})
            )
        return await self.notifications.statements(member, events)

    # -- UPI details (desk QR and member app) ----------------------------------------------------
    async def upi_details(self, *, member_code: str, plan: dict[str, Any]) -> dict[str, Any]:
        settings = await self.ctx.settings()
        if not (settings["upi_enabled"] and settings["upi_id"]):
            raise Conflict("UPI payments are not set up yet. Please pay at the front desk.")
        payee = settings["upi_name"] or settings["gym_name"]
        note = f"{member_code} {plan['name']}"
        return {
            "vpa": settings["upi_id"],
            "payee_name": payee,
            "amount": plan["price"],
            "note": note,
            "uri": build_upi_uri(settings["upi_id"], payee, plan["price"], note),
        }

    # -- desk payment: PAID + membership in one transaction ----------------------------------------
    async def _replay(self, key: str) -> dict[str, Any] | None:
        row = await self.payments.by_idempotency_key(key)
        if not row:
            return None
        today = self.ctx.clock.today()
        membership = await self.memberships.get(row["membership_id"]) if row.get("membership_id") else None
        return {
            "payment": payment_out(row),
            "membership": membership_out(membership, today) if membership else None,
            "member": {"id": row["member_id"], **coverage_state(await self.memberships.coverage_end(row["member_id"]), today)},
            "replayed": True,
        }

    async def record(self, values: dict[str, Any], idempotency_key: str | None) -> dict[str, Any]:
        if idempotency_key and (replayed := await self._replay(idempotency_key)):
            return replayed
        member, plan = await self._member_and_plan(values["member_id"], values["plan_id"])
        if member["status"] == "SUSPENDED":
            raise Conflict("This member is suspended. Reactivate the member before recording a payment.")
        method = values["payment_method"]
        reference = self._reference(method, values.get("transaction_reference"))
        amount = values.get("amount") or plan["price"]
        payment_date = self._check_date(values.get("payment_date"), field="payment_date", back_days=60)
        start = values.get("start_date")
        if start:
            self._check_date(start, field="start_date", back_days=60, ahead_days=90)
        today = self.ctx.clock.today()
        now = self.ctx.now
        if reference and method in ("UPI", "BANK_TRANSFER") and await self.payments.reference_in_use(reference):
            raise Conflict(DUPLICATE_REFERENCE, fields={"transaction_reference": "Already submitted"})
        if await self.memberships.recent_duplicate(member["id"], plan["id"], fmt_ts(self.ctx.clock.utcnow() - timedelta(minutes=2))):
            raise Conflict(f"A {plan['name']} payment was recorded for this member moments ago. Refresh to see it.")

        renewal = member["expiry_date"] is not None
        statements = [
            self.memberships.insert_stmt(
                member_id=member["id"], plan_id=plan["id"], amount=amount, start_override=start.isoformat() if start else None,
                today=today.isoformat(), created_by=self.ctx.actor_id, now=now,
            ),
            self.payments.insert_stmt(
                year=payment_date.strftime("%Y"), member_id=member["id"], plan_id=plan["id"], amount=amount, method=method,
                reference=reference, status="PAID", payment_date=payment_date.isoformat(), notes=values.get("notes"),
                idempotency_key=idempotency_key, created_by=self.ctx.actor_id, now=now, link_latest_membership=True,
                verified_by=self.ctx.actor_id,
            ),
            self.members.activate_stmt(member["id"], today.isoformat(), now),
        ]
        try:
            results = await self.ctx.db.batch(statements)
        except IntegrityError as exc:
            if idempotency_key and exc.mentions("idempotency_key") and (replayed := await self._replay(idempotency_key)):
                return replayed
            if exc.mentions("transaction_reference"):
                raise Conflict(DUPLICATE_REFERENCE, fields={"transaction_reference": "Already submitted"}) from None
            raise
        payment = await self.payments.get(results[1].first["id"])
        membership = {**results[0].first, "plan_name": plan["name"]}
        notes = await self._membership_events(member, payment, membership, renewal)
        if notes:
            await self.ctx.db.batch(notes)
        return {
            "payment": payment_out(payment),
            "membership": membership_out(membership, today),
            "member": {"id": member["id"], **coverage_state(max(filter(None, [member["expiry_date"], membership["end_date"]])), today)},
            "replayed": False,
        }

    # -- Direct UPI from the member app -------------------------------------------------------------
    async def submit_upi(self, member_id: int, plan_id: int, utr_text: str) -> dict[str, Any]:
        settings = await self.ctx.settings()
        if not (settings["upi_enabled"] and settings["upi_id"]):
            raise Conflict("UPI payments are not set up yet. Please pay at the front desk.")
        utr = normalize_utr(utr_text)
        if not utr:
            raise ValidationFailed("Enter the 12-digit UTR from your UPI app.", fields={"utr": "The UTR / UPI reference number has 12 digits"})
        member, plan = await self._member_and_plan(member_id, plan_id)
        if member["status"] == "SUSPENDED":
            raise Conflict("Your membership is on hold. Please contact the front desk.")
        if await self.payments.reference_in_use(utr):
            raise Conflict(DUPLICATE_REFERENCE, fields={"utr": "Already submitted"})
        today = self.ctx.clock.today()
        try:
            row = (
                await self.ctx.db.run(*self.payments.insert_stmt(
                    year=today.strftime("%Y"), member_id=member_id, plan_id=plan_id, amount=plan["price"], method="UPI",
                    reference=utr, status="PENDING", payment_date=today.isoformat(), notes=None, idempotency_key=None,
                    created_by=self.ctx.actor_id, now=self.ctx.now, link_latest_membership=False, verified_by=None,
                ))
            ).first
        except IntegrityError as exc:
            if exc.mentions("payments.member_id"):
                raise Conflict("You already have a payment awaiting verification. The gym will update you soon.") from None
            if exc.mentions("transaction_reference"):
                raise Conflict(DUPLICATE_REFERENCE, fields={"utr": "Already submitted"}) from None
            raise
        return {"payment": payment_out(await self.payments.get(row["id"]))}

    async def withdraw(self, member_id: int) -> None:
        """A member cancels their own pending submission (e.g. they entered the wrong plan)."""
        pending = await self.payments.pending_for_member(member_id)
        if not pending:
            raise NotFound("There is no payment awaiting verification.")
        await self.payments.close_pending(pending["id"], status="FAILED", reason="Withdrawn by the member", actor=self.ctx.actor_id, now=self.ctx.now)

    # -- verification ---------------------------------------------------------------------------------
    async def approve(self, payment_id: int) -> dict[str, Any]:
        """PENDING -> PAID and membership activated, atomically and idempotently: a second click or
        a concurrent approval changes nothing and never extends a membership twice."""
        payment = await self.payments.get(payment_id)
        if not payment:
            raise NotFound("Payment not found.")
        today = self.ctx.clock.today()
        if payment["status"] in ("PAID", "REFUNDED"):
            membership = await self.memberships.get(payment["membership_id"]) if payment["membership_id"] else None
            return {"payment": payment_out(payment), "membership": membership_out(membership, today) if membership else None,
                    "already_processed": True}
        if payment["status"] != "PENDING":
            raise Conflict(f"This payment is already {payment['status'].lower()}.")
        member = await self.members.basic(payment["member_id"])
        renewal = member["expiry_date"] is not None
        now = self.ctx.now
        results = await self.ctx.db.batch(
            [
                self.memberships.insert_stmt(
                    member_id=payment["member_id"], plan_id=payment["plan_id"], amount=payment["amount"], start_override=None,
                    today=today.isoformat(), created_by=self.ctx.actor_id, now=now, only_if_pending_payment=payment_id,
                ),
                self.payments.approve_stmt(payment_id, payment["member_id"], self.ctx.actor_id, now),
                self.members.activate_stmt(payment["member_id"], today.isoformat(), now),
                self.payments.get_stmt(payment_id),
            ]
        )
        transitioned = results[1].changes == 1
        updated = results[3].first
        membership = await self.memberships.get(updated["membership_id"]) if updated["membership_id"] else None
        if transitioned:
            notes = await self._membership_events(member, updated, membership, renewal)
            if notes:
                await self.ctx.db.batch(notes)
        return {"payment": payment_out(updated), "membership": membership_out(membership, today) if membership else None,
                "already_processed": not transitioned}

    async def reject(self, payment_id: int, reason: str, status: str = "REJECTED") -> dict[str, Any]:
        payment = await self.payments.get(payment_id)
        if not payment:
            raise NotFound("Payment not found.")
        if payment["status"] in ("REJECTED", "FAILED"):
            return {"payment": payment_out(payment), "already_processed": True}
        if payment["status"] != "PENDING":
            raise Conflict(f"This payment is already {payment['status'].lower()}.")
        changed = await self.payments.close_pending(payment_id, status=status, reason=reason, actor=self.ctx.actor_id, now=self.ctx.now)
        if changed:
            member = await self.members.basic(payment["member_id"])
            await self.notifications.notify(member, "PAYMENT_REJECTED", utr=payment["transaction_reference"] or "-",
                                            reason=reason.rstrip(".") + ".")
        return {"payment": payment_out(await self.payments.get(payment_id)), "already_processed": not changed}

    # -- refunds (recorded only) ------------------------------------------------------------------------
    async def refund(self, payment_id: int, values: dict[str, Any]) -> dict[str, Any]:
        payment = await self.payments.get(payment_id)
        if not payment:
            raise NotFound("Payment not found.")
        if payment["status"] == "REFUNDED":
            raise Conflict("A refund is already recorded for this payment.")
        if payment["status"] != "PAID":
            raise Conflict("Only confirmed (PAID) payments can be refunded.")
        amount = values.get("amount") or payment["amount"]
        if amount > payment["amount"]:
            raise ValidationFailed("The refund can't be more than the payment.", fields={"amount": f"At most {format_inr(payment['amount'])}"})
        refund_date = self._check_date(values.get("refund_date"), field="refund_date", back_days=365)
        if refund_date.isoformat() < payment["payment_date"]:
            raise ValidationFailed("The refund date can't be before the payment date.", fields={"refund_date": "Before the payment date"})
        method = values["refund_method"]
        reference = normalize_reference(values.get("refund_reference")) if values.get("refund_reference") else None
        if values.get("refund_reference") and not reference:
            raise ValidationFailed("Enter a valid reference.", fields={"refund_reference": "Use 4–64 letters, digits, - or /"})
        now = self.ctx.now
        statements = [
            self.payments.refund_insert_stmt(
                payment_id=payment_id, amount=amount, method=method, reference=reference, reason=values["refund_reason"],
                refund_date=refund_date.isoformat(), created_by=self.ctx.actor_id, now=now,
            ),
            self.payments.mark_refunded_stmt(payment_id, now),
        ]
        if values.get("cancel_membership") and payment["membership_id"]:
            statements += [
                self.memberships.cancel_stmt(payment["membership_id"], now),
                self.members.recompute_after_cancel_stmt(payment["member_id"], self.ctx.clock.today().isoformat(), now),
            ]
        try:
            await self.ctx.db.batch(statements)
        except IntegrityError as exc:
            if exc.mentions("refunds.payment_id"):
                raise Conflict("A refund is already recorded for this payment.") from None
            raise
        member = await self.members.basic(payment["member_id"])
        await self.notifications.notify(member, "PAYMENT_REFUNDED", amount=format_inr(amount), method=method,
                                        number=payment["payment_number"])
        return {"payment": payment_out(await self.payments.get(payment_id))}

    # -- reads -----------------------------------------------------------------------------------------------
    async def get(self, payment_id: int, *, member_scope: int | None = None) -> dict[str, Any]:
        row = await self.payments.get(payment_id)
        if not row or (member_scope is not None and row["member_id"] != member_scope):
            raise NotFound("Payment not found.")
        return payment_out(row)

    async def list(self, page, *, start: str | None, end: str | None, status: str | None, method: str | None,
                   member_id: int | None, q: str | None) -> dict[str, Any]:
        member_code = None
        if q:
            settings = await self.ctx.settings()
            codes = member_code_candidates(q, settings["member_code_prefix"]) if any(c.isalpha() for c in q) else []
            member_code = codes[0] if codes else None
        rows, total, paid_total = await self.payments.list(
            start=start, end=end, status=status, method=method, member_id=member_id, q=q, member_code=member_code,
            limit=page.limit, offset=page.offset,
        )
        result = page.wrap([payment_out(r) for r in rows], total)
        result["paid_total"] = paid_total
        return result

    async def pending(self, page) -> dict[str, Any]:
        rows, total, amount = await self.payments.pending(page.limit, page.offset)
        result = page.wrap([payment_out(r) for r in rows], total)
        result["pending_amount"] = amount
        return result

    async def summary(self) -> dict[str, Any]:
        today = self.ctx.clock.today()
        week_start = today - timedelta(days=today.weekday())
        return await self.payments.summary(today.isoformat(), week_start.isoformat(), today.replace(day=1).isoformat())

    async def receipt(self, payment_id: int, *, member_scope: int | None = None) -> dict[str, Any]:
        """Receipt data; the PDF is drawn on demand in the browser and never stored."""
        row = await self.payments.get(payment_id)
        if not row or (member_scope is not None and row["member_id"] != member_scope):
            raise NotFound("Receipt not found.")
        if row["status"] not in ("PAID", "REFUNDED"):
            raise Conflict("A receipt is available once the payment is confirmed.")
        settings = await self.ctx.settings()
        return {
            "gym": {"name": settings["gym_name"], "address": settings["gym_address"], "phone": settings["gym_phone"],
                    "email": settings["gym_email"]},
            "receipt_number": receipt_number(row["payment_number"]),
            "payment_number": row["payment_number"],
            "member_code": row["member_code"],
            "member_name": row["member_name"],
            "plan_name": row["plan_name"],
            "amount": row["amount"],
            "payment_method": row["payment_method"],
            "transaction_reference": row["transaction_reference"],
            "payment_date": row["payment_date"],
            "membership_start": row["start_date"],
            "membership_end": row["end_date"],
            "status": row["status"],
            "verified_at": iso_z(row["verified_at"]),
            "refund": payment_out(row)["refund"],
        }
