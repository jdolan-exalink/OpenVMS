"""
Frigate 0.17+ configuration endpoints.

All routes under /api/v1/frigate-config/{server_id}/
Requires operator or admin role.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, get_redis, require_operator
from app.schemas.frigate_config import (
    AddCameraRequest,
    ConfigHistoryResponse,
    GlobalConfigUpdate,
    Go2rtcStreamCreate,
    UpdateCameraConfigRequest,
)
from app.services.frigate_config_service import FrigateConfigService
from app.services.frigate_service import FrigateConfigError, FrigateService

router = APIRouter()


def _current_user_id(current_user=Depends(get_current_user)) -> uuid.UUID:
    return current_user.id


# ── config read ──────────────────────────────────────────────────────────────


@router.get("/{server_id}/config")
async def get_config(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(require_operator),
):
    try:
        return await FrigateConfigService.get_full_config(server_id, db, redis)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/{server_id}/config/schema")
async def get_config_schema(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(require_operator),
):
    try:
        return await FrigateConfigService.get_config_schema(server_id, db, redis)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/{server_id}/config/history")
async def get_config_history(
    server_id: uuid.UUID,
    camera_name: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    try:
        return await FrigateConfigService.get_config_history(server_id, db, camera_name, limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/{server_id}/config/revert")
async def revert_config(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    current_user=Depends(require_operator),
):
    try:
        await FrigateConfigService.revert_last_change(server_id, current_user.id, db, redis)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return {"status": "reverted"}


# ── go2rtc streams ────────────────────────────────────────────────────────────


@router.get("/{server_id}/streams")
async def list_streams(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    try:
        return await FrigateConfigService.get_go2rtc_streams(server_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/{server_id}/streams", status_code=status.HTTP_201_CREATED)
async def add_stream(
    server_id: uuid.UUID,
    body: Go2rtcStreamCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    try:
        return await FrigateConfigService.add_go2rtc_stream(server_id, body.name, body.url, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.delete("/{server_id}/streams/{stream_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stream(
    server_id: uuid.UUID,
    stream_name: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    try:
        await FrigateConfigService.delete_go2rtc_stream(server_id, stream_name, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


# ── cameras (via Frigate API) ─────────────────────────────────────────────────


@router.get("/{server_id}/cameras")
async def list_frigate_cameras(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(require_operator),
):
    try:
        config = await FrigateConfigService.get_full_config(server_id, db, redis)
        return config.get("cameras", {})
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/{server_id}/cameras", status_code=status.HTTP_201_CREATED)
async def add_camera(
    server_id: uuid.UUID,
    body: AddCameraRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    current_user=Depends(require_operator),
):
    try:
        return await FrigateConfigService.add_camera(
            server_id=server_id,
            user_id=current_user.id,
            camera_name=body.camera_name,
            rtsp_main=body.rtsp_main,
            rtsp_sub=body.rtsp_sub,
            detect_width=body.detect_width,
            detect_height=body.detect_height,
            detect_fps=body.detect_fps,
            detect_enabled=body.detect_enabled,
            record_enabled=body.record_enabled,
            record_retain_days=body.record_retain_days,
            record_mode=body.record_mode,
            snapshots_enabled=body.snapshots_enabled,
            snapshots_retain_days=body.snapshots_retain_days,
            track_objects=body.track_objects,
            auto_save=body.auto_save,
            db=db,
            redis=redis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except FrigateConfigError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/{server_id}/cameras/{camera_name}")
async def get_camera_config(
    server_id: uuid.UUID,
    camera_name: str,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(require_operator),
):
    cam = await FrigateConfigService.get_camera_config(server_id, camera_name, db, redis)
    if cam is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera '{camera_name}' not found in Frigate config",
        )
    return cam


@router.put("/{server_id}/cameras/{camera_name}")
async def update_camera_config(
    server_id: uuid.UUID,
    camera_name: str,
    body: UpdateCameraConfigRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    current_user=Depends(require_operator),
):
    updates = body.model_dump(exclude_none=True, exclude={"auto_save"})
    try:
        return await FrigateConfigService.update_camera(
            server_id=server_id,
            user_id=current_user.id,
            camera_name=camera_name,
            updates=updates,
            auto_save=body.auto_save,
            db=db,
            redis=redis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except FrigateConfigError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.delete("/{server_id}/cameras/{camera_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera_config(
    server_id: uuid.UUID,
    camera_name: str,
    delete_streams: bool = Query(True),
    auto_save: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    current_user=Depends(require_operator),
):
    try:
        await FrigateConfigService.delete_camera(
            server_id=server_id,
            user_id=current_user.id,
            camera_name=camera_name,
            delete_go2rtc_streams=delete_streams,
            auto_save=auto_save,
            db=db,
            redis=redis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except FrigateConfigError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


# ── global config sections ────────────────────────────────────────────────────


@router.put("/{server_id}/global/{section}")
async def update_global_section(
    server_id: uuid.UUID,
    section: str,
    body: dict,
    auto_save: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    current_user=Depends(require_operator),
):
    allowed = {"mqtt", "ffmpeg", "detect", "record", "snapshots", "birdseye", "live", "ui", "logger"}
    if section not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid section '{section}'. Allowed: {sorted(allowed)}",
        )
    try:
        return await FrigateConfigService.update_global_config(
            server_id=server_id,
            user_id=current_user.id,
            section=section,
            section_config=body,
            auto_save=auto_save,
            db=db,
            redis=redis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except FrigateConfigError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


# ── sync & stats ──────────────────────────────────────────────────────────────


@router.post("/{server_id}/sync")
async def sync_cameras(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(require_operator),
):
    try:
        return await FrigateConfigService.sync_cameras_to_vms(server_id, db, redis)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/{server_id}/stats")
async def get_stats(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    from app.models.frigate_server import FrigateServer
    from sqlalchemy import select

    result = await db.execute(select(FrigateServer).where(FrigateServer.id == server_id))
    server = result.scalar_one_or_none()
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    try:
        return await FrigateService.get_client(server).get_stats()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/{server_id}/version")
async def get_version(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    from app.models.frigate_server import FrigateServer
    from sqlalchemy import select

    result = await db.execute(select(FrigateServer).where(FrigateServer.id == server_id))
    server = result.scalar_one_or_none()
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    try:
        version = await FrigateService.get_client(server).get_version()
        return {"version": version}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
