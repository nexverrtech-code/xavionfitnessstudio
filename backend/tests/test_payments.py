from conftest import create_member, idem, pay

DUPLICATE = "This transaction reference has already been submitted."


def test_cash_payment_activates_membership_with_payment_number(client, admin, plans):
    member = create_member(client, admin)["member"]
    response = pay(client, admin, member["id"], plans["Monthly"])
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["payment"]["payment_number"] == "PAY-2026-000001"
    assert body["payment"]["receipt_number"] == "RCT-2026-000001"
    assert body["payment"]["status"] == "PAID" and body["payment"]["verified_by_name"] == "Admin"
    assert body["membership"]["status"] == "ACTIVE"
    assert (body["membership"]["start_date"], body["membership"]["end_date"]) == ("2026-09-23", "2026-10-22")
    second = pay(client, admin, create_member(client, admin, name="Priya Nair", phone="9876500002")["member"]["id"], plans["Monthly"])
    assert second.json()["payment"]["payment_number"] == "PAY-2026-000002"


def test_idempotent_replay_never_double_charges(client, admin, plans, db):
    member = create_member(client, admin)["member"]
    headers = {**admin, **idem()}
    body = {"member_id": member["id"], "plan_id": plans["Monthly"]["id"], "payment_method": "CASH"}
    first = client.post("/api/payments", json=body, headers=headers)
    again = client.post("/api/payments", json=body, headers=headers)
    assert first.status_code == 201 and again.status_code == 200 and again.json()["replayed"] is True
    assert db.conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0] == 1
    assert db.conn.execute("SELECT COUNT(*) FROM memberships").fetchone()[0] == 1


def test_upi_and_bank_transfer_need_a_reference(client, admin, plans):
    member = create_member(client, admin)["member"]
    assert pay(client, admin, member["id"], plans["Monthly"], method="UPI").status_code == 422
    assert pay(client, admin, member["id"], plans["Monthly"], method="BANK_TRANSFER").status_code == 422
    ok = pay(client, admin, member["id"], plans["Monthly"], method="UPI", transaction_reference="4123 4567 8901")
    assert ok.status_code == 201 and ok.json()["payment"]["transaction_reference"] == "412345678901"


def test_duplicate_utr_is_refused_with_clear_message(client, admin, plans, upi_enabled, member_session):
    other = create_member(client, admin, name="Priya Nair", phone="9876500002")["member"]
    pay(client, admin, other["id"], plans["Monthly"], method="UPI", transaction_reference="412345678901")
    _, headers = member_session
    response = client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"], "utr": "412345678901"}, headers=headers)
    assert response.status_code == 409 and response.json()["error"]["message"] == DUPLICATE
    desk = pay(client, admin, other["id"], plans["Monthly"], method="UPI", transaction_reference="412345678901")
    assert desk.status_code == 409 and desk.json()["error"]["message"] == DUPLICATE


def test_utr_submission_stays_pending_until_verified(client, admin, plans, upi_enabled, member_session, db):
    member, headers = member_session
    response = client.post("/api/me/renewals", json={"plan_id": plans["Quarterly"]["id"], "utr": "4123 4567 8901"}, headers=headers)
    assert response.status_code == 201, response.text
    payment = response.json()["payment"]
    assert payment["status"] == "PENDING" and payment["membership_id"] is None and payment["payment_number"] == "PAY-2026-000001"
    # Entering a UTR never activates anything by itself.
    assert db.conn.execute("SELECT COUNT(*) FROM memberships").fetchone()[0] == 0
    workspace = client.get(f"/api/members/{member['id']}", headers=admin).json()
    assert workspace["membership"]["status"] == "NONE" and workspace["pending_payment"]["transaction_reference"] == "412345678901"
    # One pending submission at a time.
    again = client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"], "utr": "999988887777"}, headers=headers)
    assert again.status_code == 409


def test_approve_activates_once_and_notifies(client, admin, plans, upi_enabled, member_session, db):
    member, headers = member_session
    payment = client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"], "utr": "412345678901"}, headers=headers).json()["payment"]
    first = client.post(f"/api/payments/{payment['id']}/approve", headers=admin)
    assert first.status_code == 200 and first.json()["payment"]["status"] == "PAID"
    assert first.json()["membership"]["start_date"] == "2026-09-23"
    second = client.post(f"/api/payments/{payment['id']}/approve", headers=admin)
    assert second.json()["already_processed"] is True
    rows = db.conn.execute("SELECT start_date, end_date, status FROM memberships WHERE member_id = ?", [member["id"]]).fetchall()
    assert [tuple(r) for r in rows] == [("2026-09-23", "2026-10-22", "ACTIVE")]  # never extended twice
    inbox = client.get("/api/notifications/inbox", headers=headers).json()
    kinds = {n["type"] for n in inbox["items"]}
    assert {"PAYMENT_RECEIVED", "MEMBERSHIP_ACTIVATED"} <= kinds and inbox["unread"] >= 2


def test_reject_keeps_membership_inactive(client, admin, plans, upi_enabled, member_session, db):
    member, headers = member_session
    payment = client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"], "utr": "412345678901"}, headers=headers).json()["payment"]
    rejected = client.post(f"/api/payments/{payment['id']}/reject", json={"reason": "UTR not found in bank statement"}, headers=admin)
    assert rejected.status_code == 200 and rejected.json()["payment"]["status"] == "REJECTED"
    assert db.conn.execute("SELECT COUNT(*) FROM memberships").fetchone()[0] == 0
    assert client.post(f"/api/payments/{payment['id']}/approve", headers=admin).status_code == 409
    # A rejected UTR may be resubmitted (e.g. the member picked the wrong plan).
    again = client.post("/api/me/renewals", json={"plan_id": plans["Quarterly"]["id"], "utr": "412345678901"}, headers=headers)
    assert again.status_code == 201


def test_member_can_withdraw_own_pending_payment(client, plans, upi_enabled, member_session):
    _, headers = member_session
    client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"], "utr": "412345678901"}, headers=headers)
    assert client.delete("/api/me/renewals/pending", headers=headers).status_code == 204
    assert client.get("/api/me/renewals/pending", headers=headers).json()["payment"] is None


def test_refund_is_recorded_only_and_can_cancel_membership(client, admin, plans, db):
    member = create_member(client, admin)["member"]
    payment = pay(client, admin, member["id"], plans["Monthly"]).json()["payment"]
    too_much = client.post(f"/api/payments/{payment['id']}/refund",
                           json={"amount": 999999, "refund_method": "CASH", "refund_reason": "Moved city"}, headers=admin)
    assert too_much.status_code == 422
    response = client.post(f"/api/payments/{payment['id']}/refund",
                           json={"refund_method": "UPI", "refund_reference": "REF-9912", "refund_reason": "Moved city"}, headers=admin)
    assert response.status_code == 200, response.text
    refunded = response.json()["payment"]
    assert refunded["status"] == "REFUNDED" and refunded["refund"]["amount"] == 150000
    assert db.conn.execute("SELECT status FROM memberships").fetchone()[0] == "CANCELLED"
    assert db.conn.execute("SELECT status FROM members WHERE id = ?", [member["id"]]).fetchone()[0] == "INACTIVE"
    assert client.post(f"/api/payments/{payment['id']}/refund", json={"refund_method": "CASH", "refund_reason": "Again"},
                       headers=admin).status_code == 409


def test_paid_payments_are_immutable(client, admin, plans, db):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"])
    try:
        db.conn.execute("UPDATE payments SET amount = 1")
        raise AssertionError("update should be blocked")
    except Exception as exc:
        assert "immutable" in str(exc)


def test_history_filters_today_week_month_custom(client, admin, plans):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"], payment_date="2026-09-01")
    pay(client, admin, member["id"], plans["Quarterly"], payment_date="2026-09-23")
    history = lambda **p: client.get(f"/api/members/{member['id']}/payments", params=p, headers=admin).json()  # noqa: E731
    assert history(period="today")["total"] == 1
    assert history(period="week")["total"] == 1  # week starts Monday 21 Sep
    assert history(period="month")["total"] == 2
    assert history(**{"period": "custom", "from": "2026-09-01", "to": "2026-09-02"})["total"] == 1


def test_receipt_data_for_paid_payment(client, admin, plans, member_session):
    member, headers = member_session
    payment = pay(client, admin, member["id"], plans["Monthly"]).json()["payment"]
    receipt = client.get(f"/api/me/payments/{payment['id']}/receipt", headers=headers).json()
    assert receipt["receipt_number"] == "RCT-2026-000001" and receipt["member_code"] == "GYM000001"
    assert receipt["membership_start"] == "2026-09-23" and receipt["status"] == "PAID"
    other = create_member(client, admin, name="Priya Nair", phone="9876500002")["member"]
    other_payment = pay(client, admin, other["id"], plans["Monthly"]).json()["payment"]
    assert client.get(f"/api/me/payments/{other_payment['id']}/receipt", headers=headers).status_code == 404
