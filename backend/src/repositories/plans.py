"""PlanRepository: membership plans (admin-defined, e.g. Monthly 30 days)."""

from __future__ import annotations

from typing import Any

from .base import Repository

PLAN_COLUMNS = "p.id, p.name, p.duration_days, p.price, p.description, p.status, p.created_at, p.updated_at"


class PlanRepository(Repository):
    async def list(self, *, include_inactive: bool, with_stats: bool, today: str) -> list[dict[str, Any]]:
        stats, params = "", []
        if with_stats:
            params.append(today)
            stats = (
                ", (SELECT COUNT(*) FROM memberships ms WHERE ms.plan_id = p.id AND ms.status IN ('ACTIVE', 'EXPIRING') "
                "AND ms.start_date <= ?1 AND ms.end_date >= ?1) AS active_members"
            )
        condition = "" if include_inactive else " WHERE p.status = 'ACTIVE'"
        return await self.db.all(
            f"SELECT {PLAN_COLUMNS}{stats} FROM membership_plans p{condition} ORDER BY p.status, p.duration_days, p.price LIMIT 100",
            params,
        )

    async def get(self, plan_id: int) -> dict[str, Any] | None:
        return await self.db.one(f"SELECT {PLAN_COLUMNS} FROM membership_plans p WHERE p.id = ?1", [plan_id])

    async def insert(self, values: dict[str, Any], now: str) -> dict[str, Any]:
        return await self.db.one(
            "INSERT INTO membership_plans (name, duration_days, price, description, status, created_at, updated_at) "
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) "
            "RETURNING id, name, duration_days, price, description, status, created_at, updated_at",
            [values["name"], values["duration_days"], values["price"], values.get("description"), values["status"], now],
        )

    async def update(self, plan_id: int, values: dict[str, Any], now: str) -> dict[str, Any] | None:
        return await self.db.one(
            "UPDATE membership_plans SET name = ?2, duration_days = ?3, price = ?4, description = ?5, status = ?6, "
            "updated_at = ?7 WHERE id = ?1 RETURNING id, name, duration_days, price, description, status, created_at, updated_at",
            [plan_id, values["name"], values["duration_days"], values["price"], values.get("description"), values["status"], now],
        )
