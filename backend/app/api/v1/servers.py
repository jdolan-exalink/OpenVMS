import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, get_redis, require_admin
from app.models.frigate_server import FrigateServer
from app.schemas.camera import (
    FrigateServerCreate,
    FrigateServerResponse,
    FrigateServerUpdate,
    ServerStatusResponse,
    SyncSummary,
)
from app.services.frigate_service import FrigateService

router = APIRouter()


def _server_values(body: FrigateServerCreate | FrigateServerUpdate) -> tuple[dict, dict]:
    values = body.model_dump(exclude_none=True)
    metadata: dict = {}
    if "recordings_path" in values:
        metadata["recordings_path"] = values.pop("recordings_path")
    if "config_path" in values:
        metadata["config_path"] = values.pop("config_path")
    return values, metadata


async def _get_or_404(server_id: uuid.UUID, db: AsyncSession) -> FrigateServer:
    result = await db.execute(select(FrigateServer).where(FrigateServer.id == server_id))
    server = result.scalar_one_or_none()
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return server


@router.get("", response_model=list[FrigateServerResponse])
async def list_servers(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(FrigateServer).order_by(FrigateServer.created_at))
    return result.scalars().all()


@router.post("", response_model=FrigateServerResponse, status_code=status.HTTP_201_CREATED)
async def create_server(
    body: FrigateServerCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    values, metadata = _server_values(body)
    server = FrigateServer(**values, extra_metadata=metadata)
    db.add(server)
    await db.commit()
    await db.refresh(server)
    if server.mqtt_host:
        await mqtt_service.start_one(server)
    return server


@router.put("/{server_id}", response_model=FrigateServerResponse)
async def update_server(
    server_id: uuid.UUID,
    body: FrigateServerUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    server = await _get_or_404(server_id, db)
    values, metadata = _server_values(body)
    for field, value in values.items():
        setattr(server, field, value)
    if metadata:
        server.extra_metadata = {**(server.extra_metadata or {}), **metadata}
    await FrigateService.remove_client(server_id)
    await db.commit()
    await db.refresh(server)
    await mqtt_service.remove_server(server.name)
    if server.mqtt_host and server.enabled:
        await mqtt_service.start_one(server)
    return server


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    server = await _get_or_404(server_id, db)
    await FrigateService.remove_client(server_id)
    await mqtt_service.remove_server(server.name)
    await db.delete(server)
    await db.commit()


@router.get("/{server_id}", response_model=FrigateServerResponse)
async def get_server(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await _get_or_404(server_id, db)


@router.put("/{server_id}", response_model=FrigateServerResponse)
async def update_server(
    server_id: uuid.UUID,
    body: FrigateServerUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    server = await _get_or_404(server_id, db)
    values, metadata = _server_values(body)
    for field, value in values.items():
        setattr(server, field, value)
    if metadata:
        server.extra_metadata = {**(server.extra_metadata or {}), **metadata}
    await FrigateService.remove_client(server_id)
    await db.commit()
    await db.refresh(server)
    return server


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    server = await _get_or_404(server_id, db)
    await FrigateService.remove_client(server_id)
    await db.delete(server)
    await db.commit()


@router.get("/{server_id}/status", response_model=ServerStatusResponse)
async def get_server_status(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(get_current_user),
):
    server = await _get_or_404(server_id, db)
    result = await FrigateService.health_check(server)

    cameras: list[str] = []
    if result.get("online"):
        try:
            cam_data = await FrigateService.get_cameras_cached(server, redis)
            cameras = list(cam_data.keys())
            server.last_seen = datetime.now(timezone.utc)
            await db.commit()
        except Exception:
            pass

    return ServerStatusResponse(
        online=result.get("online", False),
        version=result.get("version"),
        latency_ms=result.get("latency_ms"),
        cameras=cameras,
        error=result.get("error"),
    )


@router.post("/{server_id}/sync", response_model=SyncSummary)
async def sync_cameras(
    server_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(require_admin),
):
    server = await _get_or_404(server_id, db)
    try:
        summary = await FrigateService.sync_cameras(server, db, redis)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    return summary
