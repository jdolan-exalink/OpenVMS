"""
LPR (License Plate Recognition) Plugin

Processes Frigate events that contain plate numbers (via sub_label).
Stores detections in lpr_events, checks against lpr_blacklist,
and fires WebSocket alerts when a blacklisted plate is detected.

Routes mounted at /api/v1/plugins/lpr/:
  GET  /plates               → paginated plate history
  GET  /search?plate=ABC123  → search plates (partial match)
  POST /blacklist            → add plate to blacklist
  GET  /blacklist            → list blacklisted plates
  DELETE /blacklist/{id}     → remove plate from blacklist
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_operator
from app.models.plugins import LprBlacklist, LprEvent
from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class LprEventOut(BaseModel):
    id: int
    plate_number: str
    plate_score: float | None
    camera_id: str | None
    server_id: str | None
    is_blacklisted: bool
    detected_at: datetime
    model_config = {"from_attributes": True}


class BlacklistCreate(BaseModel):
    plate_number: str
    reason: str | None = None


class BlacklistOut(BaseModel):
    id: int
    plate_number: str
    reason: str | None
    added_at: datetime
    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────────────────────

_router = APIRouter()


@_router.get("/plates", response_model=list[LprEventOut])
async def list_plates(
    camera_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    from sqlalchemy import select
    q = select(LprEvent).order_by(LprEvent.detected_at.desc()).limit(limit)
    if camera_id:
        q = q.where(LprEvent.camera_id == camera_id)
    result = await db.execute(q)
    return result.scalars().all()


@_router.get("/search", response_model=list[LprEventOut])
async def search_plates(
    plate: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    from sqlalchemy import select
    result = await db.execute(
        select(LprEvent)
        .where(LprEvent.plate_number.ilike(f"%{plate}%"))
        .order_by(LprEvent.detected_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@_router.post("/blacklist", response_model=BlacklistOut, status_code=status.HTTP_201_CREATED)
async def add_to_blacklist(
    body: BlacklistCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_operator),
):
    from sqlalchemy import select
    existing = await db.execute(
        select(LprBlacklist).where(LprBlacklist.plate_number == body.plate_number.upper())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Plate already blacklisted")
    entry = LprBlacklist(
        plate_number=body.plate_number.upper(),
        reason=body.reason,
        added_by=str(current_user.id),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@_router.get("/blacklist", response_model=list[BlacklistOut])
async def list_blacklist(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    from sqlalchemy import select
    result = await db.execute(select(LprBlacklist).order_by(LprBlacklist.added_at.desc()))
    return result.scalars().all()


@_router.delete("/blacklist/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_blacklist(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_operator),
):
    from sqlalchemy import select
    result = await db.execute(select(LprBlacklist).where(LprBlacklist.id == entry_id))
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    await db.delete(entry)
    await db.commit()


# ── Plugin class ──────────────────────────────────────────────────────────────

class LPRPlugin(BasePlugin):
    name = "lpr"
    display_name = "LPR Básico"
    version = "1.0.0"
    description = "Procesa sub_labels de Frigate para almacenar detecciones de matrículas y gestionar lista negra de vehículos"
    category = "recognition"
    has_sidebar_page = True
    sidebar_icon = "🚗"
    sidebar_label = "LPR Básico"
    sidebar_route = "lpr"

    def __init__(self):
        self._config: dict = {}
        self._last_detection: dict[str, float] = {}
        self._last_alert: dict[str, float] = {}

    async def on_load(self, config: dict) -> None:
        self._config = self._normalize_config(config)
        log.info("LPR plugin loaded")

    def _normalize_config(self, config: dict) -> dict:
        return {
            "enabled_cameras": config.get("enabled_cameras", []),
            "detection_cooldown": int(config.get("detection_cooldown", 10)),
            "alert_cooldown": int(config.get("alert_cooldown", 60)),
            "plate_regex": config.get("plate_regex", r"^[A-Z0-9]{5,8}$"),
            "min_score": float(config.get("min_score", 0.0)),
        }

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "title": "Configuración LPR",
            "properties": {
                "detection_cooldown": {
                    "type": "integer",
                    "title": "Cooldown detección (s)",
                    "description": "Segundos mínimos entre detecciones del mismo vehículo",
                    "default": 10,
                    "minimum": 1,
                    "maximum": 300,
                },
                "alert_cooldown": {
                    "type": "integer",
                    "title": "Cooldown alerta (s)",
                    "description": "Segundos entre alertas de la misma matrícula en lista negra",
                    "default": 60,
                    "minimum": 5,
                    "maximum": 3600,
                },
                "min_score": {
                    "type": "number",
                    "title": "Confianza mínima",
                    "description": "Ignora matrículas por debajo de esta confianza cuando Frigate informa score.",
                    "default": 0.0,
                    "minimum": 0.0,
                    "maximum": 1.0,
                },
                "plate_regex": {
                    "type": "string",
                    "title": "Formato válido",
                    "description": "Regex de validación para descartar lecturas claramente inválidas.",
                    "default": "^[A-Z0-9]{5,8}$",
                },
                "enabled_cameras": {
                    "type": "array",
                    "title": "Cámaras habilitadas",
                    "description": "Dejar vacío para procesar todas las cámaras",
                    "items": {"type": "string"},
                    "default": [],
                },
            },
        }

    async def on_event(self, event: dict) -> None:
        label: str = event.get("label", "")
        plate: str | None = event.get("plate_number") or event.get("sub_label")

        # Only process car events with a detected plate
        if label not in ("car", "truck", "bus", "motorcycle") or not plate:
            return

        camera_name = event.get("camera_name")
        enabled_cameras = self._config.get("enabled_cameras") or []
        if enabled_cameras and camera_name not in enabled_cameras and event.get("camera_id") not in enabled_cameras:
            return

        plate = self._normalize_plate(plate)
        if not plate:
            return

        score = event.get("plate_score") or event.get("score")
        if score is not None and float(score) < self._config.get("min_score", 0.0):
            return

        cooldown_key = f"{event.get('camera_id') or camera_name}:{plate}"
        now_ts = datetime.now(timezone.utc).timestamp()
        last_detection = self._last_detection.get(cooldown_key, 0)
        if now_ts - last_detection < self._config.get("detection_cooldown", 10):
            return
        self._last_detection[cooldown_key] = now_ts

        camera_id: str | None = event.get("camera_id")
        server_id: str | None = event.get("server_id")

        from app.database import AsyncSessionLocal
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            # Check blacklist
            bl_result = await db.execute(
                select(LprBlacklist).where(LprBlacklist.plate_number == plate)
            )
            is_blacklisted = bl_result.scalar_one_or_none() is not None

            # Store detection
            lpr_evt = LprEvent(
                event_id=event.get("id"),
                camera_id=camera_id,
                server_id=server_id,
                plate_number=plate,
                plate_score=score,
                is_blacklisted=is_blacklisted,
                detected_at=datetime.now(timezone.utc),
            )
            db.add(lpr_evt)
            await db.commit()

        # Fire WebSocket alert if blacklisted
        if is_blacklisted:
            last_alert = self._last_alert.get(cooldown_key, 0)
            if now_ts - last_alert < self._config.get("alert_cooldown", 60):
                return
            self._last_alert[cooldown_key] = now_ts
            try:
                from app.deps import get_redis
                redis = get_redis()
                alert = json.dumps({
                    "type": "lpr_alert",
                    "plate_number": plate,
                    "camera_id": camera_id,
                    "server_id": server_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                await redis.publish("vms:events", alert)
            except Exception as exc:
                log.warning("LPR alert publish failed: %s", exc)

    def get_routes(self) -> APIRouter:
        return _router

    def _normalize_plate(self, plate: str) -> str | None:
        value = re.sub(r"[^A-Z0-9]", "", str(plate).upper())
        if not value:
            return None
        pattern = self._config.get("plate_regex") or r"^[A-Z0-9]{5,8}$"
        try:
            if not re.match(pattern, value):
                return None
        except re.error:
            log.warning("Invalid LPR plate_regex configured: %s", pattern)
        return value
