import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from app.plugins.base import BasePlugin
from app.plugins.shared.inference_engine import InferenceBackend, InferenceEngine
from app.plugins.shared.tracker import Detection

log = logging.getLogger(__name__)


@dataclass
class StationaryObject:
    track_id: int
    class_name: str
    first_seen: float
    last_seen: float
    positions: list[tuple[int, int]] = field(default_factory=list)
    alerted: bool = False
    bbox: dict = field(default_factory=dict)


class AbandonedObjectPlugin(BasePlugin):
    name = "abandoned_object"
    version = "1.0.0"
    description = "Detección de objetos abandonados mediante tracking temporal"
    display_name = "Objeto Abandonado"
    requires_gpu = True
    supports_openvino = True
    min_ram_gb = 8
    category = "analytics"
    has_sidebar_page = True
    sidebar_icon = "📦"
    sidebar_label = "Obj. Abandonado"
    sidebar_route = "abandoned_object"

    def __init__(self):
        self._config: dict = {}
        self._engine: Optional[InferenceEngine] = None
        self._model_path: str = ""
        self._stationary_objects: dict[str, dict[int, StationaryObject]] = defaultdict(dict)
        self._tracked_objects: dict[str, dict[int, dict]] = defaultdict(dict)
        self._alerted_objects: dict[str, set[int]] = defaultdict(set)
        self._min_abandoned_seconds: int = 30
        self._movement_threshold: int = 50
        self._confidence_threshold: float = 0.5
        self._excluded_labels: set = {"person", "car", "truck", "bus", "motorcycle", "bicycle"}

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._model_path = config.get("model_path", "/models/abandoned_object_yolo.pt")
        self._min_abandoned_seconds = config.get("min_abandoned_seconds", 30)
        self._movement_threshold = config.get("movement_threshold", 50)
        self._confidence_threshold = config.get("confidence", 0.5)
        self._excluded_labels = set(config.get("excluded_labels", list(self._excluded_labels)))

        self._engine = InferenceEngine(
            model_path=self._model_path,
            backend=InferenceBackend.TENSORRT if config.get("use_gpu", True) else InferenceBackend.OPENVINO,
        )
        try:
            await self._engine.load()
        except Exception:
            self._engine = InferenceEngine(
                model_path=self._model_path,
                backend=InferenceBackend.PYTORCH_CPU,
            )
            try:
                await self._engine.load()
            except Exception as exc:
                log.warning("abandoned_object: inference engine unavailable (%s) — detection disabled", exc)
                self._engine = None

    async def on_event(self, event: dict) -> None:
        pass

    def get_frame_subscriptions(self) -> list[str]:
        return self._config.get("enabled_cameras") or []

    async def on_frame(
        self,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        if self._engine is None:
            return

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        detections = await self._engine.predict(
            image, conf=self._confidence_threshold
        )

        active_track_ids = set()
        for detection in detections:
            if detection["class_name"] in self._excluded_labels:
                continue

            track_id = self._assign_track_id(camera_name, detection)
            active_track_ids.add(track_id)

            bbox = detection["bbox"]
            center_x = (bbox["x1"] + bbox["x2"]) // 2
            center_y = (bbox["y1"] + bbox["y2"]) // 2

            stationary_objs = self._stationary_objects[camera_name]
            if track_id in stationary_objs:
                obj = stationary_objs[track_id]
                obj.last_seen = timestamp
                obj.positions.append((center_x, center_y))
                obj.bbox = bbox

                if len(obj.positions) > 30:
                    obj.positions.pop(0)
            else:
                stationary_objs[track_id] = StationaryObject(
                    track_id=track_id,
                    class_name=detection["class_name"],
                    first_seen=timestamp,
                    last_seen=timestamp,
                    positions=[(center_x, center_y)],
                    bbox=bbox,
                )

            self._tracked_objects[camera_name][track_id] = {
                "bbox": bbox,
                "center": (center_x, center_y),
                "class_name": detection["class_name"],
                "confidence": detection["confidence"],
            }

        self._cleanup_stale_objects(camera_name, timestamp)
        await self._check_abandoned(camera_name, timestamp, image)

    def _assign_track_id(self, camera_name: str, detection: dict) -> int:
        bbox = detection["bbox"]
        det_cx = (bbox["x1"] + bbox["x2"]) // 2
        det_cy = (bbox["y1"] + bbox["y2"]) // 2

        tracked = self._tracked_objects.get(camera_name, {})
        best_id = None
        best_dist = float("inf")

        for track_id, info in tracked.items():
            cx, cy = info["center"]
            dist = ((det_cx - cx) ** 2 + (det_cy - cy) ** 2) ** 0.5
            if dist < best_dist and dist < 100:
                best_dist = dist
                best_id = track_id

        if best_id is not None:
            return best_id

        max_id = max((t for t in tracked.keys()), default=0)
        return max_id + 1

    def _cleanup_stale_objects(self, camera_name: str, current_time: float) -> None:
        stale_threshold = 5.0
        stationary_objs = self._stationary_objects.get(camera_name, {})
        tracked_objs = self._tracked_objects.get(camera_name, {})

        stale_ids = [
            tid for tid, obj in stationary_objs.items()
            if current_time - obj.last_seen > stale_threshold and tid not in tracked_objs
        ]
        for tid in stale_ids:
            stationary_objs.pop(tid, None)
            self._alerted_objects[camera_name].discard(tid)

    async def _check_abandoned(self, camera_name: str, timestamp: float, image: bytes) -> None:
        stationary_objs = self._stationary_objects.get(camera_name, {})
        alerted = self._alerted_objects.get(camera_name, set())

        for track_id, obj in list(stationary_objs.items()):
            if track_id in alerted:
                continue

            if len(obj.positions) < 5:
                continue

            if timestamp - obj.first_seen < self._min_abandoned_seconds:
                continue

            if self._is_stationary(obj.positions):
                alerted.add(track_id)
                self._alerted_objects[camera_name] = alerted

                _, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 70])

                await self.emit_alert(
                    camera_id=camera_name,
                    alert_type="abandoned_object",
                    severity="medium",
                    data={
                        "track_id": track_id,
                        "object_class": obj.class_name,
                        "camera_name": camera_name,
                        "duration_seconds": int(timestamp - obj.first_seen),
                        "bbox": obj.bbox,
                        "position": obj.positions[-1] if obj.positions else None,
                    },
                    snapshot_bytes=jpeg.tobytes(),
                )

    def _is_stationary(self, positions: list[tuple[int, int]]) -> bool:
        if len(positions) < 5:
            return False

        recent = positions[-5:]
        min_x = min(p[0] for p in recent)
        max_x = max(p[0] for p in recent)
        min_y = min(p[1] for p in recent)
        max_y = max(p[1] for p in recent)

        return (max_x - min_x) < self._movement_threshold and (max_y - min_y) < self._movement_threshold

    async def on_unload(self) -> None:
        if self._engine:
            await self._engine.unload()
        self._stationary_objects.clear()
        self._tracked_objects.clear()
        self._alerted_objects.clear()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "model_path": {
                    "type": "string",
                    "default": "/models/abandoned_object_yolo.pt",
                    "description": "Ruta al modelo YOLO entrenado para objetos abandonados",
                },
                "confidence": {
                    "type": "number",
                    "default": 0.5,
                    "minimum": 0,
                    "maximum": 1,
                },
                "use_gpu": {
                    "type": "boolean",
                    "default": True,
                },
                "min_abandoned_seconds": {
                    "type": "integer",
                    "default": 30,
                    "description": "Tiempo mínimo para considerar un objeto abandonado",
                },
                "movement_threshold": {
                    "type": "integer",
                    "default": 50,
                    "description": "Píxeles máximos de movimiento para considerar estacionario",
                },
                "excluded_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": ["person", "car", "truck", "bus", "motorcycle", "bicycle"],
                    "description": "Clases YOLO a excluir (vehículos, personas, etc.)",
                },
                "enabled_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Cámaras a monitorear (vacío = todas)",
                },
            },
        }

    def get_routes(self) -> "APIRouter":
        from fastapi import APIRouter, Depends
        from app.deps import get_current_user

        router = APIRouter()
        plugin_self = self

        @router.get("/stats")
        async def get_stats(_=Depends(get_current_user)):
            return {
                "engine_loaded": plugin_self._engine is not None,
                "tracked_objects": sum(len(t) for t in plugin_self._object_tracks.values()),
                "stationary_alerts": len(plugin_self._stationary_objects),
            }

        @router.delete("/objects/{object_id}")
        async def clear_object(
            object_id: int,
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._object_tracks.get(camera_name, {}).pop(object_id, None)
            plugin_self._stationary_objects.pop(object_id, None)
            return {"ok": True}

        return router
