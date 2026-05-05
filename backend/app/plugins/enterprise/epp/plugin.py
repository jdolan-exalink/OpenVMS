import logging
import time
from typing import Optional

import cv2
import numpy as np

from app.plugins.base import BasePlugin
from app.plugins.shared.inference_engine import InferenceBackend, InferenceEngine
from app.plugins.shared.tracker import ByteTrackWrapper, Detection, TrackerManager

log = logging.getLogger(__name__)


class ZoneConfig:
    def __init__(
        self,
        name: str,
        polygon: list[tuple[int, int]],
        require_helmet: bool = True,
        require_vest: bool = True,
        labels: list[str] = None,
    ):
        self.name = name
        self.polygon = polygon
        self.require_helmet = require_helmet
        self.require_vest = require_vest
        self.labels = labels or ["person", "worker"]


class EPPPlugin(BasePlugin):
    name = "epp"
    version = "1.0.0"
    description = "Detección de uso de EPP (casco y chaleco reflectivo)"
    display_name = "Cumplimiento EPP"
    requires_gpu = True
    supports_openvino = True
    min_ram_gb = 8
    category = "analytics"
    has_sidebar_page = True
    sidebar_icon = "🦺"
    sidebar_label = "EPP"
    sidebar_route = "epp"

    def __init__(self):
        self._config: dict = {}
        self._zones: dict[str, list[ZoneConfig]] = {}
        self._tracker: Optional[ByteTrackWrapper] = None
        self._engine: Optional[InferenceEngine] = None
        self._alerted_tracks: dict[str, dict[int, float]] = {}
        self._track_violations: dict[str, dict[int, dict]] = {}
        self._model_path: str = ""

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._model_path = config.get("model_path", "/models/epp_yolo.pt")
        self._setup_zones(config)

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
                log.warning("epp: inference engine unavailable (%s) — detection disabled", exc)
                self._engine = None

    def _setup_zones(self, config: dict) -> None:
        for cam_name, zones in config.get("zones", {}).items():
            self._zones[cam_name] = [
                ZoneConfig(
                    name=z["name"],
                    polygon=[tuple(p) for p in z["polygon"]],
                    require_helmet=z.get("require_helmet", True),
                    require_vest=z.get("require_vest", True),
                    labels=z.get("labels", ["person", "worker"]),
                )
                for z in zones
            ]

    async def on_event(self, event: dict) -> None:
        pass

    def get_frame_subscriptions(self) -> list[str]:
        if self._config.get("enabled_cameras"):
            return self._config["enabled_cameras"]
        return list(self._zones.keys())

    async def on_frame(
        self,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        if camera_name not in self._zones:
            return
        if self._engine is None:
            return

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        detections = await self._engine.predict(image, conf=self._config.get("confidence", 0.5))

        tracker = TrackerManager.get_tracker(camera_name)
        tracked_objects = await tracker.update(
            [Detection(bbox=self._bbox_to_dict(d), class_name=d["class_name"], confidence=d["confidence"]) for d in detections],
            timestamp,
        )

        for track in tracked_objects:
            await self._check_violations(camera_name, track, image, timestamp)

    def _bbox_to_dict(self, detection: dict) -> dict:
        b = detection["bbox"]
        return {"x1": b["x1"], "y1": b["y1"], "x2": b["x2"], "y2": b["y2"]}

    async def _check_violations(self, camera_name: str, track, image, timestamp: float) -> None:
        zones = self._zones.get(camera_name, [])
        if not zones:
            return

        center_x = (track.bbox.get("x1", 0) + track.bbox.get("x2", 0)) / 2
        center_y = (track.bbox.get("y1", 0) + track.bbox.get("y2", 0)) / 2

        for zone in zones:
            if not self._point_in_polygon(center_x, center_y, zone.polygon):
                continue

            if track.class_name not in zone.labels:
                continue

            violations = self._track_violations.setdefault(camera_name, {}).setdefault(track.track_id, {})
            has_helmet = self._check_helmet(image, track.bbox)
            has_vest = self._check_vest(image, track.bbox)

            if zone.require_helmet and not has_helmet:
                violations["no_helmet"] = True
            if zone.require_vest and not has_vest:
                violations["no_vest"] = True

            if violations:
                duration = len(track.history) * 0.5
                if duration < self._config.get("min_violation_seconds", 2):
                    continue

                alerted = self._alerted_tracks.setdefault(camera_name, {}).get(track.track_id, 0)
                if timestamp - alerted < self._config.get("alert_cooldown", 60):
                    continue

                self._alerted_tracks.setdefault(camera_name, {})[track.track_id] = timestamp
                await self.emit_alert(
                    camera_id=camera_name,
                    alert_type="epp_violation",
                    severity="high",
                    data={
                        "track_id": track.track_id,
                        "zone_name": zone.name,
                        "violations": list(violations.keys()),
                        "label": track.class_name,
                        "camera_name": camera_name,
                        "confidence": track.confidence,
                    },
                )

    def _check_helmet(self, image, bbox: dict) -> bool:
        x1, y1, x2, y2 = int(bbox["x1"]), int(bbox["y1"]), int(bbox["x2"]), int(bbox["y2"])
        head_y2 = max(0, y1 + int((y2 - y1) * 0.32))
        head_roi = image[max(0, y1):head_y2, max(0, x1):max(0, x2)]
        if head_roi.size == 0:
            return False
        hsv = cv2.cvtColor(head_roi, cv2.COLOR_BGR2HSV)
        helmet_colors = [
            # Safety yellow (construction helmets)
            (np.array([18, 80, 120]), np.array([38, 255, 255])),
            # Safety orange
            (np.array([8, 100, 120]), np.array([20, 255, 255])),
            # White / light gray
            (np.array([0, 0, 170]), np.array([180, 40, 255])),
            # Red helmets
            (np.array([0, 100, 100]), np.array([10, 255, 255])),
            (np.array([170, 100, 100]), np.array([180, 255, 255])),
            # Blue helmets
            (np.array([95, 80, 80]), np.array([135, 255, 255])),
        ]
        total_pixels = head_roi.shape[0] * head_roi.shape[1]
        if total_pixels == 0:
            return False
        combined = np.zeros(head_roi.shape[:2], dtype=np.uint8)
        for lower, upper in helmet_colors:
            combined = cv2.bitwise_or(combined, cv2.inRange(hsv, lower, upper))
        return cv2.countNonZero(combined) > 0.08 * total_pixels

    def _check_vest(self, image, bbox: dict) -> bool:
        x1, y1, x2, y2 = int(bbox["x1"]), int(bbox["y1"]), int(bbox["x2"]), int(bbox["y2"])
        height, width = image.shape[:2]
        x1, x2 = max(0, x1), min(width, x2)
        y1, y2 = max(0, y1), min(height, y2)
        torso_y1 = y1 + int((y2 - y1) * 0.3)
        torso_roi = image[torso_y1:y2, x1:x2]
        if torso_roi.size == 0:
            return False
        hsv = cv2.cvtColor(torso_roi, cv2.COLOR_BGR2HSV)
        lower_green = np.array([35, 50, 50])
        upper_green = np.array([85, 255, 255])
        lower_orange = np.array([5, 50, 50])
        upper_orange = np.array([25, 255, 255])
        mask_green = cv2.inRange(hsv, lower_green, upper_green)
        mask_orange = cv2.inRange(hsv, lower_orange, upper_orange)
        total_pixels = torso_roi.shape[0] * torso_roi.shape[1]
        return (cv2.countNonZero(mask_green) + cv2.countNonZero(mask_orange)) > 0.15 * total_pixels

    def _point_in_polygon(self, x: float, y: float, polygon: list[tuple]) -> bool:
        pts = np.array(polygon, dtype=np.float32)
        result = cv2.pointPolygonTest(pts, (float(x), float(y)), False)
        return result >= 0

    async def on_unload(self) -> None:
        if self._engine:
            await self._engine.unload()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "model_path": {
                    "type": "string",
                    "default": "/models/epp_yolo.pt",
                    "description": "Ruta al modelo YOLO entrenado para EPP",
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
                "min_violation_seconds": {
                    "type": "number",
                    "default": 2,
                    "description": "Tiempo mínimo de violación antes de alertar",
                },
                "alert_cooldown": {
                    "type": "number",
                    "default": 60,
                    "description": "Segundos entre alertas del mismo track",
                },
                "enabled_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Cámaras a monitorear (vacío = todas las configuradas)",
                },
                "zones": {
                    "type": "object",
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
                                },
                                "require_helmet": {"type": "boolean", "default": True},
                                "require_vest": {"type": "boolean", "default": True},
                                "labels": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "default": ["person", "worker"],
                                },
                            },
                        },
                    },
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
                "active_tracks": sum(len(t) for t in plugin_self._person_tracks.values()),
                "violations_logged": len(plugin_self._violation_log),
            }

        @router.delete("/tracks/{person_id}")
        async def clear_person(
            person_id: int,
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._person_tracks.get(camera_name, {}).pop(person_id, None)
            return {"ok": True}

        return router
