from conftest import create_member, pay


def _member_with_plan(client, admin, plans, **extra):
    member = create_member(client, admin, **extra)["member"]
    pay(client, admin, member["id"], plans["Monthly"])
    payload = client.get(f"/api/members/{member['id']}/qr", headers=admin).json()["payload"]
    return member, payload


def test_qr_scan_marks_attendance_once(client, admin, plans, db):
    member, payload = _member_with_plan(client, admin, plans)
    first = client.post("/api/attendance/scan", json={"code": payload}, headers=admin).json()
    assert first["result"] == "CHECKED_IN" and first["ok"] and first["message"] == "Attendance Marked"
    again = client.post("/api/attendance/scan", json={"code": payload}, headers=admin).json()
    assert again["result"] == "ALREADY_CHECKED_IN"
    rows = db.conn.execute("SELECT attendance_date, method FROM attendance").fetchall()
    assert [tuple(r) for r in rows] == [("2026-09-23", "QR")]


def test_expired_membership_is_refused_with_spec_message(client, admin, plans):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"], start_date="2026-08-01", payment_date="2026-08-01")
    payload = client.get(f"/api/members/{member['id']}/qr", headers=admin).json()["payload"]
    result = client.post("/api/attendance/scan", json={"code": payload}, headers=admin).json()
    assert result["result"] == "EXPIRED" and result["message"] == "Membership Expired. Please renew your membership."


def test_reset_qr_invalidates_old_code_and_forged_codes_fail(client, admin, plans):
    member, payload = _member_with_plan(client, admin, plans)
    client.post(f"/api/members/{member['id']}/qr/reset", headers=admin)
    assert client.post("/api/attendance/scan", json={"code": payload}, headers=admin).json()["result"] == "INVALID"
    assert client.post("/api/attendance/scan", json={"code": "SG1.not-a-real-token-xyz"}, headers=admin).json()["result"] == "INVALID"


def test_manual_check_in_by_member_code_and_member_id(client, admin, plans, db):
    member, _ = _member_with_plan(client, admin, plans)
    by_code = client.post("/api/attendance/scan", json={"code": "gym1"}, headers=admin).json()
    assert by_code["result"] == "CHECKED_IN"
    assert db.conn.execute("SELECT method FROM attendance").fetchone()[0] == "MANUAL"
    second = client.post("/api/attendance", json={"member_id": member["id"]}, headers=admin).json()
    assert second["result"] == "ALREADY_CHECKED_IN"


def test_no_membership_and_suspended(client, admin, plans):
    fresh = create_member(client, admin)["member"]
    payload = client.get(f"/api/members/{fresh['id']}/qr", headers=admin).json()["payload"]
    assert client.post("/api/attendance/scan", json={"code": payload}, headers=admin).json()["result"] == "NO_MEMBERSHIP"
    pay(client, admin, fresh["id"], plans["Monthly"])
    client.post(f"/api/members/{fresh['id']}/status", json={"action": "SUSPEND"}, headers=admin)
    assert client.post("/api/attendance/scan", json={"code": payload}, headers=admin).json()["result"] == "SUSPENDED"


def test_day_log_and_member_history(client, admin, plans):
    member, payload = _member_with_plan(client, admin, plans)
    client.post("/api/attendance/scan", json={"code": payload}, headers=admin)
    log = client.get("/api/attendance", headers=admin).json()
    assert log["total"] == 1 and log["items"][0]["member_name"] == "Aarav Sharma" and log["items"][0]["method"] == "QR"
    history = client.get(f"/api/members/{member['id']}/attendance", params={"month": "2026-09"}, headers=admin).json()
    assert history["count"] == 1
