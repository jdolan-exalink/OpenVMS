import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, require_admin
from app.models.camera import Camera
from app.models.frigate_server import FrigateServer
from app.schemas.camera import (
    CameraCreate,
    CameraListResponse,
    CameraResponse,
    CameraStreamResponse,
    CameraUpdate,
)
from app.services.frigate_service import FrigateService
from app.services.ome_service import OMEService

router = APIRouter()


async def _get_or_404(camera_id: uuid.UUID, db: AsyncSession) -> Camera:
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    cam = result.scalar_one_or_none()
    if cam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    return cam


@router.get("", response_model=CameraListResponse)
async def list_cameras(
    server_id: uuid.UUID | None = Query(None),
    tag: str | None = Query(None),
    enabled: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    q = select(Camera)
    if server_id is not None:
        q = q.where(Camera.server_id == server_id)
    if tag is not None:
        q = q.where(Camera.tags.contains([tag]))
    if enabled is not None:
        q = q.where(Camera.enabled == enabled)

    count_result = await db.execute(select(func.count()).select_from(q.subquery()))
    total = count_result.scalar_one()

    items_result = await db.execute(
        q.order_by(Camera.display_name).offset((page - 1) * page_size).limit(page_size)
    )
    return CameraListResponse(
        items=items_result.scalars().all(),
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
async def create_camera(
    body: CameraCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    server_result = await db.execute(
        select(FrigateServer).where(FrigateServer.id == body.server_id)
    )
    if server_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    ome_urls = OMEService.build_stream_urls(str(body.server_id), body.frigate_name)
    cam = Camera(**body.model_dump(), **ome_urls)
    db.add(cam)
    await db.commit()
    await db.refresh(cam)
    return cam


@router.get("/{camera_id}", response_model=CameraResponse)
async def get_camera(
    camera_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await _get_or_404(camera_id, db)


@router.put("/{camera_id}", response_model=CameraResponse)
async def update_camera(
    camera_id: uuid.UUID,
    body: CameraUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    cam = await _get_or_404(camera_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cam, field, value)
    await db.commit()
    await db.refresh(cam)
    return cam


@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(
    camera_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    cam = await _get_or_404(camera_id, db)
    await db.delete(cam)
    await db.commit()


@router.get("/{camera_id}/stream", response_model=CameraStreamResponse)
async def get_stream_urls(
    camera_id: uuid.UUID,
    grid_size: int = Query(4, ge=1, description="Total cells in grid (16 = 4×4, triggers substream)"),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    cam = await _get_or_404(camera_id, db)
    if not cam.enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera disabled")
    urls = OMEService.get_stream_for_grid(cam, grid_size)
    return CameraStreamResponse(**urls)


@router.get("/{camera_id}/snapshot")
async def get_snapshot(
    camera_id: uuid.UUID,
    height: int | None = Query(None, ge=120, le=2160),
    quality: int | None = Query(None, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    cam = await _get_or_404(camera_id, db)
    server_result = await db.execute(
        select(FrigateServer).where(FrigateServer.id == cam.server_id)
    )
    server = server_result.scalar_one_or_none()
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    try:
        image = await FrigateService.get_snapshot(
            server,
            cam.frigate_name,
            height=height,
            quality=quality,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    return Response(content=image, media_type="image/jpeg")


@router.post("/{camera_id}/ptz")
async def ptz_command(
    camera_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    cam = await _get_or_404(camera_id, db)
    if not cam.has_ptz:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Camera has no PTZ")

    action: str | None = body.get("action")
    if not action:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="action is required"
        )

    server_result = await db.execute(
        select(FrigateServer).where(FrigateServer.id == cam.server_id)
    )
    server = server_result.scalar_one_or_none()
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    return await FrigateService.get_client(server).ptz_move(
        cam.frigate_name, action, body.get("speed", 1.0)
    )
