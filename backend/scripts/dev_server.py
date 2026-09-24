"""Run the SmartGym API locally on CPython + SQLite — no Wrangler needed.

    python scripts/dev_server.py            # migrate .local/smartgym.sqlite3 and serve on :8787
    python scripts/dev_server.py --seed     # also load DEVELOPMENT demo data (fresh database)
    python scripts/dev_server.py --reset --seed

A convenience for fast UI work only. Production runs FastAPI inside a Cloudflare Python Worker
with D1 (`uv run pywrangler dev` runs that real runtime locally). Settings come from
backend/.dev.vars, like the Worker.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from app import create_app  # noqa: E402
from core.config import load_config  # noqa: E402
from core.database.sqlite import SQLiteDatabase  # noqa: E402


def dev_vars() -> dict[str, str]:
    path = ROOT / ".dev.vars"
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    return values


def build(db_path: Path, *, reset: bool, seed: bool) -> SQLiteDatabase:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if reset and db_path.exists():
        db_path.unlink()
    fresh = not db_path.exists()
    db = SQLiteDatabase(str(db_path))
    applied = db.apply_migrations(ROOT / "migrations")
    if applied:
        print(f"Applied migrations: {', '.join(applied)}")
    if seed:
        if not fresh:
            print("Seed skipped: database already exists (use --reset --seed).")
        else:
            sql = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "seed_dev.py")], check=True, capture_output=True, text=True, encoding="utf-8"
            ).stdout
            db.execute_script(sql)
            print("Loaded DEVELOPMENT demo data. Logins:")
            for line in sql.splitlines()[-4:]:
                print("  " + line.lstrip("- "))
    return db


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--db", type=Path, default=ROOT / ".local" / "smartgym.sqlite3")
    parser.add_argument("--seed", action="store_true", help="load development demo data into a new database")
    parser.add_argument("--reset", action="store_true", help="delete the local database first")
    args = parser.parse_args()

    import uvicorn  # dev-only dependency; production never uses a Python web server

    db = build(args.db, reset=args.reset, seed=args.seed)
    env = {**dev_vars(), **os.environ}
    env.setdefault("ENVIRONMENT", "development")
    env.setdefault("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173")
    config = load_config(env)
    app = create_app(config_provider=lambda scope: config, db_provider=lambda scope, cfg: db)
    print(f"SmartGym API (local SQLite) on http://{args.host}:{args.port}/api  ·  docs: /api/docs")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
