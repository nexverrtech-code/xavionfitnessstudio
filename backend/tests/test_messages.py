"""Automatic WhatsApp / email messages: queued with payments and reminders, sent by the minute job."""

import asyncio
import json
from dataclasses import replace

import pytest
from conftest import activate_login, create_member, pay
from fastapi.testclient import TestClient

from app import create_app
from core.clock import Clock
from jobs.scheduler import run_daily_jobs, send_messages
from services import message_service
from utils import http


@pytest.fixture
def connected(db, config):
    """The API with both providers configured (as if the Worker secrets were set)."""
    cfg = replace(config, whatsapp_token="wa-secret", whatsapp_phone_number_id="555000111", resend_api_key="re_secret",
                  email_from="receipts@gym.test")
    with TestClient(create_app(config_provider=lambda scope: cfg, db_provider=lambda scope, c: db)) as client:
        yield client, cfg


def _switch_on(client, admin, **overrides):
    body = {"whatsapp_enabled": True, "email_enabled": True, **overrides}
    assert client.put("/api/settings", json=body, headers=admin).status_code == 200


def _outbox(db):
    return [dict(r) for r in db.conn.execute("SELECT channel, event, recipient, params, status, dedupe_key FROM outbox ORDER BY id")]


def test_a_completed_payment_queues_a_whatsapp_and_an_email_receipt(connected, admin, plans, db):
    client, _ = connected
    _switch_on(client, admin)
    member = create_member(client, admin, email="aarav@example.com")["member"]
    payment = pay(client, admin, member["id"], plans["Monthly"]).json()["payment"]
    rows = _outbox(db)
    assert [(r["channel"], r["event"], r["recipient"]) for r in rows] == [
        ("WHATSAPP", "PAYMENT_RECEIVED", "919876543210"), ("EMAIL", "PAYMENT_RECEIVED", "aarav@example.com"),
    ]
    params = json.loads(rows[0]["params"])
    assert params == {"first": "Aarav", "gym": "SmartGym", "amount": "₹1,500", "plan": "Monthly", "end": "22 Oct 2026",
                      "number": payment["payment_number"]}


def test_nothing_is_queued_until_a_channel_is_connected_and_switched_on(client, connected, admin, plans, db):
    member = create_member(client, admin, email="aarav@example.com")["member"]
    client.put("/api/settings", json={"whatsapp_enabled": True, "email_enabled": True}, headers=admin)
    pay(client, admin, member["id"], plans["Monthly"])  # switched on, but no provider secrets
    assert _outbox(db) == []
    connected_client, _ = connected
    connected_client.put("/api/settings", json={"whatsapp_enabled": False, "email_enabled": False}, headers=admin)
    pay(connected_client, admin, member["id"], plans["Quarterly"])  # connected, but switched off
    assert _outbox(db) == []


def test_members_can_stop_messages(connected, admin, plans, db):
    client, _ = connected
    _switch_on(client, admin)
    quiet = create_member(client, admin, messages=False)["member"]
    pay(client, admin, quiet["id"], plans["Monthly"])
    assert _outbox(db) == []
    assert client.get(f"/api/members/{quiet['id']}", headers=admin).json()["messages"] is False

    created = create_member(client, admin, name="Priya Nair", phone="9876500002")
    headers = activate_login(client, created["credentials"]["login"], created["credentials"]["temporary_password"])
    profile = client.put("/api/me/profile", json={"messages": False}, headers=headers).json()
    assert profile["messages"] is False
    pay(client, admin, created["member"]["id"], plans["Monthly"])
    assert _outbox(db) == []


def test_reminders_and_expiry_notices_are_queued_once(connected, admin, plans, db):
    client, cfg = connected
    ending = create_member(client, admin)["member"]
    pay(client, admin, ending["id"], plans["Monthly"], start_date="2026-09-01", payment_date="2026-09-01")  # ends 30 Sep
    lapsed = create_member(client, admin, name="Priya Nair", phone="9876500002", email="priya@example.com")["member"]
    pay(client, admin, lapsed["id"], plans["Monthly"], start_date="2026-08-23", payment_date="2026-08-23")  # ended 21 Sep
    _switch_on(client, admin)
    for _ in range(2):  # a re-run of the daily job adds nothing
        asyncio.run(run_daily_jobs(db, cfg))
    rows = _outbox(db)
    assert sorted((r["event"], r["channel"], r["recipient"]) for r in rows) == [
        ("EXPIRY_7D", "WHATSAPP", "919876543210"),
        ("MEMBERSHIP_EXPIRED", "EMAIL", "priya@example.com"),
        ("MEMBERSHIP_EXPIRED", "WHATSAPP", "919876500002"),
    ]
    reminder = next(r for r in rows if r["event"] == "EXPIRY_7D")
    assert json.loads(reminder["params"]) == {"first": "Aarav", "plan": "Monthly", "gym": "SmartGym", "end": "30 Sep 2026"}


def test_the_sender_records_each_result(connected, admin, plans, db, monkeypatch):
    client, cfg = connected
    _switch_on(client, admin)
    member = create_member(client, admin, name="Aarav <b>Sharma</b>", email="aarav@example.com")["member"]
    pay(client, admin, member["id"], plans["Monthly"])
    calls = []

    async def fake_request(method, url, *, headers=None, json_body=None, timeout=30.0, body=None):
        calls.append((url, headers, json_body))
        if "graph.facebook.com" in url:
            return http.HttpResponse(200, '{"messages":[{"id":"wamid.1"}]}')
        return http.HttpResponse(503, '{"message":"busy"}')  # email provider down: retried later

    monkeypatch.setattr(http, "request", fake_request)
    monkeypatch.setattr(message_service, "EMAIL_GAP_SECONDS", 0)
    assert asyncio.run(send_messages(db, cfg)) == {"sent": 1, "failed": 0, "retry": 1}
    statuses = {r["channel"]: r["status"] for r in _outbox(db)}
    assert statuses == {"WHATSAPP": "SENT", "EMAIL": "QUEUED"}

    url, headers, body = calls[0]
    assert url == "https://graph.facebook.com/v23.0/555000111/messages" and headers["Authorization"] == "Bearer wa-secret"
    template = body["template"]
    assert template["name"] == "payment_received" and template["language"] == {"code": "en"}
    assert [p["text"] for p in template["components"][0]["parameters"]][:3] == ["Aarav", "₹1,500", "SmartGym"]
    email = calls[1][2]
    assert email["from"] == "SmartGym <receipts@gym.test>" and email["to"] == ["aarav@example.com"]
    assert "<b>" not in email["html"] and "Hi Aarav," in email["text"]  # names are escaped in HTML

    # The email provider refuses the message: a permanent failure is recorded, not retried.
    async def refuse(method, url, **kwargs):
        return http.HttpResponse(422, '{"message":"Invalid to address"}')

    monkeypatch.setattr(http, "request", refuse)
    assert asyncio.run(send_messages(db, cfg)) == {"sent": 0, "failed": 1, "retry": 0}
    failed = db.conn.execute("SELECT status, last_error FROM outbox WHERE channel = 'EMAIL'").fetchone()
    assert tuple(failed) == ("FAILED", "Email 422: Invalid to address")


def test_upi_renewal_without_a_utr(connected, admin, plans, db, upi_enabled):
    client, _ = connected
    created = create_member(client, admin, email="aarav@example.com")
    member = created["member"]
    headers = activate_login(client, created["credentials"]["login"], created["credentials"]["temporary_password"])
    submitted = client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"]}, headers=headers)
    assert submitted.status_code == 201, submitted.text
    payment = submitted.json()["payment"]
    assert payment["status"] == "PENDING" and payment["transaction_reference"] is None
    bad = client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"], "utr": "123"}, headers=headers)
    assert bad.status_code == 422 and "utr" in bad.json()["error"]["fields"]

    _switch_on(client, admin)
    approved = client.post(f"/api/payments/{payment['id']}/approve", headers=admin)
    assert approved.status_code == 200 and approved.json()["payment"]["status"] == "PAID"
    assert [r["event"] for r in _outbox(db)] == ["PAYMENT_RECEIVED", "PAYMENT_RECEIVED"]
    client.post(f"/api/payments/{payment['id']}/approve", headers=admin)  # approving twice sends nothing new
    assert len(_outbox(db)) == 2
    assert member["id"]


def test_admins_see_deliveries_and_can_send_a_test(connected, admin, staff, monkeypatch):
    client, _ = connected

    async def ok(method, url, **kwargs):
        return http.HttpResponse(200, "{}")

    monkeypatch.setattr(http, "request", ok)
    status = client.get("/api/messages", headers=admin).json()
    assert status["whatsapp"] == {"configured": True, "enabled": False} and status["queued"] == 0
    sent = client.post("/api/messages/test", json={"channel": "WHATSAPP", "to": "98765 43210"}, headers=admin).json()
    assert sent == {"ok": True, "message": "Sent to 919876543210."}
    assert client.post("/api/messages/test", json={"channel": "EMAIL", "to": "not-an-email"}, headers=admin).status_code == 422
    assert client.get("/api/messages", headers=staff).status_code == 403
    assert "wa-secret" not in json.dumps(status)


def test_the_minute_job_is_harmless_without_providers(db, config):
    assert asyncio.run(send_messages(db, config)) == {"sent": 0, "failed": 0, "retry": 0}
    assert Clock.frozen is not None
