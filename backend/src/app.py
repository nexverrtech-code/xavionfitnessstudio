"""FastAPI application factory.

The same app runs on Cloudflare Python Workers (D1 binding from the Worker env) and on CPython
for tests / local development (SQLite adapter); only the providers differ. Every route lives
under /api (/api/auth, /api/members, ... /api/backups, /api/storage).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from api import (
    attendance,
    auth,
    backups,
    dashboard,
    expenses,
    members,
    memberships,
    notifications,
    payments,
    plans,
    portal,
    progress,
    reports,
    settings,
    storage,
    trainers,
    users,
    workouts,
)
from api.responses import FastJSON
from core.config import AppConfig, ConfigError, config_from_worker_env
from core.database import Database, DatabaseError, IntegrityError
from core.errors import AppError

logger = logging.getLogger("smartgym")

API_VERSION = "1.1.0"
API_PREFIX = "/api"
MAX_BODY_BYTES = 256 * 1024
DOC_PATHS = {"/api/docs", "/api/docs/oauth2-redirect", "/api/openapi.json"}
ROUTERS = (auth, users, members, trainers, plans, memberships, payments, attendance, workouts, progress, notifications,
           expenses, reports, dashboard, backups, storage, settings, portal)

ConfigProvider = Callable[[dict], AppConfig]
DbProvider = Callable[[dict, AppConfig], Database]

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
    (b"cross-origin-resource-policy", b"same-site"),
]
API_CSP = (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")


def _worker_config(scope: dict) -> AppConfig:
    return config_from_worker_env(scope.get("env"))


def _worker_db(scope: dict, config: AppConfig) -> Database:
    from core.database.d1 import D1Database

    return D1Database(scope["env"].DB)


async def _send_json(send: Callable[[dict], Awaitable[None]], status: int, payload: dict, extra: list | None = None) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), *(extra or [])],
        }
    )
    await send({"type": "http.response.body", "body": body})


class EdgeMiddleware:
    """Pure-ASGI middleware (cheaper than BaseHTTPMiddleware): per-request config + DB, CORS
    from ALLOWED_ORIGINS, security headers, default no-store caching, a 256 KB body limit,
    Server-Timing with D1 round-trip / row statistics, and a friendly 500 for anything else."""

    def __init__(self, app: Any, *, config_provider: ConfigProvider, db_provider: DbProvider) -> None:
        self.app = app
        self.config_provider = config_provider
        self.db_provider = db_provider

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        try:
            config = self.config_provider(scope)
        except ConfigError as exc:
            logger.error("configuration error: %s", exc)
            await _send_json(send, 503, {"error": {"code": "MISCONFIGURED", "message": "The server is not configured yet."}})
            return

        origin = headers.get("origin")
        cors: list[tuple[bytes, bytes]] = []
        if origin and config.origin_allowed(origin):
            cors = [
                (b"access-control-allow-origin", origin.encode("latin-1")),
                (b"vary", b"Origin"),
                (b"access-control-expose-headers", b"Content-Disposition, Server-Timing"),
            ]
        method = scope["method"]
        path = scope.get("path") or ""

        if method == "OPTIONS" and "access-control-request-method" in headers:
            preflight = [
                (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS"),
                (b"access-control-allow-headers", b"Authorization, Content-Type, Idempotency-Key"),
                (b"access-control-max-age", b"86400"),  # browsers cap this (Chrome: 2 hours)
            ]
            await send({"type": "http.response.start", "status": 204 if cors else 403, "headers": cors + preflight if cors else []})
            await send({"type": "http.response.body", "body": b""})
            return

        if path in DOC_PATHS and config.is_production:
            await _send_json(send, 404, {"error": {"code": "NOT_FOUND", "message": "Not found."}}, cors)
            return
        try:
            too_big = int(headers.get("content-length") or 0) > MAX_BODY_BYTES
        except ValueError:
            too_big = True
        if too_big:
            await _send_json(send, 413, {"error": {"code": "PAYLOAD_TOO_LARGE", "message": "The request is too large."}}, cors)
            return

        db = self.db_provider(scope, config)
        state = dict(scope.get("state") or {})
        state.update(db=db, config=config)
        scope["state"] = state
        response_started = False
        is_docs = path in DOC_PATHS

        async def send_wrapper(message: dict) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                raw = list(message.get("headers") or [])
                names = {k.lower() for k, _ in raw}
                extra = [*cors, *SECURITY_HEADERS]
                if not is_docs:
                    extra.append(API_CSP)
                if b"cache-control" not in names:
                    extra.append((b"cache-control", b"no-store"))
                if config.is_production:
                    extra.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                stats = db.stats
                timing = (
                    f"app;dur={(time.perf_counter() - started) * 1000:.1f}, "
                    f'db;dur={stats.duration_ms:.1f};desc="{stats.round_trips} trips, {stats.statements} stmts, '
                    f'{stats.rows_read} rows read, {stats.rows_written} rows written"'
                )
                extra.append((b"server-timing", timing.encode()))
                message = {**message, "headers": raw + extra}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("unhandled error on %s %s", method, path)
            if not response_started:
                await _send_json(
                    send_wrapper, 500, {"error": {"code": "INTERNAL_ERROR", "message": "Something went wrong. Please try again."}}
                )


def _field_errors(exc: RequestValidationError) -> dict[str, str]:
    fields: dict[str, str] = {}
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", ()) if part not in ("body", "query", "path", "header")]
        name = ".".join(location) or "request"
        message = str(error.get("msg", "Invalid value"))
        for prefix in ("Value error, ", "Assertion failed, "):
            if message.startswith(prefix):
                message = message[len(prefix):]
        if error.get("type") == "missing":
            message = "This field is required"
        elif error.get("type") == "json_invalid":
            name, message = "request", "The request body is not valid JSON"
        elif error.get("type") == "literal_error" and name in ("confirm", "backup_verified", "confirm_text"):
            message = "Please confirm this action"
        fields.setdefault(name, message[:1].upper() + message[1:])
    return fields


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError) -> FastJSON:
        return FastJSON(exc.to_dict(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> FastJSON:
        fields = _field_errors(exc)
        first = next(iter(fields.values()), "Please check the highlighted fields.")
        message = first if len(fields) == 1 else "Please check the highlighted fields."
        return FastJSON({"error": {"code": "VALIDATION_FAILED", "message": message, "fields": fields}}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> FastJSON:
        messages = {404: "Not found.", 405: "This action isn't allowed here."}
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        message = messages.get(exc.status_code) or (exc.detail if isinstance(exc.detail, str) else "Request failed.")
        return FastJSON({"error": {"code": code, "message": message}}, status_code=exc.status_code)

    @app.exception_handler(IntegrityError)
    async def integrity_error(_: Request, exc: IntegrityError) -> FastJSON:
        logger.warning("integrity error: %s", exc)
        return FastJSON(
            {"error": {"code": "CONFLICT", "message": "This change conflicts with existing data. Refresh and try again."}},
            status_code=409,
        )

    @app.exception_handler(DatabaseError)
    async def database_error(_: Request, exc: DatabaseError) -> FastJSON:
        logger.error("database error: %s", exc)
        if exc.daily_limit_reached:
            return FastJSON(
                {"error": {"code": "DAILY_LIMIT", "message": "The database's free daily limit has been reached. It resets at 05:30 IST."}},
                status_code=503,
            )
        return FastJSON(
            {"error": {"code": "DATABASE_UNAVAILABLE", "message": "We couldn't load this information. Please try again."}},
            status_code=503,
        )


def create_app(*, config_provider: ConfigProvider | None = None, db_provider: DbProvider | None = None) -> FastAPI:
    app = FastAPI(
        title="SmartGym API",
        version=API_VERSION,
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json",
        default_response_class=FastJSON,
    )
    register_exception_handlers(app)
    for module in ROUTERS:
        app.include_router(module.router, prefix=API_PREFIX)

    @app.get(f"{API_PREFIX}/health", include_in_schema=False)
    async def health() -> FastJSON:
        return FastJSON({"status": "ok", "version": API_VERSION, "time": int(time.time())})

    app.add_middleware(
        EdgeMiddleware,
        config_provider=config_provider or _worker_config,
        db_provider=db_provider or _worker_db,
    )
    return app
