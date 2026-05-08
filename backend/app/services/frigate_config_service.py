"""
FrigateConfigService

Bridge between the VMS and the Frigate 0.17+ configuration REST API.
Adds cameras, updates config sections, tracks every change in frigate_config_history.

Key rules:
  1. Always read full config before modifying (GET /api/config).
  2. Send FULL config on PUT /api/config/set — Frigate replaces, not merges.
  3. Register go2rtc streams BEFORE adding a camera to the config.
  4. Always record in frigate_config_history — both success and failure.
  5. On error: revert with POST /api/config/revert, record the failure.
  6. Invalidate Redis cache after every successful write.
"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.frigate_config import FrigateConfigHistory
from app.models.frigate_server import FrigateServer
from app.services.frigate_service import FrigateConfigError, FrigateService

if TYPE_CHECKING:
    from redis.asyncio import Redis


async def _get_server(server_id: uuid.UUID, db: AsyncSession) -> FrigateServer:
    result = await db.execute(select(FrigateServer).where(FrigateServer.id == server_id))
    server = result.scalar_one_or_none()
    if server is None:
        raise ValueError(f"Server {server_id} not found")
    return server


async def _record_history(
    db: AsyncSession,
    server_id: uuid.UUID,
    user_id: uuid.UUID | None,
    change_type: str,
    camera_name: str | None,
    config_diff: dict | None,
    full_config_snapshot: dict | None,
    success: bool,
    error_message: str | None = None,
) -> None:
    entry = FrigateConfigHistory(
        server_id=server_id,
        user_id=user_id,
        change_type=change_type,
        camera_name=camera_name,
        config_diff=config_diff,
        full_config_snapshot=full_config_snapshot,
        applied_at=datetime.now(timezone.utc),
        success=success,
        error_message=error_message,
    )
    db.add(entry)
    await db.commit()


def _deep_merge(base: dict, updates: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in updates.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


class FrigateConfigService:
    # ── read ─────────────────────────────────────────────────────────────────

    @staticmethod
    async def get_full_config(server_id: uuid.UUID, db: AsyncSession, redis: "Redis") -> dict:
        server = await _get_server(server_id, db)
        return await FrigateService.get_config_cached(server, redis)

    @staticmethod
    async def get_config_schema(server_id: uuid.UUID, db: AsyncSession, redis: "Redis") -> dict:
        server = await _get_server(server_id, db)
        return await FrigateService.get_schema_cached(server, redis)

    @staticmethod
    async def get_camera_config(
        server_id: uuid.UUID, camera_name: str, db: AsyncSession, redis: "Redis"
    ) -> dict | None:
        config = await FrigateConfigService.get_full_config(server_id, db, redis)
        return config.get("cameras", {}).get(camera_name)

    # ── go2rtc ───────────────────────────────────────────────────────────────

    @staticmethod
    async def get_go2rtc_streams(server_id: uuid.UUID, db: AsyncSession) -> dict:
        server = await _get_server(server_id, db)
        return await FrigateService.get_client(server).get_go2rtc_streams()

    @staticmethod
    async def add_go2rtc_stream(
        server_id: uuid.UUID, name: str, url: str | list[str], db: AsyncSession
    ) -> dict:
        server = await _get_server(server_id, db)
        return await FrigateService.get_client(server).add_go2rtc_stream(name, url)

    @staticmethod
    async def delete_go2rtc_stream(server_id: uuid.UUID, name: str, db: AsyncSession) -> bool:
        server = await _get_server(server_id, db)
        return await FrigateService.get_client(server).delete_go2rtc_stream(name)

    # ── add camera ───────────────────────────────────────────────────────────

    @staticmethod
    async def add_camera(
        server_id: uuid.UUID,
        user_id: uuid.UUID | None,
        camera_name: str,
        rtsp_main: str,
        rtsp_sub: str | None,
        detect_width: int = 1280,
        detect_height: int = 720,
        detect_fps: int = 5,
        detect_enabled: bool = True,
        record_enabled: bool = True,
        record_retain_days: int = 7,
        record_mode: str = "motion",
        snapshots_enabled: bool = True,
        snapshots_retain_days: int = 10,
        track_objects: list[str] | None = None,
        auto_save: bool = True,
        db: AsyncSession = None,  # type: ignore[assignment]
        redis: "Redis" = None,  # type: ignore[assignment]
    ) -> dict:
        """
        Full flow to add a camera to Frigate:
        1. Register go2rtc streams (main + optional sub).
        2. Read current config.
        3. Verify camera_name is not already in use.
        4. Build camera config using go2rtc restream URLs (rtsp://127.0.0.1:8554/).
        5. config_set() full config.
        6. config_save() if auto_save.
        7. Record in history.
        8. Invalidate Redis cache.
        """
        if track_objects is None:
            track_objects = ["person", "car"]

        server = await _get_server(server_id, db)
        client = FrigateService.get_client(server)

        # 1. Register go2rtc streams — must happen before camera config references them
        await client.add_go2rtc_stream(camera_name, rtsp_main)
        if rtsp_sub:
            await client.add_go2rtc_stream(f"{camera_name}_sub", rtsp_sub)

        # 2. Read current config
        config = await client.get_config()

        # 3. Guard against duplicate
        if camera_name in config.get("cameras", {}):
            raise ValueError(f"Camera '{camera_name}' already exists in Frigate")

        # 4. Build camera config using go2rtc restream (GO2RTC_RTSP_HOST)
        from app.services.system_config_service import SystemConfigService
        go2rtc_host = await SystemConfigService.get("go2rtc_rtsp_host", db, settings.go2rtc_rtsp_host)
        rtsp_base = f"rtsp://{go2rtc_host}"
        detect_path = (
            f"{rtsp_base}/{camera_name}_sub"
            if rtsp_sub
            else f"{rtsp_base}/{camera_name}"
        )
        record_path = f"{rtsp_base}/{camera_name}"

        camera_cfg: dict = {
            "ffmpeg": {
                "inputs": [
                    {"path": detect_path, "roles": ["detect"]},
                    {"path": record_path, "roles": ["record"]},
                ]
            },
            "detect": {
                "enabled": detect_enabled,
                "width": detect_width,
                "height": detect_height,
                "fps": detect_fps,
            },
            "record": {
                "enabled": record_enabled,
                "retain": {"days": record_retain_days, "mode": record_mode},
                "events": {"retain": {"default": 10, "mode": "active_objects"}},
            },
            "snapshots": {
                "enabled": snapshots_enabled,
                "bounding_box": True,
                "retain": {"default": snapshots_retain_days},
            },
            "objects": {"track": track_objects},
        }

        if "cameras" not in config:
            config["cameras"] = {}
        config["cameras"][camera_name] = camera_cfg

        # 5-6. Apply and optionally persist
        error: str | None = None
        try:
            await client.config_set(config)
            if auto_save:
                await client.config_save()
        except FrigateConfigError as exc:
            error = str(exc)
            try:
                await client.config_revert()
            except Exception:
                pass
            await _record_history(
                db, server_id, user_id, "add_camera", camera_name,
                camera_cfg, None, success=False, error_message=error,
            )
            raise

        # 7. Record success
        await _record_history(
            db, server_id, user_id, "add_camera", camera_name,
            camera_cfg, config, success=True,
        )

        # 8. Invalidate caches
        await FrigateService.invalidate_config_cache(server_id, redis)
        await FrigateService.invalidate_cameras_cache(server_id, redis)

        return {"camera_name": camera_name, "config": camera_cfg, "status": "created"}

    # ── update camera ─────────────────────────────────────────────────────────

    @staticmethod
    async def update_camera(
        server_id: uuid.UUID,
        user_id: uuid.UUID | None,
        camera_name: str,
        updates: dict,
        auto_save: bool = True,
        db: AsyncSession = None,  # type: ignore[assignment]
        redis: "Redis" = None,  # type: ignore[assignment]
    ) -> dict:
        server = await _get_server(server_id, db)
        client = FrigateService.get_client(server)

        config = await client.get_config()
        if camera_name not in config.get("cameras", {}):
            raise ValueError(f"Camera '{camera_name}' not found in Frigate")

        old_cam_cfg = copy.deepcopy(config["cameras"][camera_name])
        config["cameras"][camera_name] = _deep_merge(config["cameras"][camera_name], updates)
        diff = {"before": old_cam_cfg, "after": updates}

        try:
            await client.config_set(config)
            if auto_save:
                await client.config_save()
        except FrigateConfigError as exc:
            try:
                await client.config_revert()
            except Exception:
                pass
            await _record_history(
                db, server_id, user_id, "update_camera", camera_name,
                diff, None, success=False, error_message=str(exc),
            )
            raise

        await _record_history(
            db, server_id, user_id, "update_camera", camera_name,
            diff, config, success=True,
        )
        await FrigateService.invalidate_config_cache(server_id, redis)
        return config["cameras"][camera_name]

    # ── delete camera ─────────────────────────────────────────────────────────

    @staticmethod
    async def delete_camera(
        server_id: uuid.UUID,
        user_id: uuid.UUID | None,
        camera_name: str,
        delete_go2rtc_streams: bool = True,
        auto_save: bool = True,
        db: AsyncSession = None,  # type: ignore[assignment]
        redis: "Redis" = None,  # type: ignore[assignment]
    ) -> bool:
        server = await _get_server(server_id, db)
        client = FrigateService.get_client(server)

        config = await client.get_config()
        if camera_name not in config.get("cameras", {}):
            raise ValueError(f"Camera '{camera_name}' not found in Frigate")

        removed_cfg = config["cameras"].pop(camera_name)

        if delete_go2rtc_streams:
            streams = await client.get_go2rtc_streams()
            for stream_name in list(streams.keys()):
                if stream_name in (camera_name, f"{camera_name}_sub"):
                    await client.delete_go2rtc_stream(stream_name)

        try:
            await client.config_set(config)
            if auto_save:
                await client.config_save()
        except FrigateConfigError as exc:
            try:
                await client.config_revert()
            except Exception:
                pass
            await _record_history(
                db, server_id, user_id, "delete_camera", camera_name,
                removed_cfg, None, success=False, error_message=str(exc),
            )
            raise

        await _record_history(
            db, server_id, user_id, "delete_camera", camera_name,
            removed_cfg, config, success=True,
        )
        await FrigateService.invalidate_config_cache(server_id, redis)
        await FrigateService.invalidate_cameras_cache(server_id, redis)
        return True

    # ── global config ─────────────────────────────────────────────────────────

    @staticmethod
    async def update_global_config(
        server_id: uuid.UUID,
        user_id: uuid.UUID | None,
        section: str,
        section_config: dict,
        auto_save: bool = True,
        db: AsyncSession = None,  # type: ignore[assignment]
        redis: "Redis" = None,  # type: ignore[assignment]
    ) -> dict:
        server = await _get_server(server_id, db)
        client = FrigateService.get_client(server)

        config = await client.get_config()
        old_section = copy.deepcopy(config.get(section, {}))
        config[section] = _deep_merge(config.get(section, {}), section_config)
        diff = {"section": section, "before": old_section, "after": section_config}

        try:
            await client.config_set(config)
            if auto_save:
                await client.config_save()
        except FrigateConfigError as exc:
            try:
                await client.config_revert()
            except Exception:
                pass
            await _record_history(
                db, server_id, user_id, "update_global", section,
                diff, None, success=False, error_message=str(exc),
            )
            raise

        await _record_history(
            db, server_id, user_id, "update_global", section,
            diff, config, success=True,
        )
        await FrigateService.invalidate_config_cache(server_id, redis)
        return config.get(section, {})

    # ── sync cameras to VMS ───────────────────────────────────────────────────

    @staticmethod
    async def sync_cameras_to_vms(
        server_id: uuid.UUID,
        db: AsyncSession,
        redis: "Redis",
    ) -> dict:
        server = await _get_server(server_id, db)
        return await FrigateService.sync_cameras(server, db, redis)

    # ── history ───────────────────────────────────────────────────────────────

    @staticmethod
    async def get_config_history(
        server_id: uuid.UUID,
        db: AsyncSession,
        camera_name: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        q = (
            select(FrigateConfigHistory)
            .where(FrigateConfigHistory.server_id == server_id)
            .order_by(FrigateConfigHistory.applied_at.desc())
            .limit(limit)
        )
        if camera_name:
            q = q.where(FrigateConfigHistory.camera_name == camera_name)
        result = await db.execute(q)
        rows = result.scalars().all()
        return [
            {
                "id": r.id,
                "server_id": str(r.server_id),
                "user_id": str(r.user_id) if r.user_id else None,
                "change_type": r.change_type,
                "camera_name": r.camera_name,
                "config_diff": r.config_diff,
                "applied_at": r.applied_at.isoformat(),
                "success": r.success,
                "error_message": r.error_message,
            }
            for r in rows
        ]

    # ── revert ────────────────────────────────────────────────────────────────

    @staticmethod
    async def revert_last_change(
        server_id: uuid.UUID,
        user_id: uuid.UUID | None,
        db: AsyncSession,
        redis: "Redis",
    ) -> bool:
        server = await _get_server(server_id, db)
        client = FrigateService.get_client(server)
        await client.config_revert()
        await _record_history(
            db, server_id, user_id, "revert", None, None, None, success=True
        )
        await FrigateService.invalidate_config_cache(server_id, redis)
        return True
