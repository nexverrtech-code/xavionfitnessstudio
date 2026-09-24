"""AttendanceService: QR attendance at the front desk (manual search as fallback).

    QR scanned -> token resolved to the member -> membership checked -> attendance recorded

One scan = at most two round trips: member + validity in one query, then an idempotent insert
(UNIQUE member/day + ON CONFLICT DO NOTHING) batched with a read-back. Repeat scans never add
rows; with check-out enabled, a later scan records the check-out time.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from core.clock import iso_z, parse_ts
from core.errors import Conflict, NotFound
from repositories.attendance import AttendanceRepository
from security.qr import looks_like_qr, token_from_payload
from utils.formatting import digits_only, format_date, member_code_candidates, normalize_phone

from .context import Ctx
from .membership_rules import coverage_state

EXPIRED_MESSAGE = "Membership Expired. Please renew your membership."


def _outcome(result: str, message: str, *, ok: bool = False, member: dict[str, Any] | None = None,
             today: date | None = None, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"result": result, "ok": ok, "message": message}
    if member:
        body["member"] = {"id": member["id"], "member_code": member["member_code"], "name": member["name"]}
        if today is not None:
            body["membership"] = {**coverage_state(member.get("expiry_date"), today), "plan_name": member.get("plan_name")}
    body.update(extra)
    return body


class AttendanceService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.attendance = AttendanceRepository(ctx.db)

    async def _lookup(self, by: str, value: Any, today: date, grace_days: int) -> list[dict[str, Any]]:
        return await self.attendance.members_for_check_in(by, value, today.isoformat(), (today - timedelta(days=grace_days)).isoformat())

    async def scan(self, code: str) -> dict[str, Any]:
        settings = await self.ctx.settings()
        today = self.ctx.clock.today()
        grace = settings["attendance_grace_days"]
        code = code.strip()
        member = None
        method = "MANUAL"
        if looks_like_qr(code):
            token = token_from_payload(code)
            if not token:
                return _outcome("INVALID", "This QR code isn't valid for this gym.")
            rows = await self._lookup("qr", token, today, grace)
            if not rows:
                return _outcome("INVALID", "This QR code is no longer valid. Ask the member to open the latest QR in their app.")
            member, method = rows[0], "QR"
        else:
            codes = member_code_candidates(code, settings["member_code_prefix"])
            digits = digits_only(code)
            if codes:
                rows = await self._lookup("code", codes[0], today, grace)
                member = rows[0] if rows else None
            elif len(digits) >= 10:
                rows = await self._lookup("phone", normalize_phone(code, self.ctx.config.default_country_code), today, grace)
                if len(rows) > 1:
                    return _outcome(
                        "MULTIPLE", "Several members share this phone number. Pick the right one.",
                        matches=[{"id": r["id"], "member_code": r["member_code"], "name": r["name"]} for r in rows],
                    )
                member = rows[0] if rows else None
        if not member:
            return _outcome("NOT_FOUND", "No member found for this code.")
        if self.ctx.user and self.ctx.user.role == "TRAINER" and member["trainer_id"] != self.ctx.user.trainer_id:
            return _outcome("NOT_FOUND", "No member found for this code.")
        return await self._check_in(member, settings, today, method)

    async def mark(self, member_id: int) -> dict[str, Any]:
        """Manual check-in from member search (fallback when a QR can't be scanned)."""
        settings = await self.ctx.settings()
        today = self.ctx.clock.today()
        rows = await self._lookup("id", member_id, today, settings["attendance_grace_days"])
        if not rows:
            raise NotFound("Member not found.")
        return await self._check_in(rows[0], settings, today, "MANUAL")

    async def _check_in(self, member: dict[str, Any], settings: dict[str, Any], today: date, method: str) -> dict[str, Any]:
        if member["status"] == "SUSPENDED":
            return _outcome("SUSPENDED", "Membership on hold. Please see the front desk.", member=member, today=today)
        if member["status"] == "INACTIVE" and member["valid_until"]:
            # Deactivated by the gym (e.g. left) although a paid membership still covers today.
            return _outcome("INACTIVE", "This member is inactive. Reactivate them to allow entry.", member=member, today=today)
        if not member["valid_until"]:
            if member["next_start"]:
                return _outcome("NOT_STARTED", f"Membership starts on {format_date(member['next_start'])}.", member=member, today=today)
            if member["expiry_date"]:
                return _outcome("EXPIRED", EXPIRED_MESSAGE, member=member, today=today)
            return _outcome("NO_MEMBERSHIP", "No active membership. Please choose a plan.", member=member, today=today)

        now = self.ctx.now
        inserted, existing = await self.attendance.check_in(member["id"], today.isoformat(), now, method)
        if inserted.rows:
            row = inserted.first
            return _outcome("CHECKED_IN", "Attendance Marked", ok=True, member=member, today=today,
                            time=iso_z(row["check_in"]), attendance_id=row["id"])
        row = existing.first
        minutes_since = (parse_ts(now) - parse_ts(row["check_in"])).total_seconds() / 60
        if settings["attendance_checkout"] and row["check_out"] is None and minutes_since >= settings["attendance_cooldown_minutes"]:
            if await self.attendance.check_out(row["id"], now):
                return _outcome("CHECKED_OUT", "Checked out", ok=True, member=member, today=today, time=iso_z(now),
                                check_in=iso_z(row["check_in"]), attendance_id=row["id"])
        if row["check_out"]:
            return _outcome("ALREADY_CHECKED_OUT", "Already checked out today", ok=True, member=member, today=today,
                            time=iso_z(row["check_out"]), check_in=iso_z(row["check_in"]), attendance_id=row["id"])
        return _outcome("ALREADY_CHECKED_IN", "Already checked in today", ok=True, member=member, today=today,
                        time=iso_z(row["check_in"]), attendance_id=row["id"])

    async def day_log(self, page, day: date, *, trainer_id: int | None = None) -> dict[str, Any]:
        rows, total, checked_out = await self.attendance.day_log(day.isoformat(), trainer_id, page.limit, page.offset)
        items = [
            {
                "id": r["id"],
                "member_id": r["member_id"],
                "member_name": r["name"],
                "member_code": r["member_code"],
                "phone": r["phone"],
                "date": r["attendance_date"],
                "check_in": iso_z(r["check_in"]),
                "check_out": iso_z(r["check_out"]),
                "method": r["method"],
            }
            for r in rows
        ]
        result = page.wrap(items, total)
        result.update({"checked_out": checked_out, "date": day.isoformat()})
        return result

    async def member_history(self, member_id: int, start: date, end: date) -> dict[str, Any]:
        rows = await self.attendance.member_history(member_id, start.isoformat(), end.isoformat())
        return {
            "from": start.isoformat(),
            "to": end.isoformat(),
            "count": len(rows),
            "items": [
                {"id": r["id"], "date": r["attendance_date"], "check_in": iso_z(r["check_in"]),
                 "check_out": iso_z(r["check_out"]), "method": r["method"]}
                for r in rows
            ],
        }

    async def daily_counts(self, start: date, end: date) -> list[dict[str, Any]]:
        counts = {r["date"]: r["visits"] for r in await self.attendance.daily_counts(start.isoformat(), end.isoformat())}
        days = (end - start).days + 1
        return [{"date": (d := (start + timedelta(days=i)).isoformat()), "visits": counts.get(d, 0)} for i in range(days)]

    async def delete_entry(self, attendance_id: int) -> None:
        row = await self.attendance.get(attendance_id)
        if not row:
            raise NotFound("Attendance entry not found.")
        if not (self.ctx.user and self.ctx.user.is_admin) and row["attendance_date"] != self.ctx.clock.today().isoformat():
            raise Conflict("Only today's entries can be removed. Ask an admin for older corrections.")
        await self.attendance.delete(attendance_id)
