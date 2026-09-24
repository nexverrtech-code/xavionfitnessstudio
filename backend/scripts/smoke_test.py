"""End-to-end smoke + latency check against a running SmartGym API.

    python scripts/smoke_test.py --base http://127.0.0.1:8787            # local (pywrangler dev)
    python scripts/smoke_test.py --base https://api.gymname.com --read-only \
        --login admin@gymname.com --password '...'

Walks the main workflows (sign-in, dashboard, search, member workspace, desk payment, UPI
verification, QR attendance, reports, member app, Data & Backup) and prints each call's
latency with the D1 statistics from its Server-Timing header (round trips, statements, rows
read / written). Use --read-only against production so nothing is written. The write checks
expect the development seed data.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid

RESULTS: list[tuple[str, int, float, str]] = []


def call(base: str, method: str, path: str, token: str | None = None, body: dict | None = None, headers: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, raw, timing = response.status, response.read(), response.headers.get("server-timing", "")
    except urllib.error.HTTPError as exc:
        status, raw, timing = exc.code, exc.read(), exc.headers.get("server-timing", "")
    elapsed = (time.perf_counter() - started) * 1000
    RESULTS.append((f"{method} {path.split('?')[0]}", status, elapsed, timing))
    try:
        return status, json.loads(raw) if raw[:1] in (b"{", b"[") else raw
    except ValueError:
        return status, raw


def expect(label: str, condition: bool, detail: object = "") -> None:
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}" + (f" -> {str(detail)[:300]}" if not condition and detail else ""))
    if not condition:
        expect.failures += 1  # type: ignore[attr-defined]


expect.failures = 0  # type: ignore[attr-defined]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8787")
    parser.add_argument("--login", default="admin@smartgym.local")
    parser.add_argument("--password", default="Admin@123")
    parser.add_argument("--read-only", action="store_true")
    parser.add_argument("--repeat", type=int, default=3, help="repeat read endpoints to average latency")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    print(f"SmartGym smoke test against {base}")
    status, health = call(base, "GET", "/api/health")
    expect("health", status == 200, health)
    status, login = call(base, "POST", "/api/auth/login", body={"identifier": args.login, "password": args.password})
    expect("admin sign-in", status == 200, login)
    if status != 200:
        sys.exit(1)
    token = login["token"]

    for _ in range(args.repeat):
        status, summary = call(base, "GET", "/api/dashboard/summary", token)
    expect("dashboard KPIs", status == 200 and "members" in summary and "net_revenue" in summary, summary)
    status, charts = call(base, "GET", "/api/dashboard/charts", token)
    expect("dashboard charts", status == 200 and "revenue_trend" in charts, charts)
    status, _ = call(base, "GET", "/api/dashboard/activity", token)
    expect("dashboard activity", status == 200)
    for _ in range(args.repeat):
        status, found = call(base, "GET", "/api/members/search?q=aar", token)
    expect("member search", status == 200 and isinstance(found.get("items"), list), found)
    status, listing = call(base, "GET", "/api/members?page=1&limit=20", token)
    expect("members page (20 per page)", status == 200 and listing.get("limit") == 20, listing)
    member_id = listing["items"][0]["id"] if listing.get("items") else None
    if member_id:
        for _ in range(args.repeat):
            status, workspace = call(base, "GET", f"/api/members/{member_id}", token)
        expect("member workspace", status == 200 and "membership" in workspace, workspace)
    status, _ = call(base, "GET", "/api/payments?period=month", token)
    expect("payment history (this month)", status == 200)
    status, pending = call(base, "GET", "/api/payments/pending", token)
    expect("pending UPI verification queue", status == 200)
    status, report = call(base, "GET", "/api/reports/payments", token)
    expect("payment report data", status == 200 and "summary" in report and "rows" in report, report)
    status, report = call(base, "GET", "/api/reports/attendance", token)
    expect("attendance report data", status == 200 and "daily" in report.get("summary", {}), report)
    status, storage = call(base, "GET", "/api/storage", token)
    expect("storage monitor", status == 200 and storage.get("status") in ("HEALTHY", "MONITOR", "WARNING", "CRITICAL", "ARCHIVE_REQUIRED"), storage)
    status, backups = call(base, "GET", "/api/backups", token)
    expect("backup history", status == 200 and "options" in backups, backups)

    if not args.read_only and member_id:
        status, plans = call(base, "GET", "/api/membership-plans", token)
        plan = plans["items"][0]
        target = listing["items"][-1]
        key = uuid.uuid4().hex
        body = {"member_id": target["id"], "plan_id": plan["id"], "payment_method": "CASH"}
        status, recorded = call(base, "POST", "/api/payments", token, body, {"Idempotency-Key": key})
        expect("desk payment -> PAID + membership (one transaction)", status in (201, 409), recorded)
        if status == 201:
            expect("payment number", recorded["payment"]["payment_number"].startswith("PAY-"), recorded)
            status, replay = call(base, "POST", "/api/payments", token, body, {"Idempotency-Key": key})
            expect("idempotent replay", status == 200 and replay.get("replayed") is True, replay)
            status, receipt = call(base, "GET", f"/api/payments/{recorded['payment']['id']}/receipt", token)
            expect("receipt data", status == 200 and receipt.get("receipt_number", "").startswith("RCT-"), receipt)
        if pending.get("items"):
            payment_id = pending["items"][0]["id"]
            status, approved = call(base, "POST", f"/api/payments/{payment_id}/approve", token)
            expect("approve UPI payment", status == 200 and approved["payment"]["status"] == "PAID", approved)
            status, again = call(base, "POST", f"/api/payments/{payment_id}/approve", token)
            expect("approval is idempotent", status == 200 and again.get("already_processed") is True, again)
        status, qr = call(base, "GET", f"/api/members/{member_id}/qr", token)
        expect("member QR (opaque token)", status == 200 and qr.get("payload", "").startswith("SG1."), qr)
        status, scan = call(base, "POST", "/api/attendance/scan", token, {"code": qr["payload"]})
        expect("QR scan", status == 200 and scan.get("result") in ("CHECKED_IN", "ALREADY_CHECKED_IN", "EXPIRED", "NO_MEMBERSHIP"), scan)
        for _ in range(args.repeat):
            status, scan = call(base, "POST", "/api/attendance/scan", token, {"code": qr["payload"]})
        expect("repeat scan does not duplicate", scan.get("result") != "CHECKED_IN", scan)
        status, backup = call(base, "POST", "/api/backups", token,
                              {"datasets": ["attendance", "expenses"], "period_from": "2025-01-01", "period_to": "2025-12-31"})
        expect("create backup", status == 201 and backup.get("backup", {}).get("status") == "CREATED", backup)
        if status == 201:
            status, page = call(base, "GET", f"/api/backups/{backup['backup']['id']}/data?table=members&after=0", token)
            expect("backup export page", status == 200 and isinstance(page, list), page)
            call(base, "POST", f"/api/backups/{backup['backup']['id']}/cancel", token)

    status, member_login = call(base, "POST", "/api/auth/login", body={"identifier": "GYM000001", "password": "Member@123"})
    if status == 200:
        member_token = member_login["token"]
        for _ in range(args.repeat):
            status, overview = call(base, "GET", "/api/me/overview", member_token)
        expect("member app home", status == 200 and "membership" in overview, overview)
        status, inbox = call(base, "GET", "/api/notifications/inbox", member_token)
        expect("member notifications", status == 200 and "unread" in inbox, inbox)
        status, _ = call(base, "GET", "/api/members", member_token)
        expect("member blocked from staff API", status == 403)

    print("\nLatency (client-measured, ms) and server timing")
    grouped: dict[str, list[tuple[int, float, str]]] = {}
    for name, status, elapsed, timing in RESULTS:
        grouped.setdefault(name, []).append((status, elapsed, timing))
    for name, samples in grouped.items():
        times = [s[1] for s in samples]
        print(f"  {name:<46} n={len(times):<2} median={statistics.median(times):7.1f}  last: {samples[-1][2]}")
    print(f"\n{expect.failures} failure(s)")  # type: ignore[attr-defined]
    sys.exit(1 if expect.failures else 0)  # type: ignore[attr-defined]


if __name__ == "__main__":
    main()
