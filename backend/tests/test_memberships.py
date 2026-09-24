import asyncio
from datetime import datetime, timezone

from conftest import create_member, pay

from core.clock import Clock
from jobs.scheduler import run_daily_jobs


def test_status_rules_active_expiring_expired(client, admin, plans):
    member = create_member(client, admin)["member"]
    # 30-day plan that started 25 days ago -> 4 days left -> EXPIRING
    body = pay(client, admin, member["id"], plans["Monthly"], start_date="2026-08-29").json()
    assert body["membership"]["status"] == "EXPIRING" and body["membership"]["days_left"] == 4
    workspace = client.get(f"/api/members/{member['id']}", headers=admin).json()
    assert workspace["membership"]["status"] == "EXPIRING"


def test_renewal_starts_after_current_membership(client, admin, plans):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"])  # 23 Sep -> 22 Oct
    preview = client.get("/api/memberships/preview", params={"member_id": member["id"], "plan_id": plans["Quarterly"]["id"]},
                         headers=admin).json()
    assert preview["start_date"] == "2026-10-23" and preview["is_renewal"] is True
    renewal = pay(client, admin, member["id"], plans["Quarterly"]).json()
    assert renewal["membership"]["start_date"] == "2026-10-23" and renewal["membership"]["status"] == "UPCOMING"
    assert renewal["member"]["expiry_date"] == "2027-01-20"


def test_daily_job_expires_memberships_and_members(client, admin, plans, db, config):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"])  # 23 Sep -> 22 Oct
    Clock.frozen = datetime(2026, 10, 16, 1, 0, tzinfo=timezone.utc)  # 6 days left
    report = asyncio.run(run_daily_jobs(db, config))
    assert report["memberships"]["memberships_expiring"] == 1
    assert db.conn.execute("SELECT status FROM memberships").fetchone()[0] == "EXPIRING"
    Clock.frozen = datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)  # ended 22 Oct
    report = asyncio.run(run_daily_jobs(db, config))
    assert report["memberships"]["members_expired"] == 1
    assert db.conn.execute("SELECT status FROM memberships").fetchone()[0] == "EXPIRED"
    assert db.conn.execute("SELECT status FROM members").fetchone()[0] == "EXPIRED"
    # Paying again reactivates the member.
    pay(client, admin, member["id"], plans["Monthly"])
    assert db.conn.execute("SELECT status FROM members").fetchone()[0] == "ACTIVE"


def test_backdated_payment_for_a_past_period_leaves_member_expired(client, admin, plans, db):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"], start_date="2026-08-01", payment_date="2026-08-01")  # ended 30 Aug
    assert db.conn.execute("SELECT status FROM members").fetchone()[0] == "EXPIRED"


def test_admin_cancel_recomputes_member_status(client, admin, plans, db):
    member = create_member(client, admin)["member"]
    membership = pay(client, admin, member["id"], plans["Monthly"]).json()["membership"]
    assert client.post(f"/api/memberships/{membership['id']}/cancel", headers=admin).json()["status"] == "CANCELLED"
    assert db.conn.execute("SELECT status FROM members").fetchone()[0] == "INACTIVE"


def test_membership_history_cannot_be_deleted_outside_archive(client, admin, plans, db):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"])
    try:
        db.conn.execute("DELETE FROM memberships")
        raise AssertionError("delete should be blocked")
    except Exception as exc:
        assert "archive" in str(exc)


def test_renewals_follow_up_lists(client, admin, plans):
    soon = create_member(client, admin)["member"]
    lapsed = create_member(client, admin, name="Priya Nair", phone="9876500002")["member"]
    pay(client, admin, soon["id"], plans["Monthly"], start_date="2026-08-28")    # ends 26 Sep
    pay(client, admin, lapsed["id"], plans["Monthly"], start_date="2026-08-01")  # ended 30 Aug
    upcoming = client.get("/api/memberships/renewals", params={"window": "upcoming"}, headers=admin).json()
    expired = client.get("/api/memberships/renewals", params={"window": "expired"}, headers=admin).json()
    assert [i["name"] for i in upcoming["items"]] == ["Aarav Sharma"]
    assert [i["name"] for i in expired["items"]] == ["Priya Nair"]
