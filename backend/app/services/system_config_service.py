"""SystemConfigService — runtime-editable system configuration with in-memory TTL cache."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.system_config import SystemConfig

_EDITABLE_KEYS = {"ome_webrtc_base", "ome_llhls_base", "go2rtc_rtsp_host", "cors_origins"}

_DEFAULTS: dict[str, Any] = {
    "ome_webrtc_base": settings.ome_webrtc_base,
    "ome_llhls_base": settings.ome_llhls_base,
    "go2rtc_rtsp_host": settings.go2rtc_rtsp_host,
    "cors_origins": settings.cors_origins,
}

_CACHE_TTL = 60.0

_cache: dict[str, Any] | None = None
_cache_ts: float = 0.0


def _invalidate_cache() -> None:
    global _cache, _cache_ts
    _cache = None
    _cache_ts = 0.0


async def _load(db: AsyncSession) -> dict[str, Any]:
    global _cache, _cache_ts
    now = time.monotonic()
    if _cache is not None and (now - _cache_ts) < _CACHE_TTL:
        return _cache

    result = await db.execute(select(SystemConfig))
    rows = result.scalars().all()
    merged = dict(_DEFAULTS)
    for row in rows:
        merged[row.key] = row.value
    _cache = merged
    _cache_ts = now
    return merged


class SystemConfigService:
    @staticmethod
    async def get_all(db: AsyncSession) -> dict[str, Any]:
        return await _load(db)

    @staticmethod
    async def get(key: str, db: AsyncSession, default: Any = None) -> Any:
        data = await _load(db)
        return data.get(key, default)

    @staticmethod
    async def set_many(updates: dict[str, Any], db: AsyncSession) -> dict[str, Any]:
        for key, value in updates.items():
            result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
            row = result.scalar_one_or_none()
            if row is None:
                row = SystemConfig(key=key, value=value)
                db.add(row)
            else:
                row.value = value
        await db.commit()
        _invalidate_cache()
        return await _load(db)
