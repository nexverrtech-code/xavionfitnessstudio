"""Test harness: the real FastAPI app + real migrations on an in-memory SQLite database
(D1 is SQLite, so schema, constraints, triggers and SQL behave the same)."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from app import create_app  # noqa: E402
from core.clock import Clock  # noqa: E402
from core.config import load_config  # noqa: E402
from core.database.sqlite import SQLiteDatabase  # noqa: E402
from security.passwords import hash_password_sync  # noqa: E402
from services import settings_service  # noqa: E402
from services.auth_service import session_cache  # noqa: E402

ADMIN_EMAIL = "admin@smartgym.test"
ADMIN_PASSWORD = "Admin@12345"
AUTH_SECRET = "test-auth-secret-that-is-long-enough-000"
ITERATIONS = 1000
# 06:30 UTC = 12:00 IST on 23 Sep 2026
NOW = datetime(2026, 9, 23, 6, 30, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def frozen_clock():
    Clock.frozen = NOW
    yield
    Clock.frozen = None


@pytest.fixture
def db():
    database = SQLiteDatabase(":memory:")
    database.apply_migrations(ROOT / "migrations")
    settings_service.invalidate_cache()
    session_cache.clear()
    yield database
    database.conn.close()


@pytest.fixture
def config():
    return load_config(
        {},
        environment="test",
        jwt_secret="test-secret-that-is-long-enough-for-hs256-signing",
        auth_secret=AUTH_SECRET,
        password_iterations=ITERATIONS,
        allowed_origins=("http://localhost:5173",),
    )


@pytest.fixture
def client(db, config):
    app = create_app(config_provider=lambda scope: config, db_provider=lambda scope, cfg: db)
    with TestClient(app) as test_client:
        yield test_client


def insert_user(db: SQLiteDatabase, *, role_id: int, name: str, email: str | None = None, phone: str | None = None,
                password: str = ADMIN_PASSWORD) -> int:
    cursor = db.conn.execute(
        "INSERT INTO users (role_id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)",
        [role_id, name, email, phone, hash_password_sync(password, secret=AUTH_SECRET, iterations=ITERATIONS)],
    )
    return cursor.lastrowid


def login(client: TestClient, identifier: str, password: str) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"identifier": identifier, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def activate_login(client: TestClient, identifier: str, temp_password: str, new_password: str = "Fresh@2026pass") -> dict[str, str]:
    """Sign in with a temporary password and set a permanent one."""
    headers = login(client, identifier, temp_password)
    response = client.post(
        "/api/auth/change-password", json={"current_password": temp_password, "new_password": new_password}, headers=headers
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def idem() -> dict[str, str]:
    return {"Idempotency-Key": uuid.uuid4().hex}


@pytest.fixture
def admin(client, db) -> dict[str, str]:
    insert_user(db, role_id=1, name="Admin", email=ADMIN_EMAIL)
    return login(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture
def staff(client, db) -> dict[str, str]:
    insert_user(db, role_id=2, name="Front Desk", email="desk@smartgym.test")
    return login(client, "desk@smartgym.test", ADMIN_PASSWORD)


@pytest.fixture
def plans(client, admin) -> dict[str, dict]:
    created = {}
    for name, days, price in (("Monthly", 30, 150000), ("Quarterly", 90, 400000), ("Yearly", 365, 1300000)):
        response = client.post("/api/membership-plans", json={"name": name, "duration_days": days, "price": price}, headers=admin)
        assert response.status_code == 201, response.text
        created[name] = response.json()
    return created


@pytest.fixture
def upi_enabled(client, admin):
    response = client.put("/api/settings", json={"upi_enabled": True, "upi_id": "smartgym@upi", "upi_name": "SmartGym"}, headers=admin)
    assert response.status_code == 200, response.text


def create_member(client: TestClient, headers: dict, name: str = "Aarav Sharma", phone: str = "9876543210", **extra) -> dict:
    response = client.post("/api/members", json={"name": name, "phone": phone, **extra}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def pay(client: TestClient, headers: dict, member_id: int, plan: dict, *, method: str = "CASH", **extra):
    body = {"member_id": member_id, "plan_id": plan["id"], "payment_method": method, **extra}
    return client.post("/api/payments", json=body, headers={**headers, **idem()})


@pytest.fixture
def member_session(client, admin):
    created = create_member(client, admin)
    headers = activate_login(client, created["credentials"]["login"], created["credentials"]["temporary_password"])
    return created["member"], headers
