"""A tiny per-isolate TTL cache.

Used only for small, relatively stable data (gym settings, the authenticated user's
role/status). Payment status, membership status and member records are never cached.
"""

from __future__ import annotations

import time
from typing import Any, Hashable


class TTLCache:
    def __init__(self, ttl_seconds: float, max_size: int = 512) -> None:
        self.ttl = ttl_seconds
        self.max_size = max_size
        self._data: dict[Hashable, tuple[float, Any]] = {}

    def get(self, key: Hashable) -> Any | None:
        item = self._data.get(key)
        if item is None:
            return None
        expires, value = item
        if expires < time.monotonic():
            self._data.pop(key, None)
            return None
        return value

    def set(self, key: Hashable, value: Any) -> None:
        if len(self._data) >= self.max_size:
            # Drop the oldest entry (dicts keep insertion order).
            self._data.pop(next(iter(self._data)), None)
        self._data[key] = (time.monotonic() + self.ttl, value)

    def pop(self, key: Hashable) -> None:
        self._data.pop(key, None)

    def clear(self) -> None:
        self._data.clear()
