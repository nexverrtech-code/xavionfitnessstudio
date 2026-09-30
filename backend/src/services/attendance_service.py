"""AttendanceService: QR attendance at the front desk (manual search as fallback).

    QR scanned -> token resolved to the member -> membership checked -> visit recorded

A member may come several times a day (morning, afternoon, night). With check-out on, scans
alternate: the first starts a visit (check-in), the next ends it (check-out), the next starts
a new visit, and so on. Scans closer together than the cooldown are duplicates and change
nothing. A check-in left open longer than the longest visit counts as a forgotten check-out,
so the next scan starts a new visit. Leaving is always allowed, even if the membership ended
during the visit. Days present are counted once per day everywhere.

One scan = two round trips: member + validity + latest visit in one query, then one atomic
insert (or update) batched with a read-back. Two desks scanning the same member at the same
moment still record a single visit.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

from core.clock import fmt_ts, iso_z, minutes_between, parse_ts
from core.database import IntegrityError
from core.errors import Conflict, NotFound
from repositories.attendance import AttendanceRepository, visit_from_json, visits_from_json
from security.qr import looks_like_qr, token_from_payload
from utils.formatting import digits_only, format_date, member_code_candidates, normalize_phone

from .context import Ctx
from .membership_rules import coverage_state

EXPIRED_MESSAGE = "Membership Expired. Please renew your membership."
Action = Literal["IN", "OUT"]


def _outcome(result: str, message: str, *, ok: bool = False, member: dict[str, Any] | None = None,
             today: date | None = None, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"result": result, "ok": ok, "message": message}
    if member:
        body["member"] = {"id": member["id"], "member_code": member["member_code"], "name": member["name"]}
        if today is not None:
            body["membership"] = {**coverage_state(member.get("expiry_date"), today), "plan_name": member.get("plan_name")}
    body.update(extra)
    return body


@dataclass(frozen=True)
class VisitRules:
    """The gym's attendance settings, turned into timestamp cut-offs for ``now``."""

    checkout: bool
    daily_limit: int
    recent_after: str  # a visit started or ended after this is a duplicate scan
    open_after: str  # an open visit started after this is still going (else: forgotten check-out)

    @classmethod
    def build(cls, settings: dict[str, Any], now: str) -> VisitRules:
        at: datetime = parse_ts(now)
        checkout = bool(settings["attendance_checkout"])
        return cls(
            checkout=checkout,
            daily_limit=int(settings["attendance_max_visits_per_day"]),
            recent_after=fmt_ts(at - timedelta(minutes=int(settings["attendance_cooldown_minutes"]))),
            # Without check-out nobody is "inside": no timestamp is later than now.
            open_after=fmt_ts(at - timedelta(hours=int(settings["attendance_max_visit_hours"]))) if checkout else now,
        )

    def is_open(self, visit: dict[str, Any]) -> bool:
        return visit["check_out"] is None and visit["check_in"] > self.open_after


def _visit_out(v: dict[str, Any], rules: VisitRules) -> dict[str, Any]:
    return {
        "id": v["id"],
        "check_in": iso_z(v["check_in"]),
        "check_out": iso_z(v["check_out"]),
        "method": v["method"],
        "open": rules.is_open(v),
        "minutes": minutes_between(v["check_in"], v["check_out"]),
    }


class AttendanceService:
    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.attendance = AttendanceRepository(ctx.db)

    async def _lookup(self, by: str, value: Any, today: date, grace_days: int) -> list[dict[str, Any]]:
        return await self.attendance.members_for_check_in(
            by, value, today.isoformat(), (today - timedelta(days=grace_days)).isoformat(), (today - timedelta(days=1)).isoformat()
        )

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
        return await self._record(member, settings, today, method)

    async def mark(self, member_id: int, action: Action | None = None) -> dict[str, Any]:
        """From member search (fallback when a QR can't be scanned). ``action`` makes the intent
        explicit: "IN" never checks a member out, "OUT" never checks one in."""
        settings = await self.ctx.settings()
        today = self.ctx.clock.today()
        rows = await self._lookup("id", member_id, today, settings["attendance_grace_days"])
        if not rows:
            raise NotFound("Member not found.")
        return await self._record(rows[0], settings, today, "MANUAL", action)

    async def _record(self, member: dict[str, Any], settings: dict[str, Any], today: date, method: str,
                      action: Action | None = None) -> dict[str, Any]:
        now = self.ctx.now
        rules = VisitRules.build(settings, now)
        last = visit_from_json(member.get("last_visit"))
        visits_today = int(member.get("visits_today") or 0)
        inside = last is not None and rules.checkout and rules.is_open(last)

        if inside and action != "IN":
            if action is None and last["check_in"] > rules.recent_after:
                return self._already(member, today, last, visits_today)  # a double scan right after check-in
            return await self._check_out(member, today, last, now, visits_today)
        if action == "OUT":
            return _outcome("NOT_CHECKED_IN", "Not checked in right now.", member=member, today=today, visits_today=visits_today)
        if inside:
            return self._already(member, today, last, visits_today)

        refused = self._entry_refused(member, today)
        if refused:
            return refused
        if last and (last["check_in"] > rules.recent_after or (last["check_out"] or "") > rules.recent_after):
            return self._already(member, today, last, visits_today)  # a double scan
        if visits_today >= rules.daily_limit:
            return self._limit(member, today, rules, visits_today)
        return await self._check_in(member, today, now, method, rules)

    def _entry_refused(self, member: dict[str, Any], today: date) -> dict[str, Any] | None:
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
        return None

    async def _check_in(self, member: dict[str, Any], today: date, now: str, method: str, rules: VisitRules) -> dict[str, Any]:
        yesterday = (today - timedelta(days=1)).isoformat()
        try:
            inserted, latest = await self.attendance.start_visit(
                member["id"], today=today.isoformat(), yesterday=yesterday, now=now, method=method,
                recent_after=rules.recent_after, open_after=rules.open_after, daily_limit=rules.daily_limit,
            )
        except IntegrityError:
            # Only possible before migration 0007 (one row per member per day) has been applied.
            return _outcome("LIMIT", "Only one visit a day can be recorded until the database update is applied.",
                            member=member, today=today, visits_today=1)
        state = latest.first or {}
        visits_today = int(state.get("visits_today") or 0)
        if inserted.rows:
            row = inserted.first
            return _outcome("CHECKED_IN", "Attendance Marked", ok=True, member=member, today=today, time=iso_z(row["check_in"]),
                            attendance_id=row["id"], visit_number=visits_today, visits_today=visits_today)
        # Another desk recorded this member a moment ago: report what is there now.
        last = visit_from_json(state.get("last_visit"))
        if visits_today >= rules.daily_limit and not (last and rules.is_open(last)):
            return self._limit(member, today, rules, visits_today)
        return self._already(member, today, last, visits_today) if last else _outcome(
            "ALREADY_CHECKED_IN", "Already checked in", ok=True, member=member, today=today, visits_today=visits_today)

    async def _check_out(self, member: dict[str, Any], today: date, last: dict[str, Any], now: str,
                         visits_today: int) -> dict[str, Any]:
        ended = await self.attendance.end_visit(last["id"], now)
        if ended:
            return _outcome("CHECKED_OUT", "Checked out", ok=True, member=member, today=today, time=iso_z(ended["check_out"]),
                            check_in=iso_z(ended["check_in"]), attendance_id=last["id"],
                            minutes=minutes_between(ended["check_in"], ended["check_out"]), visits_today=visits_today)
        # Checked out by another desk a moment ago.
        state = await self.attendance.latest(member["id"], today.isoformat(), (today - timedelta(days=1)).isoformat())
        current = visit_from_json(state.get("last_visit")) or last
        return self._already(member, today, {**current, "check_out": current["check_out"] or now}, visits_today)

    def _already(self, member: dict[str, Any], today: date, last: dict[str, Any], visits_today: int) -> dict[str, Any]:
        if last["check_out"]:
            return _outcome("ALREADY_CHECKED_OUT", "Already checked out", ok=True, member=member, today=today,
                            time=iso_z(last["check_out"]), check_in=iso_z(last["check_in"]), attendance_id=last["id"],
                            visits_today=visits_today)
        return _outcome("ALREADY_CHECKED_IN", "Already checked in", ok=True, member=member, today=today,
                        time=iso_z(last["check_in"]), attendance_id=last["id"], visits_today=visits_today)

    def _limit(self, member: dict[str, Any], today: date, rules: VisitRules, visits_today: int) -> dict[str, Any]:
        visits = "1 visit" if rules.daily_limit == 1 else f"{rules.daily_limit} visits"
        return _outcome("LIMIT", f"Daily limit reached — {visits} a day.", member=member, today=today, visits_today=visits_today)

    # -- views ----------------------------------------------------------------------------------
    async def day_log(self, page, day: date, *, trainer_id: int | None = None, in_gym_only: bool = False) -> dict[str, Any]:
        rules = VisitRules.build(await self.ctx.settings(), self.ctx.now)
        in_gym_only = in_gym_only and rules.checkout
        rows, totals = await self.attendance.day_log(
            day.isoformat(), trainer_id=trainer_id, open_after=rules.open_after, in_gym_only=in_gym_only,
            limit=page.limit, offset=page.offset,
        )
        items = []
        for r in rows:
            visits = [_visit_out(v, rules) for v in visits_from_json(r["visits"])]
            first, latest = visits[0], visits[-1]
            items.append(
                {
                    "member_id": r["member_id"],
                    "member_name": r["name"],
                    "member_code": r["member_code"],
                    "phone": r["phone"],
                    "date": day.isoformat(),
                    "visits": visits,
                    "visit_count": len(visits),
                    "in_gym": any(v["open"] for v in visits),
                    "minutes": sum(v["minutes"] for v in visits),
                    # Summary of the day (and what screens built for one visit a day read):
                    "id": latest["id"],
                    "check_in": first["check_in"],
                    "check_out": latest["check_out"],
                    "method": first["method"],
                }
            )
        members, in_gym = int(totals.get("members") or 0), int(totals.get("in_gym") or 0)
        result = page.wrap(items, in_gym if in_gym_only else members)
        result.update(
            {
                "date": day.isoformat(),
                "checkout": rules.checkout,
                "members": members,
                "visits": int(totals.get("visits") or 0),
                "in_gym": in_gym if rules.checkout else None,
                "checked_out": int(totals.get("checked_out") or 0),
            }
        )
        return result

    async def member_history(self, member_id: int, start: date, end: date) -> dict[str, Any]:
        """A month of attendance grouped by day (newest day first, visits in time order)."""
        rules = VisitRules.build(await self.ctx.settings(), self.ctx.now)
        rows = await self.attendance.member_history(member_id, start.isoformat(), end.isoformat())
        days: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            days.setdefault(r["attendance_date"], []).append(r)
        items = []
        for day, day_rows in days.items():
            visits = [_visit_out(v, rules) for v in sorted(day_rows, key=lambda v: v["check_in"])]
            items.append(
                {
                    "date": day,
                    "visits": visits,
                    "minutes": sum(v["minutes"] for v in visits),
                    # The day at a glance: first check-in, last check-out.
                    "id": visits[-1]["id"],
                    "check_in": visits[0]["check_in"],
                    "check_out": visits[-1]["check_out"],
                    "method": visits[0]["method"],
                }
            )
        return {"from": start.isoformat(), "to": end.isoformat(), "count": len(items), "days": len(items), "visits": len(rows),
                "items": items}

    async def daily_counts(self, start: date, end: date) -> list[dict[str, Any]]:
        counts = {r["date"]: r for r in await self.attendance.daily_counts(start.isoformat(), end.isoformat())}
        days = (end - start).days + 1
        out = []
        for i in range(days):
            d = (start + timedelta(days=i)).isoformat()
            row = counts.get(d) or {}
            out.append({"date": d, "members": row.get("members", 0), "visits": row.get("visits", 0)})
        return out

    async def delete_entry(self, attendance_id: int) -> None:
        row = await self.attendance.get(attendance_id)
        if not row:
            raise NotFound("Attendance entry not found.")
        if not (self.ctx.user and self.ctx.user.is_admin) and row["attendance_date"] != self.ctx.clock.today().isoformat():
            raise Conflict("Only today's entries can be removed. Ask an admin for older corrections.")
        await self.attendance.delete(attendance_id)
