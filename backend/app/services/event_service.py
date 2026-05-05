"""
EventService

Normalizes Frigate MQTT payloads → PostgreSQL events table → Redis pub/sub.

Frigate publishes to 'frigate/events' a JSON envelope:
  {
    "type": "new" | "update" | "end",
    "before": null | {...},
    "after": {
      "id": "1700000000.123456-abc123",
      "camera": "cam_name",
      "label": "person",
      "sub_label": null,
      "score": 0.95,
      "top_score": 0.95,
      "start_time": 1700000000.0,   # Unix float
      "end_time": null | float,
      "has_clip": false,
      "has_snapshot": true,
      "zones": ["zona_x"],
      ...
    }
  }
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, or_, and_, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.camera import Camera
from app.models.event import Event
from app.schemas.event import (
    CursorPage,
    EventFilters,
    EventResponse,
    decode_cursor,
    encode_cursor,
)

log = logging.getLogger(__name__)

# Cache: (server_id_str, camera_name) → (detect_width, detect_height)
_detect_dims_cache: dict[tuple[str, str], tuple[int, int]] = {}


def _unix_to_dt(ts: float | None) -> datetime | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc)


async def _resolve_camera_id(
    server_id: UUID, frigate_camera_name: str, db: AsyncSession
) -> UUID | None:
    result = await db.execute(
        select(Camera.id).where(
            Camera.server_id == server_id,
            Camera.frigate_name == frigate_camera_name,
        )
    )
    row = result.scalar_one_or_none()
    return row


async def _get_detect_dims(
    server_id: UUID, camera_name: str, db: AsyncSession
) -> tuple[int, int]:
    key = (str(server_id), camera_name)
    if key in _detect_dims_cache:
        return _detect_dims_cache[key]

    dims = (640, 360)  # safe fallback
    try:
        from app.models.frigate_server import FrigateServer
        import httpx

        result = await db.execute(select(FrigateServer).where(FrigateServer.id == server_id))
        server = result.scalar_one_or_none()
        if server and server.url:
            url = server.url.rstrip("/") + "/api/config"
            async with httpx.AsyncClient(timeout=3.0) as client:
                headers = {}
                if server.api_key:
                    headers["X-API-Key"] = server.api_key
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                cfg = resp.json()
            detect = cfg.get("cameras", {}).get(camera_name, {}).get("detect", {})
            w = detect.get("width") or 640
            h = detect.get("height") or 360
            dims = (int(w), int(h))
    except Exception as exc:
        log.warning("Could not fetch detect dims for %s/%s: %s", server_id, camera_name, exc)

    _detect_dims_cache[key] = dims
    return dims


async def process_mqtt_message(
    server_id: UUID,
    topic: str,
    payload: bytes,
    db: AsyncSession,
    redis: object,
) -> None:
    """
    Entry point called by MQTTService for every received message.
    Handles frigate/events and frigate/stats topics.
    """
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        log.warning("Non-JSON MQTT payload on topic %s", topic)
        return

    if "events" in topic:
        await _handle_event(server_id, data, db, redis)
    # stats topic: could update server last_seen, skip for now


async def _handle_event(
    server_id: UUID,
    data: dict,
    db: AsyncSession,
    redis: object,
) -> None:
    after = data.get("after")
    if not after:
        return

    frigate_event_id: str = after.get("id", "")
    if not frigate_event_id:
        return

    camera_name: str = after.get("camera", "")
    camera_id = await _resolve_camera_id(server_id, camera_name, db)

    label: str = after.get("label", "unknown")
    sub_label: str | None = after.get("sub_label") or None
    score_raw = after.get("score") or after.get("top_score")
    score = Decimal(str(score_raw)).quantize(Decimal("0.01")) if score_raw else None

    start_time = _unix_to_dt(after.get("start_time"))
    end_time = _unix_to_dt(after.get("end_time"))

    zones: list[str] = after.get("zones") or []
    has_clip: bool = bool(after.get("has_clip", False))
    has_snapshot: bool = bool(after.get("has_snapshot", False))

    # LPR data may live in sub_label
    plate_number: str | None = sub_label if label == "car" and sub_label else None

    if start_time is None:
        log.warning("Event %s missing start_time, skipping", frigate_event_id)
        return

    if not has_clip and not has_snapshot:
        log.debug("Event %s has no clip and no snapshot, skipping", frigate_event_id)
        return

    # Upsert — on conflict update mutable fields
    stmt = (
        pg_insert(Event)
        .values(
            frigate_event_id=frigate_event_id,
            server_id=server_id,
            camera_id=camera_id,
            label=label,
            sub_label=sub_label,
            event_type=data.get("type", "detection"),
            start_time=start_time,
            end_time=end_time,
            score=score,
            zones=zones,
            has_clip=has_clip,
            has_snapshot=has_snapshot,
            plate_number=plate_number,
            extra_metadata={},
        )
        .on_conflict_do_update(
            index_elements=["frigate_event_id"],
            set_={
                "end_time": end_time,
                "has_clip": has_clip,
                "has_snapshot": has_snapshot,
                "score": score,
                "sub_label": sub_label,
                "plate_number": plate_number,
                "zones": zones,
            },
        )
        .returning(Event.id, Event.start_time)
    )

    result = await db.execute(stmt)
    row = result.fetchone()
    await db.commit()

    if row is None:
        return

    event_id, event_start_time = row

    # Normalize bounding box from Frigate format ([xmin,ymin,xmax,ymax] list → dict)
    after_box = after.get("box")
    box_dict: dict = {}
    if isinstance(after_box, (list, tuple)) and len(after_box) >= 4:
        box_dict = {
            "xmin": float(after_box[0]),
            "ymin": float(after_box[1]),
            "xmax": float(after_box[2]),
            "ymax": float(after_box[3]),
        }
    elif isinstance(after_box, dict):
        box_dict = {k: float(v) for k, v in after_box.items()}

    detect_width, detect_height = await _get_detect_dims(server_id, camera_name, db)

    # Centroid in Frigate detect-space pixels plus normalized 0-1 coordinates.
    raw_cx = (box_dict.get("xmin", 0) + box_dict.get("xmax", 0)) / 2 if box_dict else None
    raw_cy = (box_dict.get("ymin", 0) + box_dict.get("ymax", 0)) / 2 if box_dict else None
    box_norm: dict = {}
    cx = cy = None
    if box_dict and detect_width > 0 and detect_height > 0:
        box_norm = {
            "xmin": box_dict.get("xmin", 0) / detect_width,
            "ymin": box_dict.get("ymin", 0) / detect_height,
            "xmax": box_dict.get("xmax", 0) / detect_width,
            "ymax": box_dict.get("ymax", 0) / detect_height,
        }
        cx = raw_cx / detect_width if raw_cx is not None else None
        cy = raw_cy / detect_height if raw_cy is not None else None

    # Publish to Redis pub/sub for WebSocket broadcast
    ws_payload = json.dumps(
        {
            "type": "event",
            "id": event_id,
            "frigate_event_id": frigate_event_id,
            "server_id": str(server_id),
            "camera_id": str(camera_id) if camera_id else None,
            "camera_name": camera_name,
            "label": label,
            "sub_label": sub_label,
            "score": float(score) if score else None,
            "plate_number": plate_number,
            "has_clip": has_clip,
            "has_snapshot": has_snapshot,
            "zones": zones,
            "snapshot_url": f"/api/v1/events/{event_id}/snapshot" if has_snapshot else None,
            "timestamp": start_time.isoformat(),
        }
    )
    await redis.publish("vms:events", ws_payload)  # type: ignore[attr-defined]

    # Dispatch to plugin registry — includes tracking fields not in WS payload
    try:
        from app.plugins.registry import plugin_registry

        event_dict = json.loads(ws_payload)
        # track_id: persistent Frigate event ID (stays constant across new/update/end)
        event_dict["track_id"] = frigate_event_id
        event_dict["box"] = box_dict            # Frigate detect-space pixels
        event_dict["box_norm"] = box_norm       # normalized 0-1
        event_dict["raw_cx"] = raw_cx
        event_dict["raw_cy"] = raw_cy
        event_dict["cx"] = cx                   # normalized centroid X 0-1
        event_dict["cy"] = cy                   # normalized centroid Y 0-1
        event_dict["detect_width"] = detect_width
        event_dict["detect_height"] = detect_height
        event_dict["mqtt_type"] = data.get("type", "update")  # "new"/"update"/"end"
        event_dict["metadata"] = {
            "track_id": frigate_event_id,
            "box": box_dict,
            "box_norm": box_norm,
            "raw_cx": raw_cx,
            "raw_cy": raw_cy,
            "cx": cx,
            "cy": cy,
            "detect_width": detect_width,
            "detect_height": detect_height,
        }
        await plugin_registry.dispatch_event(event_dict)
    except Exception as exc:
        log.warning("Plugin dispatch error: %s", exc)


async def list_events(
    db: AsyncSession, filters: EventFilters
) -> CursorPage[EventResponse]:
    q = select(Event).order_by(Event.start_time.desc(), Event.id.desc())

    if filters.camera_id is not None:
        q = q.where(Event.camera_id == filters.camera_id)
    if filters.server_id is not None:
        q = q.where(Event.server_id == filters.server_id)
    if filters.label is not None:
        q = q.where(Event.label == filters.label)
    if filters.plate is not None:
        q = q.where(Event.plate_number.ilike(f"%{filters.plate}%"))
    if filters.start is not None:
        q = q.where(Event.start_time >= filters.start)
    if filters.end is not None:
        q = q.where(Event.start_time <= filters.end)
    if filters.zone is not None:
        q = q.where(Event.zones.contains([filters.zone]))
    if filters.score_min is not None:
        q = q.where(Event.score >= Decimal(str(filters.score_min)))
    if filters.has_clip is not None:
        q = q.where(Event.has_clip == filters.has_clip)
    if filters.has_snapshot is not None:
        q = q.where(Event.has_snapshot == filters.has_snapshot)
    if filters.has_clip is None and filters.has_snapshot is None:
        q = q.where(or_(Event.has_clip == True, Event.has_snapshot == True))
    if filters.source is not None:
        if filters.source == "plugin":
            q = q.where(Event.source.ilike("plugin:%"))
        else:
            q = q.where(Event.source == filters.source)
    if filters.severity is not None:
        q = q.where(Event.severity == filters.severity)
    if filters.is_protected is not None:
        q = q.where(Event.is_protected == filters.is_protected)

    # Keyset cursor: (start_time, id) < (cursor_start_time, cursor_id)
    if filters.cursor:
        try:
            cursor_time, cursor_id = decode_cursor(filters.cursor)
            q = q.where(
                or_(
                    Event.start_time < cursor_time,
                    and_(Event.start_time == cursor_time, Event.id < cursor_id),
                )
            )
        except Exception:
            pass  # malformed cursor → ignore, return from beginning

    q = q.limit(filters.limit + 1)  # fetch one extra to detect next page

    result = await db.execute(q)
    rows = result.scalars().all()

    has_next = len(rows) > filters.limit
    items = rows[: filters.limit]

    next_cursor: str | None = None
    if has_next and items:
        last = items[-1]
        next_cursor = encode_cursor(last.start_time, last.id)

    return CursorPage(
        items=[EventResponse.model_validate(e) for e in items],
        next_cursor=next_cursor,
    )
