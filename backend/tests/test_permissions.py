from conftest import activate_login, create_member, pay


def _trainer_session(client, admin):
    trainer = client.post("/api/trainers", json={"name": "Arjun Menon", "phone": "9845000001", "email": "arjun@gym.test"},
                          headers=admin).json()
    creds = client.post(f"/api/trainers/{trainer['id']}/account", headers=admin).json()
    headers = activate_login(client, creds["login"], creds["temporary_password"])
    return trainer, headers


def test_staff_cannot_touch_admin_areas(client, admin, staff, plans):
    for method, path in (
        ("get", "/api/settings"), ("get", "/api/users"), ("get", "/api/expenses"), ("get", "/api/backups"),
        ("get", "/api/storage"), ("post", "/api/storage/refresh"), ("get", "/api/reports/expenses"),
    ):
        assert getattr(client, method)(path, headers=staff).status_code == 403, path
    member = create_member(client, staff)["member"]
    payment = pay(client, staff, member["id"], plans["Monthly"]).json()["payment"]
    refund = client.post(f"/api/payments/{payment['id']}/refund", json={"refund_method": "CASH", "refund_reason": "Test"}, headers=staff)
    assert refund.status_code == 403
    assert client.get("/api/reports/payments", headers=staff).status_code == 200


def test_trainer_sees_only_assigned_members_and_no_finance(client, admin, plans):
    trainer, headers = _trainer_session(client, admin)
    mine = create_member(client, admin, trainer_id=trainer["id"])["member"]
    other = create_member(client, admin, name="Priya Nair", phone="9876500002")["member"]
    listed = client.get("/api/members", headers=headers).json()
    assert [m["id"] for m in listed["items"]] == [mine["id"]]
    assert client.get(f"/api/members/{other['id']}", headers=headers).status_code == 404
    workspace = client.get(f"/api/members/{mine['id']}", headers=headers).json()
    assert "total_paid" not in workspace["stats"] and workspace["pending_payment"] is None
    for path in ("/api/payments", "/api/payments/pending", f"/api/members/{mine['id']}/payments", "/api/dashboard/summary",
                 "/api/reports/payments"):
        assert client.get(path, headers=headers).status_code == 403, path
    assert client.get("/api/dashboard/trainer", headers=headers).status_code == 200
    created = client.post("/api/workouts", json={"member_id": mine["id"], "title": "Chest + Triceps",
                                                 "exercises": [{"exercise_name": "Bench Press", "sets": 4, "reps": "10"}]}, headers=headers)
    assert created.status_code == 201
    denied = client.post("/api/workouts", json={"member_id": other["id"], "title": "Legs",
                                                "exercises": [{"exercise_name": "Squat"}]}, headers=headers)
    assert denied.status_code == 404
    assert client.post(f"/api/progress/{mine['id']}", json={"weight": 80.5}, headers=headers).status_code == 201
    assert client.post(f"/api/progress/{other['id']}", json={"weight": 70}, headers=headers).status_code == 404


def test_member_only_reaches_own_data(client, admin, plans, member_session):
    member, headers = member_session
    other = create_member(client, admin, name="Priya Nair", phone="9876500002")["member"]
    for path in (f"/api/members/{other['id']}", "/api/members", "/api/payments", "/api/attendance", f"/api/progress/{member['id']}"):
        assert client.get(path, headers=headers).status_code in (403, 404), path
    assert client.get("/api/me/overview", headers=headers).json()["member"]["id"] == member["id"]
    assert client.get("/api/me/qr", headers=headers).json()["payload"].startswith("SG1.")


def test_staff_cannot_manage_workouts_or_progress(client, staff, plans):
    member = create_member(client, staff)["member"]
    assert client.post("/api/workouts", json={"member_id": member["id"], "title": "Plan", "exercises": [{"exercise_name": "Row"}]},
                       headers=staff).status_code == 403
    assert client.get(f"/api/progress/{member['id']}", headers=staff).status_code == 403
