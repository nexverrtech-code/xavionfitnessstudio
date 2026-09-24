"""Member app access (given, reset and turned off by staff) and gym settings shown everywhere."""

from conftest import create_member, login

from services import settings_service


def _no_login_member(client, admin, **extra):
    return create_member(client, admin, create_app_login=False, **extra)["member"]


def _sign_in(client, identifier, password):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password})


def test_member_cannot_sign_in_until_staff_give_access(client, admin):
    member = _no_login_member(client, admin)
    assert member["app"] == {"enabled": False, "login": None, "last_login_at": None, "must_change_password": False}
    assert _sign_in(client, member["member_code"], "Anything@123").status_code == 401

    access = client.post(f"/api/members/{member['id']}/app-access", json={}, headers=admin)
    assert access.status_code == 200, access.text
    body = access.json()
    assert body["login"] == member["member_code"] and body["temporary_password"] and body["must_change_password"] is True
    signed_in = _sign_in(client, member["member_code"], body["temporary_password"])
    assert signed_in.status_code == 200 and signed_in.json()["user"]["must_change_password"] is True


def test_staff_can_set_the_members_password(client, admin, staff):
    member = _no_login_member(client, admin)
    response = client.post(
        f"/api/members/{member['id']}/app-access", json={"password": "Strong#Pass9", "must_change_password": False}, headers=staff
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"login": member["member_code"], "temporary_password": None, "must_change_password": False}

    # Member ID, phone number and email all work; no forced change, the member app opens directly.
    for identifier in (member["member_code"], member["phone"]):
        signed_in = _sign_in(client, identifier, "Strong#Pass9")
        assert signed_in.status_code == 200, signed_in.text
        assert signed_in.json()["user"]["must_change_password"] is False
    headers = login(client, member["member_code"], "Strong#Pass9")
    assert client.get("/api/me/overview", headers=headers).status_code == 200
    workspace = client.get(f"/api/members/{member['id']}", headers=admin).json()
    assert workspace["app"]["enabled"] is True and workspace["app"]["must_change_password"] is False


def test_staff_password_can_require_a_change_at_first_sign_in(client, admin):
    member = _no_login_member(client, admin)
    client.post(f"/api/members/{member['id']}/app-access", json={"password": "Strong#Pass9", "must_change_password": True}, headers=admin)
    assert _sign_in(client, member["member_code"], "Strong#Pass9").json()["user"]["must_change_password"] is True


def test_weak_staff_password_is_refused(client, admin):
    member = _no_login_member(client, admin)
    response = client.post(f"/api/members/{member['id']}/app-access", json={"password": "12345678"}, headers=admin)
    assert response.status_code == 422 and "password" in response.json()["error"]["fields"]
    assert client.get(f"/api/members/{member['id']}", headers=admin).json()["app"]["login"] is None


def test_generated_passwords_are_always_one_time(client, admin):
    member = _no_login_member(client, admin)
    body = client.post(f"/api/members/{member['id']}/app-access", json={"must_change_password": False}, headers=admin).json()
    assert body["must_change_password"] is True
    assert _sign_in(client, member["member_code"], body["temporary_password"]).json()["user"]["must_change_password"] is True


def test_turning_access_off_and_on_again(client, admin):
    member = _no_login_member(client, admin)
    client.post(f"/api/members/{member['id']}/app-access", json={"password": "Strong#Pass9", "must_change_password": False}, headers=admin)
    headers = login(client, member["member_code"], "Strong#Pass9")

    assert client.delete(f"/api/members/{member['id']}/app-access", headers=admin).status_code == 204
    workspace = client.get(f"/api/members/{member['id']}", headers=admin).json()
    assert workspace["app"]["enabled"] is False and workspace["app"]["login"] == member["member_code"]  # turned off, not deleted
    assert _sign_in(client, member["member_code"], "Strong#Pass9").status_code == 403
    assert client.get("/api/me/overview", headers=headers).status_code == 401  # old sessions end

    client.post(f"/api/members/{member['id']}/app-access", json={"password": "Another#Pass7", "must_change_password": False}, headers=admin)
    assert _sign_in(client, member["member_code"], "Strong#Pass9").status_code == 401
    assert _sign_in(client, member["member_code"], "Another#Pass7").status_code == 200


def test_new_gym_name_shows_everywhere_at_once(client, admin, db):
    assert client.put("/api/settings", json={"gym_name": "Xavion Fitness Studio"}, headers=admin).status_code == 200
    assert client.get("/api/config").json()["gym_name"] == "Xavion Fitness Studio"
    assert "max-age" not in client.get("/api/config").headers.get("cache-control", "")  # browsers never keep an old name

    # Another Worker isolate may still hold the old settings in its short cache: the public
    # profile, the manifest and the Settings screen read fresh anyway.
    settings_service._cache.set("settings", {**(client.get("/api/settings", headers=admin).json()), "gym_name": "Old Name"})
    db.conn.execute("UPDATE settings SET value = 'Xavion Fitness' WHERE key = 'gym_name'")
    assert client.get("/api/config").json()["gym_name"] == "Xavion Fitness"
    assert client.get("/api/settings", headers=admin).json()["gym_name"] == "Xavion Fitness"

    manifest = client.get("/api/manifest.webmanifest")
    assert manifest.status_code == 200 and manifest.headers["content-type"].startswith("application/manifest+json")
    assert manifest.json()["name"] == "Xavion Fitness" and manifest.json()["short_name"] == "Xavion"


def test_backup_files_are_named_after_the_gym(client, admin):
    client.put("/api/settings", json={"gym_name": "Xavion Fitness Studio"}, headers=admin)
    created = client.post("/api/backups", json={"datasets": ["attendance"], "period_from": "2025-01-01", "period_to": "2025-12-31"}, headers=admin)
    assert created.status_code == 201, created.text
    assert created.json()["backup"]["file_name"] == "Xavion_Fitness_Studio_Backup_2025.zip"


def test_upi_details_never_use_an_old_upi_id(client, admin, plans, upi_enabled, db):
    member = _no_login_member(client, admin)
    first = client.get(f"/api/payments/upi?member_id={member['id']}&plan_id={plans['Monthly']['id']}", headers=admin).json()
    assert first["vpa"] == "smartgym@upi"
    # Changed by an admin on another Worker isolate while this one still caches the old settings.
    db.conn.execute("UPDATE settings SET value = 'xavion@okaxis' WHERE key = 'upi_id'")
    second = client.get(f"/api/payments/upi?member_id={member['id']}&plan_id={plans['Monthly']['id']}", headers=admin).json()
    assert second["vpa"] == "xavion@okaxis" and "pa=xavion@okaxis" in second["uri"]
