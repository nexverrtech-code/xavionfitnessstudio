import asyncio
from datetime import datetime, timezone

from conftest import create_member, pay

from core.clock import Clock
from jobs.scheduler import run_daily_jobs


def _inbox(client, headers):
    return client.get("/api/notifications/inbox", headers=headers).json()


def test_expiry_reminders_7_3_1_and_expired_are_deduplicated(client, admin, plans, member_session, db, config):
    member, headers = member_session
    pay(client, admin, member["id"], plans["Monthly"])  # ends 22 Oct
    for day, kind in ((15, "EXPIRY_7D"), (19, "EXPIRY_3D"), (21, "EXPIRY_1D"), (23, "MEMBERSHIP_EXPIRED")):
        Clock.frozen = datetime(2026, 10, day, 1, 0, tzinfo=timezone.utc)
        asyncio.run(run_daily_jobs(db, config))
        asyncio.run(run_daily_jobs(db, config))  # a second run the same day adds nothing
        types = [n["type"] for n in _inbox(client, headers)["items"]]
        assert types.count(kind) == 1, (kind, types)
    expired = next(n for n in _inbox(client, headers)["items"] if n["type"] == "MEMBERSHIP_EXPIRED")
    assert expired["message"].startswith("Membership expired. Please renew to continue.")


def test_renewed_members_get_no_expiry_reminder(client, admin, plans, member_session, db, config):
    member, headers = member_session
    pay(client, admin, member["id"], plans["Monthly"])
    pay(client, admin, member["id"], plans["Quarterly"])  # already renewed
    Clock.frozen = datetime(2026, 10, 15, 1, 0, tzinfo=timezone.utc)
    asyncio.run(run_daily_jobs(db, config))
    assert not [n for n in _inbox(client, headers)["items"] if n["type"].startswith("EXPIRY")]


def test_mark_read_and_announcements(client, admin, member_session):
    _, headers = member_session
    sent = client.post("/api/notifications/send", json={"segment": "ALL", "message": "Gym closed on Sunday for maintenance."},
                       headers=admin).json()
    assert sent["delivered"] == 1
    inbox = _inbox(client, headers)
    assert inbox["unread"] >= 1 and inbox["items"][0]["type"] == "ANNOUNCEMENT"
    assert client.post("/api/notifications/read-all", headers=headers).status_code == 204
    assert _inbox(client, headers)["unread"] == 0
    log = client.get("/api/notifications", headers=admin).json()
    assert log["total"] >= 2


def test_old_notifications_are_cleaned_up_but_payments_kept(client, admin, plans, member_session, db, config):
    member, headers = member_session
    pay(client, admin, member["id"], plans["Monthly"])
    Clock.frozen = datetime(2027, 6, 1, 1, 0, tzinfo=timezone.utc)  # > 180 days later
    asyncio.run(run_daily_jobs(db, config))
    assert db.conn.execute("SELECT COUNT(*) FROM notifications WHERE created_at < '2026-12-01'").fetchone()[0] == 0
    assert db.conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0] == 1


def test_reports_return_json_for_browser_rendering(client, admin, plans):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"], method="UPI", transaction_reference="412345678901")
    client.post("/api/expenses", json={"category": "RENT", "amount": 4500000, "description": "September rent"}, headers=admin)
    params = {"from": "2026-09-01", "to": "2026-09-30"}
    payments = client.get("/api/reports/payments", params=params, headers=admin).json()
    upi = next(m for m in payments["summary"]["methods"] if m["method"] == "UPI")
    assert upi["amount"] == 150000 and payments["summary"]["total_revenue"] == 150000
    assert payments["rows"][0]["payment_number"] == "PAY-2026-000001"
    members = client.get("/api/reports/members", params=params, headers=admin).json()
    assert members["summary"]["total"] == 1 and members["summary"]["new_members"] == 1
    memberships = client.get("/api/reports/memberships", params=params, headers=admin).json()
    monthly = next(p for p in memberships["summary"]["plans"] if p["plan"] == "Monthly")
    assert monthly["active"] == 1
    expenses = client.get("/api/reports/expenses", params=params, headers=admin).json()
    assert expenses["summary"]["total"] == 4500000 and expenses["rows"][0]["category"] == "RENT"
    attendance = client.get("/api/reports/attendance", params=params, headers=admin).json()
    assert attendance["summary"]["total_visits"] == 0 and attendance["truncated"] is False


def test_dashboard_net_revenue_subtracts_refunds_and_expenses(client, admin, plans):
    member = create_member(client, admin)["member"]
    payment = pay(client, admin, member["id"], plans["Quarterly"]).json()["payment"]
    client.post(f"/api/payments/{payment['id']}/refund", json={"amount": 100000, "refund_method": "CASH",
                                                               "refund_reason": "Partial refund", "cancel_membership": False}, headers=admin)
    client.post("/api/expenses", json={"category": "ELECTRICITY", "amount": 50000}, headers=admin)
    summary = client.get("/api/dashboard/summary", headers=admin).json()
    assert summary["revenue"]["month"] == 300000 and summary["net_revenue"] == 250000
    charts = client.get("/api/dashboard/charts", headers=admin).json()
    assert charts["revenue_trend"][-1]["revenue"] == 300000
    assert {"revenue_trend", "membership_trend", "attendance_trend", "payment_methods", "plan_distribution"} <= set(charts)
