"""Several visits a day: scans alternate check-in / check-out; days present are counted once."""

import asyncio
from datetime import datetime, timedelta, timezone

from conftest import activate_login, create_member, pay

from core.clock import Clock
from repositories.attendance import AttendanceRepository

IST_OFFSET_MINUTES = 330


def at(day: int, hour: int, minute: int = 0) -> None:
    """Freeze the clock at a local (IST) time in September 2026."""
    utc_minutes = hour * 60 + minute - IST_OFFSET_MINUTES
    Clock.frozen = datetime(2026, 9, day, tzinfo=timezone.utc) + timedelta(minutes=utc_minutes)


def _member(client, admin, plans, **extra):
    member = create_member(client, admin, **extra)["member"]
    pay(client, admin, member["id"], plans["Monthly"])
    return member, client.get(f"/api/members/{member['id']}/qr", headers=admin).json()["payload"]


def scan(client, headers, payload):
    response = client.post("/api/attendance/scan", json={"code": payload}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_morning_afternoon_and_night_visits(client, admin, plans, db):
    member, payload = _member(client, admin, plans)
    timeline = [((6, 0), "CHECKED_IN"), ((7, 15), "CHECKED_OUT"), ((13, 0), "CHECKED_IN"), ((14, 5), "CHECKED_OUT"),
                ((19, 0), "CHECKED_IN"), ((20, 30), "CHECKED_OUT")]
    for (hour, minute), expected in timeline:
        at(23, hour, minute)
        result = scan(client, admin, payload)
        assert result["result"] == expected and result["ok"], result
    assert result["minutes"] == 90 and result["visits_today"] == 3

    rows = db.conn.execute("SELECT attendance_date, check_in, check_out FROM attendance ORDER BY check_in").fetchall()
    assert [tuple(r) for r in rows] == [
        ("2026-09-23", "2026-09-23 00:30:00", "2026-09-23 01:45:00"),
        ("2026-09-23", "2026-09-23 07:30:00", "2026-09-23 08:35:00"),
        ("2026-09-23", "2026-09-23 13:30:00", "2026-09-23 15:00:00"),
    ]

    log = client.get("/api/attendance", params={"date": "2026-09-23"}, headers=admin).json()
    assert (log["total"], log["members"], log["visits"], log["in_gym"], log["checked_out"]) == (1, 1, 3, 0, 3)
    row = log["items"][0]
    assert row["visit_count"] == 3 and row["minutes"] == 75 + 65 + 90 and row["in_gym"] is False
    assert [v["check_in"] for v in row["visits"]] == ["2026-09-23T00:30:00Z", "2026-09-23T07:30:00Z", "2026-09-23T13:30:00Z"]
    assert row["check_in"] == "2026-09-23T00:30:00Z" and row["check_out"] == "2026-09-23T15:00:00Z"

    history = client.get(f"/api/members/{member['id']}/attendance", params={"month": "2026-09"}, headers=admin).json()
    assert (history["days"], history["visits"], history["count"]) == (1, 3, 1)
    assert len(history["items"][0]["visits"]) == 3

    # Counted once a day everywhere.
    workspace = client.get(f"/api/members/{member['id']}", headers=admin).json()
    assert workspace["stats"]["visits_this_month"] == 1 and workspace["stats"]["visits_total"] == 1
    summary = client.get("/api/dashboard/summary", headers=admin).json()["attendance"]
    assert summary == {"today": 1, "yesterday": 0, "visits_today": 3, "in_gym": 0}
    trend = client.get("/api/attendance/trend", params={"days": 7}, headers=admin).json()["items"]
    assert trend[-1] == {"date": "2026-09-23", "members": 1, "visits": 3}


def test_duplicate_scans_change_nothing(client, admin, plans, db):
    _, payload = _member(client, admin, plans)
    at(23, 7, 0)
    assert scan(client, admin, payload)["result"] == "CHECKED_IN"
    at(23, 7, 4)  # a second scan within the 10-minute cooldown
    again = scan(client, admin, payload)
    assert again["result"] == "ALREADY_CHECKED_IN" and again["time"] == "2026-09-23T01:30:00Z"
    at(23, 8, 30)
    assert scan(client, admin, payload)["result"] == "CHECKED_OUT"
    at(23, 8, 33)  # scanned twice on the way out
    assert scan(client, admin, payload)["result"] == "ALREADY_CHECKED_OUT"
    assert db.conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] == 1


def test_forgotten_check_out_starts_a_new_visit(client, admin, plans, db):
    _, payload = _member(client, admin, plans)
    at(23, 7, 0)
    scan(client, admin, payload)
    at(23, 12, 0)  # 5 hours later: past the 4-hour longest visit, so this is a new arrival
    result = scan(client, admin, payload)
    assert result["result"] == "CHECKED_IN" and result["visit_number"] == 2
    log = client.get("/api/attendance", headers=admin).json()
    first, second = log["items"][0]["visits"]
    assert first["check_out"] is None and first["open"] is False  # shown as "no check-out"
    assert second["open"] is True and log["in_gym"] == 1


def test_daily_visit_limit(client, admin, plans, db):
    client.put("/api/settings", json={"attendance_max_visits_per_day": 2}, headers=admin)
    _, payload = _member(client, admin, plans)
    for hour, expected in ((6, "CHECKED_IN"), (7, "CHECKED_OUT"), (12, "CHECKED_IN"), (13, "CHECKED_OUT")):
        at(23, hour)
        assert scan(client, admin, payload)["result"] == expected
    at(23, 19)
    refused = scan(client, admin, payload)
    assert refused["result"] == "LIMIT" and refused["ok"] is False and "2 visits a day" in refused["message"]
    assert db.conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] == 2


def test_entries_only_mode_records_each_arrival(client, admin, plans, db):
    client.put("/api/settings", json={"attendance_checkout": False}, headers=admin)
    _, payload = _member(client, admin, plans)
    at(23, 6)
    assert scan(client, admin, payload)["result"] == "CHECKED_IN"
    at(23, 6, 5)
    assert scan(client, admin, payload)["result"] == "ALREADY_CHECKED_IN"
    at(23, 18)
    assert scan(client, admin, payload)["result"] == "CHECKED_IN"
    assert tuple(db.conn.execute("SELECT COUNT(*), COUNT(check_out) FROM attendance").fetchone()) == (2, 0)
    log = client.get("/api/attendance", headers=admin).json()
    assert log["in_gym"] is None and log["checkout"] is False
    assert client.get("/api/dashboard/summary", headers=admin).json()["attendance"]["in_gym"] is None


def test_front_desk_check_in_and_check_out_buttons(client, admin, plans):
    member, _ = _member(client, admin, plans)
    mark = lambda action=None: client.post("/api/attendance", json={"member_id": member["id"], "action": action}, headers=admin).json()  # noqa: E731
    at(23, 9)
    assert mark("OUT")["result"] == "NOT_CHECKED_IN"
    assert mark("IN")["result"] == "CHECKED_IN"
    assert mark("IN")["result"] == "ALREADY_CHECKED_IN"  # "Check in" never checks a member out
    at(23, 9, 2)
    out = mark("OUT")  # staff may end a visit straight away (no duplicate-scan wait)
    assert out["result"] == "CHECKED_OUT" and out["minutes"] == 2
    assert client.post("/api/attendance", json={"member_id": member["id"], "action": "LEAVE"}, headers=admin).status_code == 422


def test_leaving_is_allowed_after_a_suspension(client, admin, plans):
    member, payload = _member(client, admin, plans)
    at(23, 9)
    scan(client, admin, payload)
    client.post(f"/api/members/{member['id']}/status", json={"action": "SUSPEND"}, headers=admin)
    at(23, 10)
    assert scan(client, admin, payload)["result"] == "CHECKED_OUT"
    at(23, 17)
    assert scan(client, admin, payload)["result"] == "SUSPENDED"


def test_a_late_night_visit_ends_after_midnight(client, admin, plans, db):
    _, payload = _member(client, admin, plans)
    at(23, 23, 15)
    scan(client, admin, payload)
    at(24, 0, 40)
    result = scan(client, admin, payload)
    assert result["result"] == "CHECKED_OUT" and result["minutes"] == 85
    assert [tuple(r) for r in db.conn.execute("SELECT attendance_date, check_out FROM attendance")] == [
        ("2026-09-23", "2026-09-23 19:10:00")
    ]
    at(24, 7)
    assert scan(client, admin, payload)["result"] == "CHECKED_IN"
    assert db.conn.execute("SELECT attendance_date FROM attendance ORDER BY id DESC").fetchone()[0] == "2026-09-24"


def test_two_desks_scanning_at_once_record_one_visit(client, admin, plans, db, monkeypatch):
    """Both desks read the member before either writes: the atomic insert / update lets one win."""
    member, payload = _member(client, admin, plans)
    real_lookup = AttendanceRepository.members_for_check_in
    snapshot: dict = {}

    async def stale_lookup(self, *args):
        if "rows" not in snapshot:
            snapshot["rows"] = await real_lookup(self, *args)
        return snapshot["rows"]

    monkeypatch.setattr(AttendanceRepository, "members_for_check_in", stale_lookup)
    at(23, 7)
    results = [scan(client, admin, payload)["result"] for _ in range(2)]
    assert results == ["CHECKED_IN", "ALREADY_CHECKED_IN"]
    assert db.conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] == 1

    snapshot.clear()
    at(23, 8, 30)
    results = [scan(client, admin, payload)["result"] for _ in range(2)]
    assert results == ["CHECKED_OUT", "ALREADY_CHECKED_OUT"]
    assert db.conn.execute("SELECT check_out FROM attendance").fetchone()[0] == "2026-09-23 03:00:00"


def test_the_insert_itself_refuses_a_second_open_visit(db):
    """The guard lives in the INSERT statement, not only in Python."""
    db.conn.execute("INSERT INTO members (id, member_code, name, phone, joining_date, qr_token) "
                    "VALUES (1, 'GYM000001', 'Asha', '9876543210', '2026-09-01', 'token-0123456789abcdef')")
    repo = AttendanceRepository(db)
    args = dict(today="2026-09-23", yesterday="2026-09-22", method="QR", recent_after="2026-09-23 01:20:00",
                open_after="2026-09-22 21:30:00", daily_limit=5)
    first, _ = asyncio.run(repo.start_visit(1, now="2026-09-23 01:30:00", **args))
    second, latest = asyncio.run(repo.start_visit(1, now="2026-09-23 01:30:01", **args))
    assert len(first.rows) == 1 and second.rows == [] and latest.first["visits_today"] == 1


def test_member_app_shows_days_and_the_current_visit(client, admin, plans, member_session):
    member, headers = member_session
    pay(client, admin, member["id"], plans["Monthly"])
    payload = client.get(f"/api/members/{member['id']}/qr", headers=admin).json()["payload"]
    at(23, 6)
    scan(client, admin, payload)
    at(23, 7)
    scan(client, admin, payload)
    at(23, 18)
    scan(client, admin, payload)
    overview = client.get("/api/me/overview", headers=headers).json()["attendance"]
    assert overview["this_month"] == 1 and overview["visits_today"] == 2 and overview["checked_in_today"] is True
    assert overview["inside_since"] == "2026-09-23T12:30:00Z"
    mine = client.get("/api/me/attendance", params={"month": "2026-09"}, headers=headers).json()
    assert mine["days"] == 1 and mine["visits"] == 2


def test_reports_count_members_present_once_a_day(client, admin, plans):
    _, payload = _member(client, admin, plans)
    for hour in (6, 7, 18, 19):
        at(23, hour)
        scan(client, admin, payload)
    report = client.get("/api/reports/attendance", params={"from": "2026-09-01", "to": "2026-09-30"}, headers=admin).json()
    summary = report["summary"]
    assert (summary["total_visits"], summary["member_days"], summary["unique_members"]) == (2, 1, 1)
    assert summary["daily"] == [{"date": "2026-09-23", "members": 1, "visits": 2}]
    assert [row["minutes"] for row in report["rows"]] == [60, 60]


def test_visit_settings_are_validated(client, admin):
    too_long = client.put("/api/settings", json={"attendance_cooldown_minutes": 240, "attendance_max_visit_hours": 2}, headers=admin)
    assert too_long.status_code == 422 and "attendance_cooldown_minutes" in too_long.json()["error"]["fields"]
    assert client.put("/api/settings", json={"attendance_max_visits_per_day": 21}, headers=admin).status_code == 422
    saved = client.put("/api/settings", json={"attendance_max_visit_hours": 6, "attendance_max_visits_per_day": 3}, headers=admin).json()
    assert saved["attendance_max_visit_hours"] == 6 and saved["attendance_max_visits_per_day"] == 3 and saved["attendance_checkout"] is True


def test_before_the_database_update_a_second_visit_is_refused_clearly(client, admin, plans, db):
    db.conn.execute("CREATE UNIQUE INDEX ux_attendance_member_day ON attendance (member_id, attendance_date)")  # the old rule
    _, payload = _member(client, admin, plans)
    at(23, 6)
    scan(client, admin, payload)
    at(23, 7)
    assert scan(client, admin, payload)["result"] == "CHECKED_OUT"
    at(23, 18)
    refused = scan(client, admin, payload)
    assert refused["result"] == "LIMIT" and "database update" in refused["message"]


def test_trainer_week_counts_member_days(client, admin, plans, db):
    trainer = client.post("/api/trainers", json={"name": "Coach", "phone": "9123456780", "email": "coach@gym.test"}, headers=admin).json()
    _, payload = _member(client, admin, plans, phone="9000000001", trainer_id=trainer["id"])
    for hour in (6, 7, 18):
        at(23, hour)
        scan(client, admin, payload)
    creds = client.post(f"/api/trainers/{trainer['id']}/account", headers=admin).json()
    headers = activate_login(client, creds["login"], creds["temporary_password"])
    overview = client.get("/api/dashboard/trainer", headers=headers).json()
    assert overview["week_attendance"] == 1 and len(overview["today_sessions"]) == 2
