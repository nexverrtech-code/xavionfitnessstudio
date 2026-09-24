from conftest import create_member, pay


def test_member_codes_are_sequential(client, admin):
    first = create_member(client, admin, phone="9876500001")
    second = create_member(client, admin, name="Priya Nair", phone="9876500002", create_app_login=False)
    assert first["member"]["member_code"] == "GYM000001"
    assert second["member"]["member_code"] == "GYM000002"
    assert second["credentials"] is None
    # New members have no membership yet.
    assert first["member"]["status"] == "INACTIVE" and first["member"]["membership"]["status"] == "NONE"


def test_duplicate_member_is_refused(client, admin):
    create_member(client, admin)
    response = client.post("/api/members", json={"name": "Aarav Sharma", "phone": "9876543210"}, headers=admin)
    assert response.status_code == 409


def test_search_by_code_phone_name_and_email(client, admin):
    create_member(client, admin, name="Aarav Sharma", phone="9876500001", email="aarav@example.com")
    create_member(client, admin, name="Priya Nair", phone="9876500002")
    assert [m["name"] for m in client.get("/api/members/search", params={"q": "gym2"}, headers=admin).json()["items"]] == ["Priya Nair"]
    assert len(client.get("/api/members/search", params={"q": "98765"}, headers=admin).json()["items"]) == 2
    assert client.get("/api/members/search", params={"q": "aar"}, headers=admin).json()["items"][0]["member_code"] == "GYM000001"
    assert client.get("/api/members/search", params={"q": "sharma"}, headers=admin).json()["items"][0]["name"] == "Aarav Sharma"
    assert client.get("/api/members/search", params={"q": "aarav@ex"}, headers=admin).json()["items"][0]["name"] == "Aarav Sharma"


def test_list_is_paginated_and_filtered_by_status(client, admin, plans):
    for i in range(25):
        create_member(client, admin, name=f"Member {i:02d}", phone=f"90000001{i:02d}", create_app_login=False)
    page = client.get("/api/members", params={"page": 2, "limit": 20}, headers=admin).json()
    assert page["total"] == 25 and page["pages"] == 2 and len(page["items"]) == 5
    assert client.get("/api/members", params={"limit": 500}, headers=admin).status_code == 422
    pay(client, admin, 1, plans["Monthly"])
    active = client.get("/api/members", params={"status": "ACTIVE"}, headers=admin).json()
    assert active["total"] == 1 and active["items"][0]["membership"]["plan_name"] == "Monthly"
    inactive = client.get("/api/members", params={"status": "INACTIVE"}, headers=admin).json()
    assert inactive["total"] == 24


def test_expiring_filter_uses_computed_coverage(client, admin, db, plans):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"], start_date="2026-08-30")  # ends 28 Sep -> 5 days left
    expiring = client.get("/api/members", params={"status": "EXPIRING"}, headers=admin).json()
    assert expiring["total"] == 1 and expiring["items"][0]["membership"]["status"] == "EXPIRING"
    assert expiring["items"][0]["membership"]["days_left"] == 5


def test_suspend_and_reactivate(client, admin, plans):
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"])
    assert client.post(f"/api/members/{member['id']}/status", json={"action": "SUSPEND"}, headers=admin).json()["status"] == "SUSPENDED"
    assert client.post(f"/api/members/{member['id']}/status", json={"action": "REACTIVATE"}, headers=admin).json()["status"] == "ACTIVE"
    assert client.post(f"/api/members/{member['id']}/status", json={"action": "DEACTIVATE"}, headers=admin).json()["status"] == "INACTIVE"


def test_members_are_never_deleted(client, admin, db):
    create_member(client, admin)
    try:
        db.conn.execute("DELETE FROM members WHERE id = 1")
        raise AssertionError("delete should be blocked")
    except Exception as exc:  # sqlite3.IntegrityError from the guard trigger
        assert "cannot be deleted" in str(exc)


def test_no_photo_or_file_columns_exist(db):
    columns = {row[1] for table in ("members", "trainers", "users") for row in db.conn.execute(f"PRAGMA table_info({table})")}
    assert not {c for c in columns if any(word in c for word in ("photo", "avatar", "image", "document", "url"))}


def test_qr_is_opaque_and_can_be_reset(client, admin):
    member = create_member(client, admin)["member"]
    qr = client.get(f"/api/members/{member['id']}/qr", headers=admin).json()
    assert qr["payload"].startswith("SG1.")
    token = qr["payload"][4:]
    assert member["member_code"] not in qr["payload"] and str(member["id"]) != token and "9876543210" not in qr["payload"]
    reset = client.post(f"/api/members/{member['id']}/qr/reset", headers=admin).json()
    assert reset["payload"] != qr["payload"]
