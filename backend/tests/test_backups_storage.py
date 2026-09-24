import hashlib
import json

from conftest import create_member, pay


def _seed_old_history(client, admin, plans, db):
    """A member with a membership + payment + attendance in June 2026 (old enough to archive)."""
    member = create_member(client, admin)["member"]
    pay(client, admin, member["id"], plans["Monthly"], start_date="2026-07-26", payment_date="2026-07-26")
    db.conn.execute(
        "INSERT INTO attendance (member_id, attendance_date, check_in, method) VALUES (?, '2026-06-10', '2026-06-10 01:00:00', 'QR')",
        [member["id"]],
    )
    db.conn.execute("INSERT INTO expenses (category, amount, expense_date) VALUES ('RENT', 4500000, '2026-06-05')")
    return member


def _download(client, admin, manifest):
    files: dict[str, list[dict]] = {}
    for table in manifest["tables"]:
        rows, after = [], 0
        while True:
            page = client.get(f"/api/backups/{manifest['backup']['id']}/data", params={"table": table["table"], "after": after},
                              headers=admin).json()
            rows += page
            if len(page) < 1000:
                break
            after = page[-1]["id"]
        files[table["table"]] = rows
    return files


def _verify(client, admin, manifest, files, *, drop: str | None = None):
    counts = {name: len(rows) - (1 if name == drop and rows else 0) for name, rows in files.items()}
    checksum = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return client.post(f"/api/backups/{manifest['backup']['id']}/verify",
                       json={"file_name": manifest["backup"]["file_name"], "checksum": checksum, "counts": counts}, headers=admin)


def test_backup_verify_archive_then_restore(client, admin, plans, db):
    _seed_old_history(client, admin, plans, db)
    created = client.post("/api/backups", json={"datasets": ["attendance", "payments", "memberships", "expenses"],
                                                "period_from": "2026-06-01", "period_to": "2026-07-01"}, headers=admin)
    assert created.status_code == 201, created.text
    manifest = created.json()
    assert manifest["backup"]["status"] == "CREATED" and manifest["backup"]["file_name"].startswith("SmartGym_Backup_2026-06-01")
    assert {t["table"] for t in manifest["tables"]} >= {"members", "attendance", "payments", "refunds", "memberships", "expenses"}
    files = _download(client, admin, manifest)
    assert len(files["attendance"]) == 1 and len(files["members"]) == 1
    assert "qr_token" not in files["members"][0]  # QR secrets never leave the database

    # Archive is refused until the backup is verified.
    refused = client.post(f"/api/backups/{manifest['backup']['id']}/archive", json={"backup_verified": True, "confirm": True}, headers=admin)
    assert refused.status_code == 409
    # A file with a missing record fails verification.
    assert _verify(client, admin, manifest, files, drop="attendance").status_code == 422
    verified = _verify(client, admin, manifest, files)
    assert verified.status_code == 200 and verified.json()["backup"]["status"] == "VERIFIED"
    # Both confirmations are required.
    assert client.post(f"/api/backups/{manifest['backup']['id']}/archive", json={"backup_verified": True}, headers=admin).status_code == 422

    archived = client.post(f"/api/backups/{manifest['backup']['id']}/archive", json={"backup_verified": True, "confirm": True},
                           headers=admin).json()
    assert archived["done"] is True and archived["status"] == "ARCHIVED"
    assert db.conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] == 0
    assert db.conn.execute("SELECT COUNT(*) FROM expenses").fetchone()[0] == 0
    # The July membership/payment lie outside the June period: untouched. Members are never archived.
    assert db.conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0] == 1
    assert db.conn.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 1
    history = client.get("/api/backups", headers=admin).json()["items"]
    assert history[0]["archived_count"] == 2 and history[0]["archived_by_name"] == "Admin"

    # Restore: existing rows are skipped, archived rows come back, nothing is overwritten.
    for table in ("members", "attendance", "expenses"):
        rows = files[table]
        check = client.post("/api/backups/restore/check", json={"table": table, "ids": [r["id"] for r in rows]}, headers=admin).json()
        applied = client.post("/api/backups/restore/apply", json={"table": table, "rows": rows}, headers=admin).json()
        if table == "members":
            assert check["existing"] == [rows[0]["id"]] and applied["inserted"] == 0 and applied["skipped"] == 1
        else:
            assert check["existing"] == [] and applied["inserted"] == 1
    assert db.conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0] == 1
    done = client.post("/api/backups/restore/complete", json={"file_name": manifest["backup"]["file_name"], "inserted": 2, "skipped": 1,
                                                              "datasets": ["attendance", "expenses"]}, headers=admin)
    assert done.status_code == 201 and done.json()["kind"] == "RESTORE"


def test_recent_data_cannot_be_archived(client, admin, plans, db):
    _seed_old_history(client, admin, plans, db)
    manifest = client.post("/api/backups", json={"datasets": ["attendance"], "period_from": "2026-09-01", "period_to": "2026-09-20"},
                           headers=admin).json()
    files = _download(client, admin, manifest)
    _verify(client, admin, manifest, files)
    response = client.post(f"/api/backups/{manifest['backup']['id']}/archive", json={"backup_verified": True, "confirm": True}, headers=admin)
    assert response.status_code == 422


def test_pending_payments_are_never_archived(client, admin, plans, db, upi_enabled, member_session):
    member, headers = member_session
    client.post("/api/me/renewals", json={"plan_id": plans["Monthly"]["id"], "utr": "412345678901"}, headers=headers)
    db.conn.execute("UPDATE payments SET payment_date = '2026-06-15' WHERE status = 'PENDING'")
    manifest = client.post("/api/backups", json={"datasets": ["payments"], "period_from": "2026-06-01", "period_to": "2026-06-30"},
                           headers=admin).json()
    assert manifest["eligible_for_archive"]["payments"] == 0
    files = _download(client, admin, manifest)
    _verify(client, admin, manifest, files)
    client.post(f"/api/backups/{manifest['backup']['id']}/archive", json={"backup_verified": True, "confirm": True}, headers=admin)
    assert db.conn.execute("SELECT COUNT(*) FROM payments WHERE status = 'PENDING'").fetchone()[0] == 1


def test_restore_skips_rows_whose_parents_are_missing(client, admin, db):
    rows = [{"id": 900, "member_id": 12345, "attendance_date": "2026-06-01", "check_in": "2026-06-01 01:00:00", "check_out": None,
             "method": "QR", "created_at": "2026-06-01 01:00:00"}]
    applied = client.post("/api/backups/restore/apply", json={"table": "attendance", "rows": rows}, headers=admin).json()
    assert applied == {"table": "attendance", "received": 1, "inserted": 0, "skipped": 1}


def test_storage_overview_thresholds_and_refresh(client, admin, plans, db, config):
    from services.storage_service import storage_level

    assert [storage_level(p) for p in (10, 72, 85, 92, 97)] == ["HEALTHY", "MONITOR", "WARNING", "CRITICAL", "ARCHIVE_REQUIRED"]
    overview = client.get("/api/storage", headers=admin).json()
    assert overview["limit_bytes"] == 500_000_000 and overview["status"] == "HEALTHY"
    assert overview["used_bytes"] > 0 and overview["remaining_bytes"] == overview["limit_bytes"] - overview["used_bytes"]
    assert {t["table"] for t in overview["tables"]} >= {"members", "payments", "attendance"}
    assert client.post("/api/storage/refresh", headers=admin).status_code == 429  # measured moments ago
    info = client.get("/api/storage/time-travel", headers=admin).json()
    assert info["retention_days"] == 7 and info["api_enabled"] is False and "time-travel restore" in info["cli_command"]
    restore = client.post("/api/storage/time-travel/restore", json={"timestamp": "2026-09-22T10:00:00Z", "confirm_text": "RESTORE"},
                          headers=admin)
    assert restore.status_code == 409  # not configured: the page shows the wrangler command instead
    wrong = client.post("/api/storage/time-travel/restore", json={"timestamp": "2026-09-22T10:00:00Z", "confirm_text": "yes"},
                        headers=admin)
    assert wrong.status_code == 422
