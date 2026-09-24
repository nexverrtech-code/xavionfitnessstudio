"""MeasurementRepository: body measurements for progress tracking."""

from __future__ import annotations

from typing import Any

from models.domain import METRICS

from .base import Repository, count_of

MEASUREMENT_COLUMNS = "b.id, b.member_id, " + ", ".join(f"b.{m}" for m in METRICS) + ", b.recorded_at, b.created_by"


class MeasurementRepository(Repository):
    async def for_member(self, member_id: int, limit: int = 120) -> list[dict[str, Any]]:
        return await self.db.all(
            f"SELECT {MEASUREMENT_COLUMNS} FROM body_measurements b WHERE b.member_id = ?1 "
            "ORDER BY b.recorded_at DESC, b.id DESC LIMIT ?2",
            [member_id, limit],
        )

    async def insert(self, member_id: int, values: dict[str, Any], recorded_at: str, created_by: int | None) -> dict[str, Any]:
        columns = ", ".join(METRICS)
        slots = ", ".join(f"?{i}" for i in range(2, 2 + len(METRICS)))
        n = 2 + len(METRICS)
        return await self.db.one(
            f"INSERT INTO body_measurements (member_id, {columns}, recorded_at, created_by) VALUES (?1, {slots}, ?{n}, ?{n + 1}) "
            f"RETURNING id, member_id, {columns}, recorded_at, created_by",
            [member_id, *[values.get(m) for m in METRICS], recorded_at, created_by],
        )

    async def member_of(self, measurement_id: int) -> int | None:
        return await self.db.value("SELECT member_id FROM body_measurements WHERE id = ?1", [measurement_id])

    async def delete(self, measurement_id: int) -> int:
        return (await self.db.run("DELETE FROM body_measurements WHERE id = ?1", [measurement_id])).changes

    async def recent(self, *, trainer_id: int | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int]:
        scope = "WHERE m.trainer_id = ?3" if trainer_id else ""
        rows, total = await self.db.batch(
            [
                (
                    f"SELECT {MEASUREMENT_COLUMNS}, m.name AS member_name, m.member_code FROM body_measurements b "
                    f"JOIN members m ON m.id = b.member_id {scope} ORDER BY b.id DESC LIMIT ?1 OFFSET ?2",
                    [limit, offset] + ([trainer_id] if trainer_id else []),
                ),
                (
                    "SELECT COUNT(*) AS c FROM body_measurements b JOIN members m ON m.id = b.member_id "
                    + ("WHERE m.trainer_id = ?1" if trainer_id else ""),
                    [trainer_id] if trainer_id else [],
                ),
            ]
        )
        return rows.rows, count_of(total)
