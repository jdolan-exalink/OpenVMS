import logging
import json
import uuid
from datetime import datetime, timezone
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
    ) -> Optional[int]:
        event_id = None

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
                    source="plugin",
                    severity=severity,
                    start_time=datetime.now(timezone.utc),
                    has_snapshot=False,
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
                    False,
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
                        False,
                    ),
                    default=str,
                ),
            )
        except Exception as exc:
            log.error("Failed to publish plugin alert via Redis: %s", exc)

        return event_id

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
    ) -> Optional[int]:
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
                    source=source,
                    severity=severity,
                    start_time=datetime.now(timezone.utc),
                    has_snapshot=False,
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
