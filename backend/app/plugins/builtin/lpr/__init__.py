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

import logging
import re
from datetime import datetime, timezone
from decimal import Decimal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_operator
from app.models.event import Event as VmsEvent
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
    event_id: int | None = None
    country: str | None = None
    syntax_valid: bool = True
    frames_used: int = 1
    raw_plate: str | None = None
    final_confidence: float | None = None
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
    return [_enrich_lpr_event(row) for row in result.scalars().all()]


@_router.get("/search", response_model=list[LprEventOut])
async def search_plates(
    plate: str = Query(..., min_length=1),
    fuzzy: bool = Query(True),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    from sqlalchemy import select
    query_plate = _normalize_plate_value(plate)
    q = select(LprEvent).order_by(LprEvent.detected_at.desc()).limit(limit)
    if query_plate and not fuzzy:
        q = q.where(LprEvent.plate_number.ilike(f"%{query_plate}%"))
    elif query_plate:
        q = q.where(sa.or_(
            LprEvent.plate_number.ilike(f"%{query_plate}%"),
            sa.func.length(LprEvent.plate_number).between(max(1, len(query_plate) - 2), len(query_plate) + 2),
        ))
    result = await db.execute(q)
    rows = result.scalars().all()
    if fuzzy and query_plate:
        rows = sorted(
            rows,
            key=lambda row: (_plate_distance(query_plate, row.plate_number), row.detected_at),
            reverse=False,
        )[:limit]
    return [_enrich_lpr_event(row) for row in rows]


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
        self._fusion_tracks: dict[str, dict] = {}

    async def on_load(self, config: dict) -> None:
        self._config = self._normalize_config(config)
        log.info("LPR plugin loaded")

    def _normalize_config(self, config: dict) -> dict:
        return {
            "enabled_cameras": config.get("enabled_cameras", []),
            "detection_cooldown": int(config.get("detection_cooldown", 10)),
            "alert_cooldown": int(config.get("alert_cooldown", 60)),
            "plate_regex": config.get("plate_regex", r"^[A-Z0-9]{5,8}$"),
            "country": config.get("country", "AR"),
            "enable_ocr_correction": bool(config.get("enable_ocr_correction", True)),
            "min_frames": int(config.get("min_frames", 1)),
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
                "country": {
                    "type": "string",
                    "title": "País / región",
                    "default": "AR",
                    "description": "Región usada para validar formato y correcciones OCR.",
                },
                "enable_ocr_correction": {
                    "type": "boolean",
                    "title": "Corrección OCR contextual",
                    "default": True,
                },
                "min_frames": {
                    "type": "integer",
                    "title": "Frames mínimos para fusionar",
                    "default": 1,
                    "minimum": 1,
                    "maximum": 20,
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

        raw_plate = str(plate)
        plate_info = self._normalize_plate(raw_plate)
        if not plate_info:
            return
        plate = plate_info["plate"]

        score = event.get("plate_score") or event.get("score")
        if score is not None and float(score) < self._config.get("min_score", 0.0):
            return

        track_id = event.get("track_id") or event.get("id") or plate
        camera_key = str(event.get("camera_id") or camera_name or "unknown")
        fusion_key = f"{camera_key}:{track_id}"
        now_ts = datetime.now(timezone.utc).timestamp()
        fusion = self._update_fusion_track(fusion_key, plate, score, now_ts, raw_plate)
        if fusion["frames_used"] < self._config.get("min_frames", 1):
            return

        plate = fusion["plate"]
        final_score = fusion["confidence"]
        cooldown_key = f"{camera_key}:{plate}"
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
            bl_entry = bl_result.scalar_one_or_none()
            is_blacklisted = bl_entry is not None
            severity = "critical" if is_blacklisted else "info"
            metadata = {
                "plugin": "lpr",
                "alert_type": "lpr_plate",
                "plate": plate,
                "plate_number": plate,
                "ocr_raw": raw_plate,
                "country": plate_info["country"],
                "syntax_valid": plate_info["syntax_valid"],
                "format": plate_info["format"],
                "confidence": final_score,
                "final_confidence": final_score,
                "frames_used": fusion["frames_used"],
                "tracking_id": str(track_id),
                "camera_name": camera_name,
                "vehicle_type": label,
                "is_blacklisted": is_blacklisted,
                "blacklist_reason": getattr(bl_entry, "reason", None),
                "dedupe_window_seconds": self._config.get("detection_cooldown", 10),
            }

            vms_event = VmsEvent(
                frigate_event_id=None,
                camera_id=camera_id,
                server_id=server_id,
                label="blacklisted_plate" if is_blacklisted else "lpr",
                sub_label=plate,
                event_type="lpr_plate",
                source="plugin:lpr",
                severity=severity,
                start_time=datetime.now(timezone.utc),
                score=_score_decimal(final_score),
                zones=event.get("zones") or [],
                has_clip=bool(event.get("has_clip", False)),
                has_snapshot=bool(event.get("has_snapshot", False)),
                snapshot_path=event.get("snapshot_path"),
                clip_path=event.get("clip_path"),
                plate_number=plate,
                plate_score=_score_decimal(final_score),
                extra_metadata=metadata,
            )
            db.add(vms_event)
            await db.flush()

            # Store detection
            lpr_evt = LprEvent(
                event_id=vms_event.id,
                camera_id=camera_id,
                server_id=server_id,
                plate_number=plate,
                plate_score=final_score,
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
                await self.emit_alert(
                    camera_id=camera_id or camera_name,
                    alert_type="blacklisted_plate",
                    severity="critical",
                    data={
                        "plate": plate,
                        "plate_number": plate,
                        "camera_id": camera_id,
                        "camera_name": camera_name,
                        "server_id": server_id,
                        "reason": metadata["blacklist_reason"],
                        "confidence": final_score,
                        "event_id": getattr(vms_event, "id", None),
                    },
                )
            except Exception as exc:
                log.warning("LPR alert publish failed: %s", exc)

    def get_routes(self) -> APIRouter:
        return _router

    def _normalize_plate(self, plate: str) -> dict | None:
        value = _normalize_plate_value(plate)
        if not value:
            return None
        country = str(self._config.get("country") or "AR").upper()
        corrected = _correct_plate_ocr(value, country) if self._config.get("enable_ocr_correction", True) else value
        pattern = self._config.get("plate_regex") or r"^[A-Z0-9]{5,8}$"
        try:
            if not re.match(pattern, corrected):
                return None
        except re.error:
            log.warning("Invalid LPR plate_regex configured: %s", pattern)
        fmt = _plate_format(corrected, country)
        return {
            "plate": corrected,
            "country": country,
            "syntax_valid": fmt != "generic",
            "format": fmt,
        }

    def _update_fusion_track(self, key: str, plate: str, score: float | None, now_ts: float, raw_plate: str) -> dict:
        ttl = max(float(self._config.get("detection_cooldown", 10)), 1.0) * 2
        track = self._fusion_tracks.get(key)
        if not track or now_ts - track.get("updated_at", 0) > ttl:
            track = {"votes": {}, "scores": {}, "raw": [], "updated_at": now_ts}
            self._fusion_tracks[key] = track
        track["updated_at"] = now_ts
        track["votes"][plate] = track["votes"].get(plate, 0) + 1
        track["scores"].setdefault(plate, []).append(float(score) if score is not None else 0.5)
        track["raw"].append(raw_plate)
        best = max(track["votes"], key=lambda candidate: (track["votes"][candidate], sum(track["scores"][candidate]) / len(track["scores"][candidate])))
        avg_score = sum(track["scores"][best]) / len(track["scores"][best])
        consistency = track["votes"][best] / max(1, sum(track["votes"].values()))
        confidence = min(1.0, (avg_score * 0.75) + (consistency * 0.25))
        return {
            "plate": best,
            "confidence": confidence,
            "frames_used": sum(track["votes"].values()),
            "raw_values": track["raw"][-10:],
        }


def _score_decimal(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(round(max(0.0, min(1.0, float(value))), 2)))


def _normalize_plate_value(plate: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(plate).upper())


def _correct_plate_ocr(value: str, country: str) -> str:
    if country != "AR":
        return value
    formats = [(r"LLLDDD", 6), (r"LLDDDLL", 7), (r"LDDDLLL", 7)]
    best = value
    for mask, length in formats:
        if len(value) != length:
            continue
        chars = list(value)
        for idx, kind in enumerate(mask):
            if kind == "L":
                chars[idx] = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}.get(chars[idx], chars[idx])
            else:
                chars[idx] = {"O": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8"}.get(chars[idx], chars[idx])
        candidate = "".join(chars)
        if _plate_format(candidate, country) != "generic":
            return candidate
        best = candidate
    return best


def _plate_format(value: str, country: str) -> str:
    if country == "AR":
        if re.fullmatch(r"[A-Z]{3}\d{3}", value):
            return "AR_OLD_ABC123"
        if re.fullmatch(r"[A-Z]{2}\d{3}[A-Z]{2}", value):
            return "AR_MERCOSUR_AB123CD"
        if re.fullmatch(r"[A-Z]\d{3}[A-Z]{3}", value):
            return "AR_MOTO_A001AAA"
    return "generic"


def _plate_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = curr
    return prev[-1]


def _enrich_lpr_event(row: LprEvent) -> dict:
    data = {
        "id": row.id,
        "event_id": row.event_id,
        "plate_number": row.plate_number,
        "plate_score": float(row.plate_score) if row.plate_score is not None else None,
        "camera_id": row.camera_id,
        "server_id": row.server_id,
        "is_blacklisted": row.is_blacklisted,
        "detected_at": row.detected_at,
        "country": None,
        "syntax_valid": True,
        "frames_used": 1,
        "raw_plate": None,
        "final_confidence": float(row.plate_score) if row.plate_score is not None else None,
    }
    return data
