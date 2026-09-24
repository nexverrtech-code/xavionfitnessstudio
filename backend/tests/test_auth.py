from dataclasses import replace

from conftest import ADMIN_EMAIL, ADMIN_PASSWORD, AUTH_SECRET, ITERATIONS, activate_login, create_member, insert_user, login
from fastapi.testclient import TestClient

from app import create_app
from security.passwords import hash_password_sync, needs_rehash


def test_login_with_email_and_me(client, admin):
    me = client.get("/api/auth/me", headers=admin).json()
    assert me["role"] == "ADMIN" and me["email"] == ADMIN_EMAIL


def test_wrong_password_and_unknown_account_look_the_same(client, admin):
    wrong = client.post("/api/auth/login", json={"identifier": ADMIN_EMAIL, "password": "nope-nope1"})
    unknown = client.post("/api/auth/login", json={"identifier": "ghost@nowhere.io", "password": "nope-nope1"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"] == "Incorrect login or password."


def test_lockout_after_five_failures(client, admin):
    for _ in range(4):
        assert client.post("/api/auth/login", json={"identifier": ADMIN_EMAIL, "password": "Wrong@123"}).status_code == 401
    locked = client.post("/api/auth/login", json={"identifier": ADMIN_EMAIL, "password": "Wrong@123"})
    assert locked.status_code == 429
    # Even the right password is refused while locked.
    assert client.post("/api/auth/login", json={"identifier": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).status_code == 429


def test_member_signs_in_with_member_id_or_phone_and_must_change_temp_password(client, admin):
    created = create_member(client, admin, phone="9876501234")
    creds = created["credentials"]
    assert creds["login"] == created["member"]["member_code"] == "GYM000001"
    temp_headers = login(client, "gym1", creds["temporary_password"])  # flexible member-ID input
    blocked = client.get("/api/me/overview", headers=temp_headers)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    headers = activate_login(client, "9876501234", creds["temporary_password"])  # phone works too
    assert client.get("/api/me/overview", headers=headers).status_code == 200


def test_password_change_revokes_other_sessions(client, admin):
    other_device = login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
    response = client.post("/api/auth/change-password", json={"current_password": ADMIN_PASSWORD, "new_password": "Brand@New2026"},
                           headers=admin)
    assert response.status_code == 200
    assert client.get("/api/auth/me", headers=other_device).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {response.json()['token']}"}).status_code == 200


def test_passwords_are_peppered_and_upgraded_on_login(db, config):
    # Raising PASSWORD_ITERATIONS (e.g. on the Workers Paid plan) upgrades hashes at sign-in.
    stronger = replace(config, password_iterations=ITERATIONS + 200)
    weak = hash_password_sync("Owner@2026x", secret=AUTH_SECRET, iterations=ITERATIONS)
    db.conn.execute("INSERT INTO users (role_id, name, email, password_hash) VALUES (1, 'Owner', 'owner@gym.test', ?)", [weak])
    app = create_app(config_provider=lambda scope: stronger, db_provider=lambda scope, cfg: db)
    with TestClient(app) as client:
        login(client, "owner@gym.test", "Owner@2026x")
    stored = db.conn.execute("SELECT password_hash FROM users WHERE email = 'owner@gym.test'").fetchone()[0]
    assert stored.split("$")[1] == str(ITERATIONS + 200) and not needs_rehash(stored, ITERATIONS + 200)
    # The pepper matters: without the server-side secret the same salt gives a different hash.
    salt = stored.split("$")[2]
    assert hash_password_sync("Owner@2026x", secret="another-secret", iterations=ITERATIONS).split("$")[3] != stored.split("$")[3]
    assert salt


def test_disabled_account_cannot_sign_in(client, admin, db):
    staff_id = insert_user(db, role_id=2, name="Desk Two", phone="9123456780")
    assert client.post(f"/api/users/{staff_id}/status", json={"status": "DISABLED"}, headers=admin).status_code == 200
    response = client.post("/api/auth/login", json={"identifier": "9123456780", "password": ADMIN_PASSWORD})
    assert response.status_code == 403


def test_team_user_creation_requires_email_or_phone(client, admin):
    missing = client.post("/api/users", json={"name": "New Desk", "role": "STAFF"}, headers=admin)
    assert missing.status_code == 422
    created = client.post("/api/users", json={"name": "New Desk", "email": "new@smartgym.test", "role": "STAFF"}, headers=admin)
    assert created.status_code == 201 and created.json()["temporary_password"]


def test_setup_only_when_enabled_and_no_admin(client, db):
    status = client.get("/api/auth/setup-status").json()
    assert status == {"needs_setup": True, "setup_enabled": False}
    response = client.post("/api/auth/setup", json={"setup_token": "whatever-token", "name": "Owner", "email": "owner@gym.test",
                                                   "password": "Owner@2026x"})
    assert response.status_code == 403


def test_api_lives_under_api_prefix(client, admin):
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/v1/auth/me", headers=admin).status_code == 404


def test_unknown_fields_are_rejected(client, admin):
    response = client.post("/api/members", json={"name": "Neha Singh", "phone": "9000000004", "photo_url": "x"}, headers=admin)
    assert response.status_code == 422
