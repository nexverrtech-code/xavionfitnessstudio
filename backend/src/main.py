"""Cloudflare Python Worker entrypoint for the SmartGym API.

- fetch     -> FastAPI (ASGI) running inside the Worker, with the D1 binding as ``env.DB``
- scheduled -> the daily Cron Trigger (statuses, reminders, clean-up, storage snapshot)

No separate server (and no Uvicorn) is used in production: the Workers runtime is the entry
point. The FastAPI app is created at import time so it is captured in the Workers memory
snapshot.
"""

import logging

from workers import WorkerEntrypoint

from app import create_app

try:  # workers-runtime-sdk
    from workers import asgi
except Exception:  # older runtimes expose the adapter as a top-level module
    import asgi  # type: ignore[no-redef]

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = create_app()


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env, self.ctx)

    async def scheduled(self, controller, env=None, ctx=None):
        from core.config import config_from_worker_env
        from core.database.d1 import D1Database
        from jobs.scheduler import run_daily_jobs

        worker_env = env if env is not None else self.env
        await run_daily_jobs(D1Database(worker_env.DB), config_from_worker_env(worker_env))
