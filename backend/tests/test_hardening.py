from pathlib import Path

import pytest
from conftest import ROOT

from core.config import ConfigError, load_config
from core.database.sqlite import SQLiteDatabase

STRONG = "x7Qp2Lr9Vb4Nk8Ts1Wd6Hy3Jm5Fc0GzA"  # 32 random-looking characters


def _example_value(name: str) -> str:
    for line in (ROOT / ".dev.vars.example").read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1]
    raise AssertionError(f"{name} missing from .dev.vars.example")


@pytest.mark.parametrize("name", ["JWT_SECRET", "AUTH_SECRET"])
def test_production_refuses_the_public_example_secrets(name):
    secrets = {"jwt_secret": STRONG, "auth_secret": STRONG, name.lower(): _example_value(name)}
    assert len(secrets[name.lower()]) >= 32  # long enough: only the placeholder check stops it
    with pytest.raises(ConfigError, match=name):
        load_config({}, environment="production", allowed_origins=("https://gym.example",), **secrets)
    # The same values are fine for local development.
    load_config({}, environment="development", **secrets)


def test_production_accepts_real_secrets():
    load_config({}, environment="production", allowed_origins=("https://gym.example",), jwt_secret=STRONG, auth_secret=STRONG[::-1])


def test_body_limit_counts_streamed_bytes_without_content_length(client):
    def chunks():
        for _ in range(5):
            yield b"x" * 64 * 1024  # 320 KB in total, no Content-Length header

    response = client.post("/api/auth/login", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_small_streamed_body_still_reaches_the_app(client, admin):
    def chunks():
        yield b'{"identifier": "admin@smartgym.test", '
        yield b'"password": "wrong-password"}'

    response = client.post("/api/auth/login", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 401  # parsed and checked, not rejected as too large


def test_dev_seed_can_be_loaded_twice():
    db = SQLiteDatabase(":memory:")
    db.apply_migrations(ROOT / "migrations")
    seed = Path(ROOT / "seed" / "dev_seed.sql").read_text(encoding="utf-8")
    db.execute_script(seed)
    members = db.conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]
    db.execute_script(seed)  # used to fail with UNIQUE constraint errors
    assert db.conn.execute("SELECT COUNT(*) FROM members").fetchone()[0] == members > 0
