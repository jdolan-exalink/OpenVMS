"""Recordings endpoints — proxy to Frigate recordings + async FFmpeg export."""

import asyncio
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, get_redis
from app.models.camera import Camera
from app.models.frigate_server import FrigateServer
from app.services import export_service
from app.services.frigate_service import FrigateService

router = APIRouter()

_ABSOLUTE_VOD_RE = re.compile(
    rb"(?P<quote>[\"']?)/vod/[^/]+/start/(?P<start>\d+)/end/(?P<end>\d+)/(?P<path>[^\"'\s]+)"
)


class ExportRequest(BaseModel):
    camera_id: uuid.UUID
    start: datetime
    end: datetime


class ExportStatusResponse(BaseModel):
    job_id: str
    status: str  # queued | running | done | failed
    progress: int
    download_url: str | None
    error: str | None


async def _resolve_camera_and_server(camera_id: uuid.UUID, db: AsyncSession):
    cam_result = await db.execute(select(Camera).where(Camera.id == camera_id))
    cam = cam_result.scalar_one_or_none()
    if cam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")

    srv_result = await db.execute(
        select(FrigateServer).where(FrigateServer.id == cam.server_id)
    )
    server = srv_result.scalar_one_or_none()
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    return cam, server


@router.get("")
async def list_recordings(
    camera_id: uuid.UUID = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Proxy to Frigate GET /api/{camera}/recordings."""
    cam, server = await _resolve_camera_and_server(camera_id, db)
    try:
        segments = await FrigateService.get_client(server).get_recordings(
            cam.frigate_name,
            after=start.timestamp(),
            before=end.timestamp(),
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    return {"camera_id": str(camera_id), "camera_name": cam.frigate_name, "segments": segments}


def _rewrite_vod_manifest(content: bytes, camera_id: uuid.UUID) -> bytes:
    """Keep Frigate absolute VOD segment URLs on the OpenVMS API origin."""

    def replace(match: re.Match[bytes]) -> bytes:
        quote = match.group("quote")
        start = match.group("start").decode()
        end = match.group("end").decode()
        path = match.group("path").decode()
        return (
            quote
            + f"/api/v1/recordings/vod/{camera_id}/start/{start}/end/{end}/{path}".encode()
        )

    return _ABSOLUTE_VOD_RE.sub(replace, content)


@router.get("/vod/{camera_id}/start/{start}/end/{end}/{vod_path:path}")
async def get_vod_asset(
    camera_id: uuid.UUID,
    start: int,
    end: int,
    vod_path: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Proxy Frigate HLS VOD assets through the API origin to avoid browser CORS failures."""
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end must be after start",
        )

    cam, server = await _resolve_camera_and_server(camera_id, db)
    try:
        resp = await FrigateService.get_client(server).get(
            f"/vod/{cam.frigate_name}/start/{start}/end/{end}/{vod_path}"
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    content = resp.content
    content_type = resp.headers.get("content-type", "application/octet-stream")
    if vod_path.endswith(".m3u8"):
        content = _rewrite_vod_manifest(content, camera_id)
        content_type = "application/vnd.apple.mpegurl"

    return Response(content=content, media_type=content_type)


@router.post("/export", response_model=ExportStatusResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_export(
    body: ExportRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    _=Depends(get_current_user),
):
    """Create an async FFmpeg export job. Poll GET /recordings/export/{job_id} for status."""
    if body.end <= body.start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end must be after start",
        )
    if (body.end - body.start).total_seconds() > 86400:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Export range cannot exceed 24 hours",
        )

    cam, server = await _resolve_camera_and_server(body.camera_id, db)

    job_id = await export_service.create_job(
        camera_id=str(cam.id),
        frigate_camera_name=cam.frigate_name,
        server_id=str(server.id),
        start=body.start,
        end=body.end,
        redis=redis,
    )

    # Launch background task (fire-and-forget)
    asyncio.create_task(export_service.run_job(job_id, redis), name=f"export-{job_id}")

    return ExportStatusResponse(
        job_id=job_id,
        status="queued",
        progress=0,
        download_url=None,
        error=None,
    )


@router.get("/export/{job_id}", response_model=ExportStatusResponse)
async def get_export_status(
    job_id: str,
    redis=Depends(get_redis),
    _=Depends(get_current_user),
):
    job = await export_service.get_job(job_id, redis)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found or expired")

    return ExportStatusResponse(
        job_id=job_id,
        status=job["status"],
        progress=job.get("progress", 0),
        download_url=job.get("download_url"),
        error=job.get("error"),
    )


@router.get("/export/{job_id}/download")
async def download_export(
    job_id: str,
    redis=Depends(get_redis),
    _=Depends(get_current_user),
):
    job = await export_service.get_job(job_id, redis)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Export not ready (status: {job['status']})",
        )

    path = export_service.get_export_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file missing")

    return FileResponse(
        path=str(path),
        media_type="video/mp4",
        filename=f"export_{job_id[:8]}.mp4",
    )
