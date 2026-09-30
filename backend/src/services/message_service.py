"""MessageService: automatic WhatsApp (Meta Cloud API) and email (Resend) messages to members.

    payment completed ──► queued in the same step as the payment ─┐
    daily job: 7 / 3 / 1 days before expiry, and after it ─► queued ┤─► outbox ─► sent by the
                                                                    ┘   every-minute cron job

Messages reach every member with a phone number (WhatsApp) or an email address on file, app
login or not, unless the member turned messages off. A channel works once its provider secrets
are set and an admin switches it on in Settings -> Messages. The payment receipt follows the
"Payment received" switch; reminders follow "Expiry reminders".
"""

from __future__ import annotations

import asyncio
import html
import json
import re
from datetime import timedelta
from typing import Any
from urllib.parse import quote

from core.clock import fmt_ts, iso_z
from core.database import Statement
from core.errors import ValidationFailed
from repositories.messages import MessageRepository
from utils import http
from utils.formatting import digits_only, first_name, format_date, format_inr, is_valid_email, normalize_phone

from .context import Ctx

CHANNELS = ("WHATSAPP", "EMAIL")
REMINDERS = {7: "EXPIRY_7D", 3: "EXPIRY_3D", 1: "EXPIRY_1D"}
SEND_BATCH = 20  # per run: the Free plan allows 50 outgoing requests per invocation
MAX_ATTEMPTS = 5
EMAIL_GAP_SECONDS = 0.6  # Resend accepts 2 requests a second

# Approved WhatsApp templates (category Utility, language English "en"): name + body values in order.
WHATSAPP_TEMPLATES: dict[str, tuple[str, tuple[str, ...]]] = {
    "PAYMENT_RECEIVED": ("payment_received", ("first", "amount", "gym", "plan", "end", "number")),
    "EXPIRY_7D": ("membership_reminder", ("first", "plan", "gym", "end")),
    "EXPIRY_3D": ("membership_reminder", ("first", "plan", "gym", "end")),
    "EXPIRY_1D": ("membership_reminder", ("first", "plan", "gym", "end")),
    "MEMBERSHIP_EXPIRED": ("membership_expired", ("first", "gym", "end")),
}
_REMINDER_EMAIL = (
    "Your membership ends on {end}",
    ["Hi {first},", "Your {plan} membership at {gym} ends on {end}.",
     "Renew in the member app or at the front desk to keep training without a break.", "{gym}"],
)
EMAILS: dict[str, tuple[str, list[str]]] = {
    "PAYMENT_RECEIVED": (
        "Payment received - {gym}",
        ["Hi {first},", "We have received your payment of {amount}. Your {plan} membership is active until {end}.",
         "Payment number: {number}", "Thank you,", "{gym}"],
    ),
    "EXPIRY_7D": _REMINDER_EMAIL,
    "EXPIRY_3D": _REMINDER_EMAIL,
    "EXPIRY_1D": _REMINDER_EMAIL,
    "MEMBERSHIP_EXPIRED": (
        "Your membership has expired",
        ["Hi {first},", "Your membership at {gym} expired on {end}. Please renew to continue - we'd love to see you back.", "{gym}"],
    ),
}


class DeliveryError(Exception):
    """``retry`` = temporary (rate limit, provider down, network); otherwise permanent."""

    def __init__(self, message: str, *, retry: bool = False) -> None:
        super().__init__(message)
        self.retry = retry


class _Values(dict):
    def __missing__(self, key: str) -> str:
        return ""


def whatsapp_number(phone: str, country_code: str) -> str:
    digits = digits_only(phone)
    return country_code + digits if len(digits) == 10 else digits


def _raise_for(response: http.HttpResponse, provider: str) -> None:
    if response.ok:
        return
    body = response.json()
    detail = ""
    if isinstance(body, dict):
        error = body.get("error")
        detail = str(error.get("message") or "") if isinstance(error, dict) else str(body.get("message") or "")
    message = f"{provider} {response.status}: {detail or 'request refused'}"
    raise DeliveryError(message, retry=response.status == 429 or response.status >= 500)


class MessageService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.repo = MessageRepository(ctx.db)

    # -- which channels are live -----------------------------------------------------------------------
    def configured(self) -> dict[str, bool]:
        return {"WHATSAPP": self.ctx.config.whatsapp_configured, "EMAIL": self.ctx.config.email_configured}

    async def live_channels(self) -> list[str]:
        settings = await self.ctx.settings()
        configured = self.configured()
        switches = {"WHATSAPP": settings["whatsapp_enabled"], "EMAIL": settings["email_enabled"]}
        return [c for c in CHANNELS if configured[c] and switches[c]]

    # -- queueing --------------------------------------------------------------------------------------
    async def payment_statements(self, member: dict[str, Any], payment: dict[str, Any], membership: dict[str, Any] | None) -> list[Statement]:
        """Receipt messages for a completed payment, added to the batch that records it."""
        settings = await self.ctx.settings()
        if not membership or member.get("messages_opt_out") or not settings["notify_payment"]:
            return []
        params = {
            "first": first_name(member.get("name") or ""), "gym": settings["gym_name"], "amount": format_inr(payment["amount"]),
            "plan": membership.get("plan_name") or "", "end": format_date(membership["end_date"]), "number": payment["payment_number"],
        }
        recipients = {"WHATSAPP": member.get("phone") and whatsapp_number(member["phone"], self.ctx.config.default_country_code),
                      "EMAIL": member.get("email")}
        return [
            self.repo.enqueue_stmt(channel=channel, event="PAYMENT_RECEIVED", member_id=member["id"], recipient=recipients[channel],
                                   params=params, dedupe_key=f"PAYMENT_RECEIVED:{payment['id']}:{channel}", now=self.ctx.now)
            for channel in await self.live_channels()
            if recipients[channel]
        ]

    async def queue_reminders(self) -> dict[str, int]:
        """Daily: 7 / 3 / 1 days before a membership ends, and once after it lapsed."""
        settings = await self.ctx.settings()
        channels = await self.live_channels()
        if not settings["reminders_enabled"] or not channels:
            return {"queued": 0}
        today = self.ctx.clock.today()
        common = {"gym": settings["gym_name"], "country_code": self.ctx.config.default_country_code, "now": self.ctx.now}
        plan: list[tuple[str, str, str, bool]] = [
            (kind, (today + timedelta(days=days)).isoformat(), (today + timedelta(days=days)).isoformat(), False)
            for days, kind in REMINDERS.items()
        ]
        plan.append(("MEMBERSHIP_EXPIRED", (today - timedelta(days=3)).isoformat(), (today - timedelta(days=1)).isoformat(), True))
        statements = [
            self.repo.reminder_stmt(channel=channel, event=kind, end_from=low, end_to=high, expired=expired, **common)
            for kind, low, high, expired in plan
            for channel in channels
        ]
        results = await self.ctx.db.batch(statements)
        return {"queued": sum(r.changes for r in results)}

    # -- sending ---------------------------------------------------------------------------------------
    async def send_queued(self, limit: int = SEND_BATCH) -> dict[str, int]:
        """Every minute: send a few queued messages and record each result (retry temporary errors)."""
        configured = self.configured()
        if not any(configured.values()):
            return {"sent": 0, "failed": 0, "retry": 0}
        now = self.ctx.now
        rows = await self.repo.claim(limit, now, fmt_ts(self.ctx.clock.utcnow() - timedelta(minutes=10)))
        settings = await self.ctx.settings()
        updates: list[Statement] = []
        counts = {"sent": 0, "failed": 0, "retry": 0}
        emailed = False
        for row in rows:
            try:
                if row["channel"] == "EMAIL" and emailed and EMAIL_GAP_SECONDS:
                    await asyncio.sleep(EMAIL_GAP_SECONDS)
                emailed = emailed or row["channel"] == "EMAIL"
                await self.deliver(row["channel"], row["recipient"], row["event"], json.loads(row["params"]), settings)
                updates.append(self.repo.sent_stmt(row["id"], self.ctx.now))
                counts["sent"] += 1
            except DeliveryError as exc:
                if exc.retry:
                    updates.append(self.repo.retry_stmt(row["id"], str(exc), MAX_ATTEMPTS))
                    counts["retry"] += 1
                else:
                    updates.append(self.repo.failed_stmt(row["id"], str(exc)))
                    counts["failed"] += 1
        if updates:
            await self.ctx.db.batch(updates)
        return counts

    async def deliver(self, channel: str, recipient: str, event: str, params: dict[str, Any], settings: dict[str, Any]) -> None:
        if not self.configured()[channel]:
            raise DeliveryError(f"{'WhatsApp' if channel == 'WHATSAPP' else 'Email'} is not connected.")
        try:
            if channel == "WHATSAPP":
                await self._whatsapp(recipient, event, params)
            else:
                await self._email(recipient, event, params, settings["gym_name"])
        except http.HttpError as exc:
            raise DeliveryError(str(exc), retry=True) from None

    async def _whatsapp(self, to: str, event: str, params: dict[str, Any]) -> None:
        config = self.ctx.config
        template, keys = WHATSAPP_TEMPLATES[event]
        body = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": "en"},
                "components": [{"type": "body", "parameters": [{"type": "text", "text": str(params.get(k) or "-")} for k in keys]}],
            },
        }
        url = f"https://graph.facebook.com/{quote(config.whatsapp_api_version)}/{quote(config.whatsapp_phone_number_id)}/messages"
        response = await http.request("POST", url, headers={"Authorization": f"Bearer {config.whatsapp_token}"}, json_body=body, timeout=15)
        _raise_for(response, "WhatsApp")

    async def _email(self, to: str, event: str, params: dict[str, Any], gym: str) -> None:
        config = self.ctx.config
        subject, lines = EMAILS[event]
        values = _Values({k: str(v) for k, v in params.items()})
        text_lines = [line.format_map(values) for line in lines]
        # Names and plan names come from people: escaped in the HTML part; no line breaks in headers.
        sender = re.sub(r'[\r\n"<>]', "", gym)[:60].strip() or "Gym"
        body = {
            "from": f"{sender} <{config.email_from}>",
            "to": [to],
            "subject": re.sub(r"[\r\n]", " ", subject.format_map(values))[:150],
            "text": "\n\n".join(text_lines),
            "html": "<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111\">"
                    + "".join(f"<p>{html.escape(line)}</p>" for line in text_lines) + "</div>",
        }
        response = await http.request("POST", "https://api.resend.com/emails", headers={"Authorization": f"Bearer {config.resend_api_key}"},
                                      json_body=body, timeout=15)
        _raise_for(response, "Email")

    # -- admin -------------------------------------------------------------------------------------------
    async def overview(self) -> dict[str, Any]:
        settings = await self.ctx.settings()
        configured = self.configured()
        pending, week, recent = await self.repo.overview(fmt_ts(self.ctx.clock.utcnow() - timedelta(days=7)), 30)
        stats = week.first or {}
        return {
            "whatsapp": {"configured": configured["WHATSAPP"], "enabled": settings["whatsapp_enabled"]},
            "email": {"configured": configured["EMAIL"], "enabled": settings["email_enabled"]},
            "queued": (pending.first or {}).get("c", 0),
            "sent_7d": stats.get("sent", 0),
            "failed_7d": stats.get("failed", 0),
            "recent": [
                {**r, "created_at": iso_z(r["created_at"]), "sent_at": iso_z(r["sent_at"])} for r in recent.rows
            ],
        }

    async def send_test(self, channel: str, to: str) -> dict[str, Any]:
        """Send the payment receipt with sample values straight away (checks the template too)."""
        if channel == "WHATSAPP":
            local = normalize_phone(to, self.ctx.config.default_country_code)
            if not 10 <= len(local) <= 15:
                raise ValidationFailed("Enter a mobile number.", fields={"to": "Enter a mobile number"})
            recipient = whatsapp_number(local, self.ctx.config.default_country_code)
        else:
            recipient = to.strip().lower()
            if not is_valid_email(recipient):
                raise ValidationFailed("Enter an email address.", fields={"to": "Enter a valid email address"})
        settings = await self.ctx.settings()
        today = self.ctx.clock.today()
        sample = {"first": "Test", "gym": settings["gym_name"], "amount": format_inr(150000), "plan": "Monthly",
                  "end": format_date(today + timedelta(days=30)), "number": "PAY-TEST-000001"}
        try:
            await self.deliver(channel, recipient, "PAYMENT_RECEIVED", sample, settings)
        except DeliveryError as exc:
            return {"ok": False, "message": str(exc)}
        return {"ok": True, "message": f"Sent to {recipient}."}

    # -- retention -----------------------------------------------------------------------------------------
    async def cleanup(self) -> int:
        settings = await self.ctx.settings()
        cutoff = fmt_ts(self.ctx.clock.utcnow() - timedelta(days=settings["notification_retention_days"]))
        return (await self.ctx.db.run(*self.repo.cleanup_stmt(cutoff))).changes
