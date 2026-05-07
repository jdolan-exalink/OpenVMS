import logging
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import structlog

from app.database import AsyncSessionLocal
from app.models.event import Event as EventModel

log = structlog.get_logger(__name__)

_websocket_broadcast: Optional[callable] = None


def set_websocket_broadcast(func: callable) -> None:
    global _websocket_broadcast
    _websocket_broadcast = func


class AlertService:
    @staticmethod
    async def emit(
        plugin_name: str,
        camera_id: str,
        alert_type: str,
        severity: str,
        data: dict,
        snapshot_bytes: Optional[bytes] = None,
        clip_path: Optional[str] = None,
    ) -> Optional[int]:
        if not snapshot_bytes:
            log.warning(
                "plugin=%s alert_type=%s: no snapshot provided — event dropped",
                plugin_name, alert_type,
            )
            return None

        event_id = None
        snapshot_path = AlertService._save_plugin_snapshot(plugin_name, alert_type, snapshot_bytes)
        if snapshot_path is None:
            log.warning(
                "plugin=%s alert_type=%s: snapshot could not be saved — event dropped",
                plugin_name, alert_type,
            )
            return None

        async with AsyncSessionLocal() as db:
            try:
                camera_uuid = None
                if camera_id:
                    try:
                        camera_uuid = uuid.UUID(str(camera_id))
                    except ValueError:
                        camera_uuid = None
                event = EventModel(
                    camera_id=camera_uuid,
                    label=alert_type,
                    source=f"plugin:{plugin_name}",
                    severity=severity,
                    start_time=datetime.now(timezone.utc),
                    has_clip=bool(clip_path),
                    has_snapshot=True,
                    snapshot_path=snapshot_path,
                    clip_path=clip_path,
                    extra_metadata={
                        "plugin": plugin_name,
                        "alert_type": alert_type,
                        **data,
                    },
                )
                db.add(event)
                await db.commit()
                await db.refresh(event)
                event_id = event.id
            except Exception as exc:
                log.error("Failed to persist plugin alert: %s", exc)

        if _websocket_broadcast is not None:
            try:
                await _websocket_broadcast(AlertService._plugin_alert_payload(
                    plugin_name,
                    alert_type,
                    severity,
                    camera_id,
                    event_id,
                    data,
                    True,
                ))
            except Exception as exc:
                log.error("Failed to broadcast plugin alert via WebSocket: %s", exc)

        try:
            from app.deps import get_redis

            redis = get_redis()
            await redis.publish(
                "vms:events",
                json.dumps(
                    AlertService._plugin_alert_payload(
                        plugin_name,
                        alert_type,
                        severity,
                        camera_id,
                        event_id,
                        data,
                        True,
                    ),
                    default=str,
                ),
            )
        except Exception as exc:
            log.error("Failed to publish plugin alert via Redis: %s", exc)

        return event_id

    @staticmethod
    def _save_plugin_snapshot(plugin_name: str, alert_type: str, snapshot_bytes: bytes) -> str | None:
        try:
            base_dir = Path(os.getenv("PLUGIN_SNAPSHOT_DIR", "/tmp/exports/plugin_snapshots"))
            safe_plugin = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in plugin_name)
            safe_type = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in alert_type)
            day = datetime.now(timezone.utc).strftime("%Y/%m/%d")
            out_dir = base_dir / safe_plugin / day
            out_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{datetime.now(timezone.utc).strftime('%H%M%S_%f')}_{safe_type}.jpg"
            path = out_dir / filename
            path.write_bytes(snapshot_bytes)
            return str(path)
        except Exception as exc:
            log.error("Failed to save plugin snapshot: %s", exc)
            return None

    @staticmethod
    def _plugin_alert_payload(
        plugin_name: str,
        alert_type: str,
        severity: str,
        camera_id: str,
        event_id: Optional[int],
        data: dict,
        has_snapshot: bool,
    ) -> dict:
        return {
            "type": "plugin_alert",
            "plugin": plugin_name,
            "alert_type": alert_type,
            "severity": severity,
            "camera_id": str(camera_id) if camera_id else "",
            "camera_name": data.get("camera_name"),
            "event_id": event_id,
            "data": data,
            "has_snapshot": has_snapshot,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    async def create_enterprise_event(
        camera_id: str,
        label: str,
        source: str,
        severity: str,
        metadata: dict,
        snapshot_bytes: Optional[bytes] = None,
    ) -> Optional[int]:
        if not snapshot_bytes:
            log.warning("source=%s label=%s: no snapshot provided — event dropped", source, label)
            return None
        snapshot_path = AlertService._save_plugin_snapshot(source.replace("plugin:", ""), label, snapshot_bytes)
        if snapshot_path is None:
            log.warning("source=%s label=%s: snapshot could not be saved — event dropped", source, label)
            return None
        async with AsyncSessionLocal() as db:
            try:
                camera_uuid = None
                if camera_id:
                    try:
                        camera_uuid = uuid.UUID(str(camera_id))
                    except ValueError:
                        camera_uuid = None
                event = EventModel(
                    camera_id=camera_uuid,
                    label=label,
                    source=source if source.startswith("plugin:") else source,
                    severity=severity,
                    start_time=datetime.now(timezone.utc),
                    has_snapshot=True,
                    snapshot_path=snapshot_path,
                    extra_metadata=metadata,
                )
                db.add(event)
                await db.commit()
                await db.refresh(event)
                return event.id
            except Exception as exc:
                log.error("Failed to create enterprise event: %s", exc)
                return None


alert_service = AlertService()
