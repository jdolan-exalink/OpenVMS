import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import AsyncSessionLocal
from app.deps import get_current_user, require_operator
from app.models.people_counting import PeopleCountingHourly
from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)


class PeopleCountingPlugin(BasePlugin):
    name = "people_counting"
    display_name = "Conteo de Personas y Vehículos"
    version = "1.0.0"
    description = "Cuenta personas y vehículos que cruzan líneas virtuales; genera reportes horarios y estadísticas por zona"
    category = "analytics"
    supports_openvino = True
    min_ram_gb = 8
    has_sidebar_page = True
    sidebar_icon = "👥"
    sidebar_label = "Conteo"
    sidebar_route = "people_counting"

    def __init__(self):
        self._config: dict = {}
        self._counters: dict[str, dict[str, dict[str, int]]] = {}
        self._prev_positions: dict[str, dict[str, dict[str, tuple[float, float]]]] = {}

    async def on_load(self, config: dict) -> None:
        self._config = config

    async def on_event(self, event: dict) -> None:
        camera_name = event.get("camera_name", "")
        all_lines = self._config.get("counting_lines", {})
        counting_lines = all_lines.get(camera_name, [])

        log.debug(
            "people_counting on_event: camera=%r label=%r track_id=%r mqtt_type=%r "
            "cx=%r cy=%r configured_cameras=%r lines_for_cam=%d",
            camera_name,
            event.get("label"),
            event.get("track_id"),
            event.get("mqtt_type"),
            event.get("cx"),
            event.get("cy"),
            list(all_lines.keys()),
            len(counting_lines),
        )

        if not counting_lines:
            return

        track_id = event.get("track_id")
        if not track_id:
            return

        mqtt_type = event.get("mqtt_type", "update")
        if mqtt_type == "end":
            self._prev_positions.get(camera_name, {}).pop(track_id, None)
            return

        label = event.get("label", "")

        positions = self._extract_positions(event)
        if positions is None:
            return

        prev_pos = self._prev_positions.get(camera_name, {}).get(track_id)
        self._prev_positions.setdefault(camera_name, {})[track_id] = positions

        if prev_pos is None:
            return

        for line_cfg in counting_lines:
            allowed_labels = line_cfg.get("labels", [])
            if allowed_labels and label not in allowed_labels:
                continue

            line_scale = self._line_scale(line_cfg)
            prev_for_line = prev_pos[line_scale]
            curr_for_line = positions[line_scale]
            direction = self._check_crossing(
                prev_for_line,
                curr_for_line,
                line_cfg["p1"],
                line_cfg["p2"],
            )
            log.debug(
                "people_counting crossing check: line=%r label=%r scale=%r prev=%r curr=%r → %r",
                line_cfg.get("name"),
                label,
                line_scale,
                prev_for_line,
                curr_for_line,
                direction,
            )
            if direction is None:
                continue

            movement = self._movement_for_direction(direction, line_cfg)
            zone_name = line_cfg.get("zone", "default")
            counter = self._counters.setdefault(camera_name, {}).setdefault(zone_name, {})
            key = f"{label}_{movement}"
            counter[key] = counter.get(key, 0) + 1
            log.info("people_counting COUNT: camera=%r zone=%r %s → %d", camera_name, zone_name, key, counter[key])

            await self._save_count_event(event, line_cfg, zone_name, label, direction, movement)

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
        norm_cx = event.get("cx")
        norm_cy = event.get("cy")
        raw_cx = event.get("raw_cx")
        raw_cy = event.get("raw_cy")

        raw_pos = None
        if raw_cx is not None and raw_cy is not None:
            raw_pos = (float(raw_cx), float(raw_cy))
        else:
            raw_pos = self._center_from_box(event.get("box", {}))

        norm_pos = None
        if norm_cx is not None and norm_cy is not None:
            norm_pos = (float(norm_cx), float(norm_cy))
        else:
            norm_pos = self._center_from_box(event.get("box_norm", {}))

        if raw_pos is None and norm_pos is None:
            return None
        if raw_pos is None:
            raw_pos = norm_pos
        if norm_pos is None:
            norm_pos = raw_pos
        return {"raw": raw_pos, "norm": norm_pos}

    def _check_crossing(
        self, p_prev: tuple, p_curr: tuple, p1: list, p2: list
    ) -> Optional[str]:
        def cross(o, a, b):
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

        d1 = cross(p1, p2, p_prev)
        d2 = cross(p1, p2, p_curr)

        if d1 > 0 and d2 < 0:
            return "in"
        if d1 < 0 and d2 > 0:
            return "out"
        return None

    @staticmethod
    def _movement_for_direction(direction: str, line_cfg: dict) -> str:
        enter_direction = line_cfg.get("enter_direction", "in")
        return "enter" if direction == enter_direction else "exit"

    async def _save_count_event(
        self,
        event: dict,
        line_cfg: dict,
        zone_name: str,
        label: str,
        direction: str,
        movement: str,
    ) -> None:
        await self._increment_history(event, line_cfg, zone_name, label, movement)
        await self.emit_alert(
            camera_id=event.get("camera_id", ""),
            alert_type="people_counting",
            severity=line_cfg.get("severity", "low"),
            data={
                "line_name": line_cfg.get("name", "unknown"),
                "zone_name": zone_name,
                "label": label,
                "direction": direction,
                "movement": movement,
                "track_id": event.get("track_id"),
                "camera_name": event.get("camera_name", ""),
                "event_id": event.get("id"),
            },
        )

    async def _increment_history(
        self, event: dict, line_cfg: dict, zone_name: str, label: str, movement: str
    ) -> None:
        camera_name = event.get("camera_name", "")
        if not camera_name:
            return

        now = datetime.now(timezone.utc)
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        camera_id = None
        raw_camera_id = event.get("camera_id")
        if raw_camera_id:
            try:
                camera_id = uuid.UUID(str(raw_camera_id))
            except ValueError:
                camera_id = None

        values = {
            "camera_id": camera_id,
            "camera_name": camera_name,
            "hour_start": hour_start,
            "zone_name": zone_name,
            "line_name": line_cfg.get("name", "unknown"),
            "label": label,
            "enter_count": 1 if movement == "enter" else 0,
            "exit_count": 1 if movement == "exit" else 0,
            "updated_at": now,
        }
        stmt = pg_insert(PeopleCountingHourly).values(**values)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_people_counting_hourly_bucket",
            set_={
                "camera_id": stmt.excluded.camera_id,
                "enter_count": PeopleCountingHourly.enter_count + stmt.excluded.enter_count,
                "exit_count": PeopleCountingHourly.exit_count + stmt.excluded.exit_count,
                "updated_at": now,
            },
        )

        async with AsyncSessionLocal() as db:
            await db.execute(stmt)
            await db.commit()

    async def get_counts(self, camera_name: Optional[str] = None) -> dict:
        if camera_name:
            return {camera_name: self._counters.get(camera_name, {})}
        return dict(self._counters)

    async def reset_counters(self, camera_name: str, zone_name: Optional[str] = None) -> None:
        if zone_name:
            self._counters.setdefault(camera_name, {}).pop(zone_name, None)
        else:
            self._counters.pop(camera_name, None)

    async def get_history(
        self,
        camera_name: Optional[str] = None,
        days_back: int = 0,
        history_date: Optional[date] = None,
    ) -> dict:
        now = datetime.now(timezone.utc)
        if history_date is not None:
            start = datetime.combine(history_date, time.min, tzinfo=timezone.utc)
            end = start + timedelta(hours=24)
        elif days_back > 0:
            target = (now.date() - timedelta(days=days_back))
            start = datetime.combine(target, time.min, tzinfo=timezone.utc)
            end = start + timedelta(hours=24)
        else:
            end = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            start = end - timedelta(hours=24)

        stmt = (
            select(
                PeopleCountingHourly.camera_name,
                PeopleCountingHourly.hour_start,
                func.sum(PeopleCountingHourly.enter_count).label("enter_count"),
                func.sum(PeopleCountingHourly.exit_count).label("exit_count"),
            )
            .where(PeopleCountingHourly.hour_start >= start)
            .where(PeopleCountingHourly.hour_start < end)
            .group_by(PeopleCountingHourly.camera_name, PeopleCountingHourly.hour_start)
            .order_by(PeopleCountingHourly.camera_name, PeopleCountingHourly.hour_start)
        )
        if camera_name:
            stmt = stmt.where(PeopleCountingHourly.camera_name == camera_name)

        async with AsyncSessionLocal() as db:
            rows = (await db.execute(stmt)).all()

        hours = [start + timedelta(hours=i) for i in range(24)]
        by_camera: dict[str, dict] = {}
        for row in rows:
            camera = row.camera_name
            bucket = by_camera.setdefault(
                camera,
                {
                    "camera_name": camera,
                    "total_enter": 0,
                    "total_exit": 0,
                    "hours": {
                        h.isoformat(): {"hour": h.isoformat(), "enter": 0, "exit": 0}
                        for h in hours
                    },
                },
            )
            key = row.hour_start.isoformat()
            enter_count = int(row.enter_count or 0)
            exit_count = int(row.exit_count or 0)
            bucket["hours"][key] = {"hour": key, "enter": enter_count, "exit": exit_count}
            bucket["total_enter"] += enter_count
            bucket["total_exit"] += exit_count

        cameras = []
        for bucket in by_camera.values():
            bucket["hours"] = [bucket["hours"][h.isoformat()] for h in hours]
            cameras.append(bucket)

        return {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "hours": [h.isoformat() for h in hours],
            "cameras": cameras,
        }

    async def delete_history(self, camera_name: str) -> int:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                delete(PeopleCountingHourly).where(PeopleCountingHourly.camera_name == camera_name)
            )
            await db.commit()
        return int(result.rowcount or 0)

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "title": "Configuración Conteo de Personas",
            "properties": {
                "counting_lines": {
                    "type": "object",
                    "title": "Líneas de conteo por cámara",
                    "description": "Clave = camera_name en Frigate, valor = lista de líneas",
                    "additionalProperties": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "title": "Nombre de la línea"},
                                "zone": {"type": "string", "title": "Zona", "default": "default"},
                                "p1": {
                                    "type": "array",
                                    "title": "Punto 1 [x, y]",
                                    "minItems": 2,
                                    "maxItems": 2,
                                    "items": {"type": "number"},
                                },
                                "p2": {
                                    "type": "array",
                                    "title": "Punto 2 [x, y]",
                                    "minItems": 2,
                                    "maxItems": 2,
                                    "items": {"type": "number"},
                                },
                                "labels": {
                                    "type": "array",
                                    "title": "Labels a contar",
                                    "items": {"type": "string"},
                                    "default": ["person", "car", "truck", "bus"],
                                },
                                "severity": {
                                    "type": "string",
                                    "title": "Severidad de evento",
                                    "enum": ["low", "medium", "high", "critical"],
                                    "default": "low",
                                },
                                "enter_direction": {
                                    "type": "string",
                                    "title": "Dirección de entrada",
                                    "enum": ["in", "out"],
                                    "default": "in",
                                    "description": "Cruce físico que se considera entrada; el opuesto será salida",
                                },
                            },
                            "required": ["name", "p1", "p2"],
                        },
                    },
                    "default": {},
                }
            },
        }

    def get_routes(self) -> APIRouter:
        plugin_self = self
        router = APIRouter()

        @router.get("/counts")
        async def get_counts(
            camera_name: Optional[str] = Query(None),
            _=Depends(get_current_user),
        ):
            return await plugin_self.get_counts(camera_name)

        @router.delete("/counts")
        async def reset_counts(
            camera_name: Optional[str] = Query(None),
            zone_name: Optional[str] = Query(None),
            _=Depends(require_operator),
        ):
            if camera_name:
                await plugin_self.reset_counters(camera_name, zone_name)
            else:
                plugin_self._counters.clear()
                plugin_self._prev_positions.clear()
            return {"ok": True}

        @router.get("/history")
        async def get_history(
            camera_name: Optional[str] = Query(None),
            days_back: int = Query(0, ge=0),
            date_: Optional[date] = Query(None, alias="date"),
            _=Depends(get_current_user),
        ):
            return await plugin_self.get_history(camera_name, days_back, date_)

        @router.delete("/history")
        async def delete_history(
            camera_name: str = Query(...),
            _=Depends(require_operator),
        ):
            deleted = await plugin_self.delete_history(camera_name)
            return {"ok": True, "deleted": deleted}

        return router
