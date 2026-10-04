"""End-to-end check of a deployed SmartGym (works on an empty gym, unlike smoke_test.py).

    python scripts/live_check.py --base https://smartgym-api-test.example.workers.dev --login admin@gym.com

Asks for the admin password (never pass it on the command line). It creates ONE test member
("Live Check <time>") with app access, records a cash payment for the cheapest active plan,
checks the member in and out with their QR, signs in to the member app, submits a UPI renewal
and approves it. Members can't be deleted by design, so run this only on a test deployment
(or turn the test member off afterwards: Members -> the member -> More -> Member app access).
"""

from __future__ import annotations

import argparse
import getpass
import json
import random
import secrets
import sys
import time
import urllib.error
import urllib.request
import uuid

FAILURES: list[str] = []


def call(base: str, method: str, path: str, token: str | None = None, body: dict | None = None,
         headers: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    # Cloudflare's browser check refuses the default Python-urllib agent (error 1010).
    request.add_header("User-Agent", "SmartGym-live-check/1.0")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, text = response.status, response.read().decode()
    except urllib.error.HTTPError as exc:
        status, text = exc.code, exc.read().decode()
    elapsed = (time.perf_counter() - started) * 1000
    print(f"      {method:<6} {path:<52} {status}  {elapsed:6.0f} ms")
    try:
        return status, json.loads(text) if text else {}
    except ValueError:
        return status, {"raw": text[:200]}


def expect(name: str, ok: bool, detail: object = "") -> bool:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    if not ok:
        FAILURES.append(name)
        print(f"         {str(detail)[:300]}")
    return ok


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="API origin, e.g. https://smartgym-api-test.<you>.workers.dev")
    parser.add_argument("--login", required=True, help="admin email")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    password = getpass.getpass(f"Admin password for {args.login}: ")

    print(f"\nSmartGym live check against {base}")
    status, health = call(base, "GET", "/api/health")
    expect("API is up", status == 200 and health.get("status") == "ok", health)

    status, auth = call(base, "POST", "/api/auth/login", body={"identifier": args.login, "password": password})
    if not expect("admin sign-in", status == 200, auth):
        sys.exit(1)
    admin = auth["token"]

    status, plans = call(base, "GET", "/api/membership-plans", admin)
    active = [p for p in plans.get("items", []) if p.get("status") == "ACTIVE"]
    if not expect("an active membership plan exists", bool(active), plans):
        sys.exit(1)
    plan = min(active, key=lambda p: p["price"])

    # 1. Member with app access
    name = f"Live Check {time.strftime('%d%m %H%M%S')}"
    phone = "9" + "".join(random.choice("0123456789") for _ in range(9))
    status, created = call(base, "POST", "/api/members", admin, {"name": name, "phone": phone, "create_app_login": True})
    if not expect("add member (with app access)", status == 201 and created.get("credentials"), created):
        sys.exit(1)
    member = created["member"]
    credentials = created["credentials"]
    expect("member ID issued", str(member.get("member_code", "")).strip() != "", member)

    # 2. Desk cash payment -> PAID + active membership, replay-safe
    key = uuid.uuid4().hex
    body = {"member_id": member["id"], "plan_id": plan["id"], "payment_method": "CASH"}
    status, paid = call(base, "POST", "/api/payments", admin, body, {"Idempotency-Key": key})
    expect("cash payment -> PAID", status == 201 and paid.get("payment", {}).get("status") == "PAID", paid)
    status, replay = call(base, "POST", "/api/payments", admin, body, {"Idempotency-Key": key})
    expect("double-tap records once", status == 200 and replay.get("replayed") is True, replay)
    if paid.get("payment"):
        status, receipt = call(base, "GET", f"/api/payments/{paid['payment']['id']}/receipt", admin)
        expect("receipt", status == 200 and str(receipt.get("receipt_number", "")).startswith("RCT-"), receipt)
    status, workspace = call(base, "GET", f"/api/members/{member['id']}", admin)
    membership = (workspace.get("membership") or {})
    expect("membership active", status == 200 and membership.get("status") in ("ACTIVE", "EXPIRING"), workspace.get("membership"))

    # 3. QR check-in / duplicate scan / check-out
    status, qr = call(base, "GET", f"/api/members/{member['id']}/qr", admin)
    expect("member QR pass", status == 200 and str(qr.get("payload", "")).startswith("SG1."), qr)
    status, scan = call(base, "POST", "/api/attendance/scan", admin, {"code": qr.get("payload", "")})
    expect("QR scan -> checked in", status == 200 and scan.get("result") == "CHECKED_IN", scan)
    status, again = call(base, "POST", "/api/attendance/scan", admin, {"code": qr.get("payload", "")})
    expect("repeat scan does not record twice", status == 200 and again.get("result") != "CHECKED_IN", again)

    # 4. Member app: first sign-in with the one-time password, choose a new one
    status, first = call(base, "POST", "/api/auth/login",
                         body={"identifier": credentials["login"], "password": credentials["temporary_password"]})
    expect("member first sign-in", status == 200 and first.get("user", {}).get("role") == "MEMBER", first)
    member_token = first.get("token")
    if member_token:
        new_password = "Lc@" + secrets.token_urlsafe(12)
        status, changed = call(base, "POST", "/api/auth/change-password", member_token,
                               {"current_password": credentials["temporary_password"], "new_password": new_password})
        expect("member sets own password", status == 200 and changed.get("token"), changed)
        member_token = changed.get("token") or member_token
        status, overview = call(base, "GET", "/api/me/overview", member_token)
        expect("member app home shows membership", status == 200 and overview.get("membership"), overview)
        status, inbox = call(base, "GET", "/api/notifications/inbox", member_token)
        expect("member notifications", status == 200 and "unread" in inbox, inbox)
        status, visits = call(base, "GET", "/api/me/attendance", member_token)
        expect("member sees today's visit", status == 200, visits)
        status, blocked = call(base, "GET", "/api/members", member_token)
        expect("member blocked from staff data", status == 403, blocked)

        # 5. UPI renewal from the member app -> staff approve
        status, upi = call(base, "GET", f"/api/me/upi?plan_id={plan['id']}", member_token)
        expect("UPI details for renewal", status == 200, upi)
        utr = "".join(random.choice("0123456789") for _ in range(12))
        status, renewal = call(base, "POST", "/api/me/renewals", member_token, {"plan_id": plan["id"], "utr": utr})
        expect("UPI renewal -> PENDING", status == 201 and renewal.get("payment", {}).get("status") == "PENDING", renewal)
        status, dup = call(base, "POST", "/api/me/renewals", member_token, {"plan_id": plan["id"], "utr": utr})
        expect("second pending renewal refused", status == 409, dup)
        if renewal.get("payment"):
            payment_id = renewal["payment"]["id"]
            status, approved = call(base, "POST", f"/api/payments/{payment_id}/approve", admin)
            expect("staff approve UPI -> PAID", status == 200 and approved.get("payment", {}).get("status") == "PAID", approved)
            status, twice = call(base, "POST", f"/api/payments/{payment_id}/approve", admin)
            expect("approving twice changes nothing", status == 200 and twice.get("already_processed") is True, twice)

    # 6. Check-out, dashboards and reports
    status, out = call(base, "POST", "/api/attendance", admin, {"member_id": member["id"], "action": "OUT"})
    expect("check-out", status == 200, out)
    for path, check in (("/api/dashboard/summary", "members"), ("/api/dashboard/charts", "revenue_trend"),
                        ("/api/reports/payments", "summary"), ("/api/reports/attendance", "summary"),
                        ("/api/storage", "status"), ("/api/backups", "options")):
        status, data = call(base, "GET", path, admin)
        expect(path, status == 200 and check in data, data)

    print(f"\nTest member: {name} ({member.get('member_code')}). Turn off their app access when you're done.")
    print(f"{len(FAILURES)} failure(s){': ' + ', '.join(FAILURES) if FAILURES else ''}")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    main()
