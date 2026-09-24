"""SettingsRepository: key/value gym settings (only admin overrides are stored)."""

from __future__ import annotations

from .base import Repository


class SettingsRepository(Repository):
    async def all(self) -> dict[str, str]:
        rows = await self.db.all("SELECT key, value FROM settings")
        return {r["key"]: r["value"] for r in rows}

    async def save(self, values: dict[str, str], now: str) -> None:
        await self.db.batch(
            [
                (
                    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) "
                    "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                    [key, value, now],
                )
                for key, value in values.items()
            ]
        )
