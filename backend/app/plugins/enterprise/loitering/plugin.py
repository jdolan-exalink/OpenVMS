from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import NamedTuple

from app.database import AsyncSessionLocal
from app.models.event import Event as EventModel
from app.plugins.base import BasePlugin


class ZoneConfig(NamedTuple):
    name: str
    polygon: list[tuple[int, int]]
    threshold_seconds: int
    labels: list[str]


class LoiteringPlugin(BasePlugin):
    name = "loitering"
    version = "1.0.0"
    description = "Detección de merodeo por permanencia prolongada en zona"
    supports_openvino = True
    min_ram_gb = 8
    category = "analytics"
    has_sidebar_page = True
    sidebar_icon = "👁"
    sidebar_label = "Merodeo"
    sidebar_route = "loitering"

    def __init__(self):
        self._zones: dict[str, list[ZoneConfig]] = {}
        self._track_entry_times: dict[str, dict[int, float]] = {}
        self._alerted_tracks: dict[str, dict[int, float]] = {}
        self._config: dict = {}

    async def on_load(self, config: dict) -> None:
        self._config = self._normalize_config(config)
        self._zones.clear()
        for cam_name, zones in self._config.get("zones", {}).items():
            self._zones[cam_name] = [
                ZoneConfig(
                    name=z["name"],
                    polygon=z["polygon"],
                    threshold_seconds=z.get("threshold_seconds", z.get("min_seconds", 60)),
                    labels=z.get("labels", ["person"]),
                )
                for z in zones
            ]

    def _normalize_config(self, config: dict) -> dict:
        normalized = {**config}
        normalized.setdefault("alert_cooldown", 300)
        zones_by_camera: dict = {}
        for camera_name, zones in (config.get("zones") or {}).items():
            normalized_zones = []
            for zone in zones or []:
                threshold = zone.get("threshold_seconds", zone.get("min_seconds", 60))
                normalized_zones.append({
                    **zone,
                    "name": zone.get("name") or "zona",
                    "threshold_seconds": threshold,
                    "min_seconds": threshold,
                    "labels": zone.get("labels", ["person"]),
                    "severity": zone.get("severity", "medium"),
                    "alert_cooldown": zone.get("alert_cooldown", normalized["alert_cooldown"]),
                })
            zones_by_camera[camera_name] = normalized_zones
        normalized["zones"] = zones_by_camera
        return normalized

    async def on_event(self, event: dict) -> None:
        camera_name = event.get("camera_name", "")
        if camera_name not in self._zones:
            return

        label = event.get("label", "")
        metadata = event.get("metadata", {})
        bbox = metadata.get("box")
        if not bbox:
            return

        track_id = metadata.get("track_id")
        if not track_id:
            return

        now = time.time()
        zones_for_cam = self._zones[camera_name]

        for zone in zones_for_cam:
                if label not in zone.labels:
                    continue

                center_x = (bbox.get("xmin", 0) + bbox.get("xmax", 0)) / 2
                center_y = (bbox.get("ymin", 0) + bbox.get("ymax", 0)) / 2

                if not self._point_in_polygon(center_x, center_y, zone.polygon):
                    self._track_entry_times.setdefault(camera_name, {}).pop(track_id, None)
                    continue

                entry_times = self._track_entry_times.setdefault(camera_name, {})
                if track_id not in entry_times:
                    entry_times[track_id] = now
                    continue

                time_in_zone = now - entry_times[track_id]
                if time_in_zone < zone.threshold_seconds:
                    continue

                alerted = self._alerted_tracks.setdefault(camera_name, {})
                last_alert = alerted.get(track_id, 0)
                cooldown = self._zone_config_dict(camera_name, zone.name).get(
                    "alert_cooldown", self._config.get("alert_cooldown", 300)
                )
                if now - last_alert < cooldown:
                    continue

                alerted[track_id] = now
                await self.emit_alert(
                    camera_id=event.get("camera_id", ""),
                    alert_type="loitering",
                    severity="medium",
                    data={
                        "track_id": track_id,
                        "zone_name": zone.name,
                        "time_in_zone_seconds": int(time_in_zone),
                        "label": label,
                        "camera_name": camera_name,
                        "event_id": event.get("id"),
                    },
                )
                await self._save_loitering_event(event, zone.name, time_in_zone, track_id)

    def get_routes(self) -> "APIRouter":
        from fastapi import APIRouter, Depends, Query
        from app.deps import get_current_user

        router = APIRouter()
        plugin_self = self

        @router.get("/zones")
        async def get_zones(_=Depends(get_current_user)):
            return {
                camera: [{"name": z.name, "polygon": z.polygon, "threshold_seconds": z.threshold_seconds, "labels": z.labels}
                         for z in zones]
                for camera, zones in plugin_self._zones.items()
            }

        @router.get("/stats")
        async def get_stats(_=Depends(get_current_user)):
            total_alerts = sum(len(t) for t in plugin_self._alerted_tracks.values())
            return {
                "active_zones": sum(len(z) for z in plugin_self._zones.values()),
                "tracks_tracked": sum(len(t) for t in plugin_self._track_entry_times.values()),
                "total_alerts": total_alerts,
            }

        @router.delete("/tracks/{track_id}")
        async def clear_track(
            track_id: int,
            camera_name: str = Query(...),
            _=Depends(get_current_user),
        ):
            plugin_self._track_entry_times.get(camera_name, {}).pop(track_id, None)
            plugin_self._alerted_tracks.get(camera_name, {}).pop(track_id, None)
            return {"ok": True}

        return router

    async def on_unload(self) -> None:
        self._zones.clear()
        self._track_entry_times.clear()
        self._alerted_tracks.clear()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "zones": {
                    "type": "object",
                    "title": "Zonas de merodeo",
                    "description": "Zonas por cámara. Key = camera_name",
                    "additionalProperties": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "polygon": {
                                    "type": "array",
                                    "items": {
                                        "type": "array",
                                        "items": {"type": "number"},
                                        "minItems": 2,
                                        "maxItems": 2,
                                    },
                                    "description": "Lista de [x, y] en píxeles",
                                },
                                "threshold_seconds": {
                                    "type": "integer",
                                    "default": 60,
                                    "description": "Segundos en zona para disparar alerta",
                                },
                                "min_seconds": {
                                    "type": "integer",
                                    "default": 60,
                                    "description": "Alias compatible para segundos mínimos en zona",
                                },
                                "alert_cooldown": {
                                    "type": "integer",
                                    "default": 300,
                                    "minimum": 0,
                                    "description": "Segundos entre alertas del mismo track en esta zona",
                                },
                                "severity": {
                                    "type": "string",
                                    "enum": ["low", "medium", "high", "critical"],
                                    "default": "medium",
                                },
                                "labels": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "default": ["person"],
                                },
                            },
                        },
                    },
                }
            },
        }

    def get_routes(self) -> "APIRouter":
        from fastapi import APIRouter, Depends, Query
        from app.deps import get_current_user

        router = APIRouter()
        plugin_self = self

        @router.get("/zones")
        async def get_zones(_=Depends(get_current_user)):
            return {
                camera: [{"name": z.name, "polygon": z.polygon, "threshold_seconds": z.threshold_seconds, "labels": z.labels}
                         for z in zones]
                for camera, zones in plugin_self._zones.items()
            }

        @router.get("/stats")
        async def get_stats(_=Depends(get_current_user)):
            total_alerts = sum(len(t) for t in plugin_self._alerted_tracks.values())
            return {
                "active_zones": sum(len(z) for z in plugin_self._zones.values()),
                "tracks_tracked": sum(len(t) for t in plugin_self._track_entry_times.values()),
                "total_alerts": total_alerts,
            }

        @router.delete("/tracks/{track_id}")
        async def clear_track(
            track_id: int,
            camera_name: str = Query(...),
            _=Depends(get_current_user),
        ):
            plugin_self._track_entry_times.get(camera_name, {}).pop(track_id, None)
            plugin_self._alerted_tracks.get(camera_name, {}).pop(track_id, None)
            return {"ok": True}

        return router
