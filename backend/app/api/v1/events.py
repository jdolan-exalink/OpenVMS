import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models.camera import Camera
from app.models.event import Event
from app.models.frigate_server import FrigateServer
from app.schemas.event import CursorPage, EventFilters, EventResponse
from app.services import event_service
from app.services.frigate_service import FrigateService

router = APIRouter()


@router.get("", response_model=CursorPage[EventResponse])
async def list_events(
    camera_id: uuid.UUID | None = Query(None),
    server_id: uuid.UUID | None = Query(None),
    label: str | None = Query(None),
    plate: str | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    zone: str | None = Query(None),
    score_min: float | None = Query(None),
    has_clip: bool | None = Query(None),
    has_snapshot: bool | None = Query(None),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=2000),
    source: str | None = Query(None),
    severity: str | None = Query(None),
    is_protected: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    filters = EventFilters(
        camera_id=camera_id,
        server_id=server_id,
        label=label,
        plate=plate,
        start=start,
        end=end,
        zone=zone,
        score_min=score_min,
        has_clip=has_clip,
        has_snapshot=has_snapshot,
        cursor=cursor,
        limit=limit,
        source=source,
        severity=severity,
        is_protected=is_protected,
    )
    return await event_service.list_events(db, filters)


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    evt = result.scalar_one_or_none()
    if evt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return EventResponse.model_validate(evt)


async def _get_frigate_server(event_id: int, db: AsyncSession):
    """Resolve the Frigate server for a given event ID."""
    result = await db.execute(select(Event).where(Event.id == event_id))
    evt = result.scalar_one_or_none()
    if evt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if evt.frigate_event_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Frigate event ID")

    server_result = await db.execute(
        select(FrigateServer).where(FrigateServer.id == evt.server_id)
    )
    server = server_result.scalar_one_or_none()
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    return evt, server


@router.get("/{event_id}/snapshot")
async def get_event_snapshot(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    evt, server = await _get_frigate_server(event_id, db)
    try:
        resp = await FrigateService.get_client(server).get(
            f"/api/events/{evt.frigate_event_id}/snapshot.jpg"
        )
        resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    return Response(content=resp.content, media_type="image/jpeg")


@router.get("/{event_id}/clip")
async def get_event_clip(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    evt, server = await _get_frigate_server(event_id, db)

    async def _stream():
        try:
            async for chunk in FrigateService.proxy_event_clip(server, evt.frigate_event_id):
                yield chunk
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    return StreamingResponse(_stream(), media_type="video/mp4")


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    evt = result.scalar_one_or_none()
    if evt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if evt.is_protected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete a protected event")

    # Also delete from Frigate if we have a frigate_event_id
    if evt.frigate_event_id and evt.server_id:
        server_result = await db.execute(
            select(FrigateServer).where(FrigateServer.id == evt.server_id)
        )
        server = server_result.scalar_one_or_none()
        if server:
            try:
                await FrigateService.get_client(server).delete(
                    f"/api/events/{evt.frigate_event_id}"
                )
            except Exception:
                pass  # best-effort deletion from Frigate

    await db.delete(evt)
    await db.commit()


@router.patch("/{event_id}/protect", response_model=EventResponse)
async def protect_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    evt = result.scalar_one_or_none()
    if evt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    evt.is_protected = True
    await db.commit()
    await db.refresh(evt)
    return EventResponse.model_validate(evt)


@router.patch("/{event_id}/unprotect", response_model=EventResponse)
async def unprotect_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    evt = result.scalar_one_or_none()
    if evt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    evt.is_protected = False
    await db.commit()
    await db.refresh(evt)
    return EventResponse.model_validate(evt)
