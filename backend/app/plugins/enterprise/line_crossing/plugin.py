from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from app.database import AsyncSessionLocal
from app.models.event import Event as EventModel
from app.plugins.base import BasePlugin


class LineCrossingPlugin(BasePlugin):
    name = "line_crossing"
    version = "1.0.0"
    description = "Detección de cruce de línea virtual con dirección"
    supports_openvino = True
    min_ram_gb = 8
    category = "analytics"
    has_sidebar_page = True
    sidebar_icon = "➡"
    sidebar_label = "Cruce de línea"
    sidebar_route = "line_crossing"

    def __init__(self):
        self._config: dict = {}
        self._prev_positions: dict[str, dict[str, dict[str, tuple[float, float]]]] = {}
        self._last_alerts: dict[str, dict[str, float]] = {}

    async def on_load(self, config: dict) -> None:
        self._config = self._normalize_config(config)

    def _normalize_config(self, config: dict) -> dict:
        normalized = {**config}
        lines_by_camera: dict = {}
        for camera_name, lines in (config.get("lines") or {}).items():
            normalized_lines = []
            for line in lines or []:
                normalized_lines.append({
                    **line,
                    "name": line.get("name") or "linea",
                    "directions": line.get("directions") or ["AB", "BA"],
                    "severity": line.get("severity", "medium"),
                    "enter_direction": line.get("enter_direction", "AB"),
                    "alert_cooldown": float(line.get("alert_cooldown", config.get("alert_cooldown", 10))),
                    "labels": line.get("labels", []),
                })
            lines_by_camera[camera_name] = normalized_lines
        normalized["lines"] = lines_by_camera
        return normalized

    async def on_event(self, event: dict) -> None:
        camera_name = event.get("camera_name", "")
        lines = self._config.get("lines", {}).get(camera_name, [])
        if not lines:
            return

        metadata = event.get("metadata", {})
        track_id = event.get("track_id") or metadata.get("track_id")
        if not track_id:
            return

        mqtt_type = event.get("mqtt_type", "update")
        if mqtt_type == "end":
            self._prev_positions.get(camera_name, {}).pop(track_id, None)
            return

        positions = self._extract_positions(event)
        if positions is None:
            return

        prev_pos = self._get_prev_position(camera_name, track_id)
        self._save_position(camera_name, track_id, positions)

        if prev_pos is None:
            return

        for line_cfg in lines:
            allowed_labels = line_cfg.get("labels", [])
            if allowed_labels and event.get("label", "") not in allowed_labels:
                continue

            line_scale = self._line_scale(line_cfg)
            direction = self._check_line_crossing(
                prev_pos[line_scale],
                positions[line_scale],
                line_cfg["p1"],
                line_cfg["p2"],
            )
            if direction is None:
                continue

            allowed = line_cfg.get("directions", ["AB", "BA"])
            if "BOTH" not in allowed and direction not in allowed:
                continue

            if not self._cooldown_allows(camera_name, str(track_id), line_cfg, event):
                continue

            await self.emit_alert(
                camera_id=event.get("camera_id", ""),
                alert_type="line_crossing",
                severity=line_cfg.get("severity", "medium"),
                data={
                    "line_name": line_cfg.get("name", "unknown"),
                    "direction": direction,
                    "movement": self._movement_for_direction(direction, line_cfg),
                    "track_id": track_id,
                    "label": event.get("label", ""),
                    "camera_name": camera_name,
                    "event_id": event.get("id"),
                },
            )
            await self._save_crossing_event(event, line_cfg, direction, track_id)

    def _get_prev_position(
        self, camera_name: str, track_id: str
    ) -> Optional[dict[str, tuple[float, float]]]:
        return self._prev_positions.get(camera_name, {}).get(track_id)

    def _save_position(
        self, camera_name: str, track_id: str, pos: dict[str, tuple[float, float]]
    ) -> None:
        self._prev_positions.setdefault(camera_name, {})[track_id] = pos

    @staticmethod
    def _line_scale(line_cfg: dict) -> str:
        points = [*(line_cfg.get("p1") or []), *(line_cfg.get("p2") or [])]
        if points and all(0 <= float(v) <= 1 for v in points):
            return "norm"
        return "raw"

    @staticmethod
    def _center_from_box(box: dict) -> Optional[tuple[float, float]]:
        if not box:
            return None
        return (
            (float(box.get("xmin", 0)) + float(box.get("xmax", 0))) / 2,
            (float(box.get("ymin", 0)) + float(box.get("ymax", 0))) / 2,
        )

    def _extract_positions(self, event: dict) -> Optional[dict[str, tuple[float, float]]]:
        metadata = event.get("metadata", {})

        raw_cx = event.get("raw_cx", metadata.get("raw_cx"))
        raw_cy = event.get("raw_cy", metadata.get("raw_cy"))
        norm_cx = event.get("cx", metadata.get("cx"))
        norm_cy = event.get("cy", metadata.get("cy"))

        raw_pos = None
        if raw_cx is not None and raw_cy is not None:
            raw_pos = (float(raw_cx), float(raw_cy))
        else:
            raw_pos = self._center_from_box(event.get("box") or metadata.get("box", {}))

        norm_pos = None
        if norm_cx is not None and norm_cy is not None:
            norm_pos = (float(norm_cx), float(norm_cy))
        else:
            norm_pos = self._center_from_box(event.get("box_norm") or metadata.get("box_norm", {}))

        if raw_pos is None and norm_pos is None:
            return None
        if raw_pos is None:
            raw_pos = norm_pos
        if norm_pos is None:
            norm_pos = raw_pos
        return {"raw": raw_pos, "norm": norm_pos}

    @staticmethod
    def _movement_for_direction(direction: str, line_cfg: dict) -> str:
        enter_direction = line_cfg.get("enter_direction", "AB")
        return "enter" if direction == enter_direction else "exit"

    def _check_line_crossing(
        self,
        p_prev: tuple,
        p_curr: tuple,
        line_p1: tuple,
        line_p2: tuple,
    ) -> Optional[str]:
        def cross(o, a, b):
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

        d1 = cross(line_p1, line_p2, p_prev)
        d2 = cross(line_p1, line_p2, p_curr)

        if d1 > 0 and d2 < 0:
            return "AB"
        if d1 < 0 and d2 > 0:
            return "BA"
        return None

    async def _save_crossing_event(
        self, event: dict, line_cfg: dict, direction: str, track_id: int
    ) -> None:
        if not event.get("has_snapshot") or not event.get("id"):
            return

        camera_id = self._parse_uuid(event.get("camera_id"))
        server_id = self._parse_uuid(event.get("server_id"))
        metadata = {
            "plugin": self.name,
            "line_name": line_cfg.get("name", "unknown"),
            "direction": direction,
            "movement": self._movement_for_direction(direction, line_cfg),
            "track_id": str(track_id),
            "camera_name": event.get("camera_name", ""),
            "source_event_id": event.get("id"),
            "label": event.get("label", ""),
        }
        try:
            async with AsyncSessionLocal() as db:
                db.add(EventModel(
                    server_id=server_id,
                    camera_id=camera_id,
                    label="line_crossing",
                    sub_label=line_cfg.get("name", "unknown"),
                    event_type="plugin",
                    source="plugin:line_crossing",
                    severity=line_cfg.get("severity", "medium"),
                    start_time=datetime.now(timezone.utc),
                    score=event.get("score"),
                    zones=[],
                    has_clip=False,
                    has_snapshot=bool(event.get("has_snapshot")),
                    extra_metadata=metadata,
                ))
                await db.commit()
        except Exception:
            # Alert emission should still work even if historical persistence fails.
            return

    def _cooldown_allows(self, camera_name: str, track_id: str, line_cfg: dict, event: dict) -> bool:
        now = self._event_timestamp(event)
        key = f"{line_cfg.get('name', 'line')}:{track_id}:{line_cfg.get('directions', ['AB','BA'])}"
        last = self._last_alerts.setdefault(camera_name, {}).get(key, 0.0)
        cooldown = float(line_cfg.get("alert_cooldown", self._config.get("alert_cooldown", 10)))
        if now - last < cooldown:
            return False
        self._last_alerts[camera_name][key] = now
        return True

    @staticmethod
    def _event_timestamp(event: dict) -> float:
        value = event.get("timestamp") or event.get("start_ts")
        if value is None:
            return datetime.now(timezone.utc).timestamp()
        try:
            return float(value)
        except (TypeError, ValueError):
            try:
                return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
            except ValueError:
                return datetime.now(timezone.utc).timestamp()

    @staticmethod
    def _parse_uuid(value) -> uuid.UUID | None:
        if not value:
            return None
        try:
            return uuid.UUID(str(value))
        except ValueError:
            return None

    async def on_unload(self) -> None:
        self._prev_positions.clear()
        self._last_alerts.clear()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "lines": {
                    "type": "object",
                    "title": "Líneas virtuales por cámara",
                    "description": "Líneas por cámara. Key = camera_name",
                    "additionalProperties": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "p1": {
                                    "type": "array",
                                    "minItems": 2,
                                    "maxItems": 2,
                                    "items": {"type": "number"},
                                    "description": "Punto inicial [x, y]",
                                },
                                "p2": {
                                    "type": "array",
                                    "minItems": 2,
                                    "maxItems": 2,
                                    "items": {"type": "number"},
                                    "description": "Punto final [x, y]",
                                },
                                "directions": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "enum": ["AB", "BA", "BOTH"],
                                    "default": ["AB", "BA"],
                                    "description": "Direcciones válidas",
                                },
                                "severity": {
                                    "type": "string",
                                    "enum": ["low", "medium", "high", "critical"],
                                    "default": "medium",
                                },
                                "alert_cooldown": {
                                    "type": "number",
                                    "default": 10,
                                    "minimum": 0,
                                    "description": "Segundos mínimos entre alertas para la misma línea y track",
                                },
                                "labels": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "default": [],
                                    "description": "Labels que pueden disparar la línea. Vacío = todos.",
                                },
                                "enter_direction": {
                                    "type": "string",
                                    "enum": ["AB", "BA"],
                                    "default": "AB",
                                    "description": "Dirección que se considera entrada; la opuesta será salida",
                                },
                            },
                            "required": ["name", "p1", "p2"],
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

        @router.get("/lines")
        async def get_lines(_=Depends(get_current_user)):
            return plugin_self._config.get("lines", {})

        @router.get("/stats")
        async def get_stats(_=Depends(get_current_user)):
            return {
                "active_lines": sum(len(l) for l in plugin_self._config.get("lines", {}).values()),
                "tracks_tracked": sum(len(t) for t in plugin_self._prev_positions.values()),
            }

        @router.delete("/tracks/{track_id}")
        async def clear_track(
            track_id: str,
            camera_name: str = Query(...),
            _=Depends(get_current_user),
        ):
            plugin_self._prev_positions.get(camera_name, {}).pop(track_id, None)
            return {"ok": True}

        return router
