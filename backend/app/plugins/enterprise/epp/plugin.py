import logging
import os
from typing import Optional

import cv2
import numpy as np

from app.plugins.base import BasePlugin
from app.plugins.shared.inference_engine import InferenceBackend, InferenceEngine
from app.plugins.shared.tracker import ByteTrackWrapper, Detection, TrackerManager

log = logging.getLogger(__name__)

EPP_ITEMS = ("helmet", "vest", "gloves", "boots", "goggles", "mask", "harness")


class ZoneConfig:
    def __init__(
        self,
        name: str,
        polygon: list[tuple[int, int]],
        labels: list[str] | None = None,
        severity: str | None = None,
        **required: bool,
    ):
        self.name = name
        self.polygon = polygon
        self.labels = labels or ["person", "worker"]
        self.severity = severity
        for item in EPP_ITEMS:
            setattr(self, f"require_{item}", bool(required.get(f"require_{item}", item in {"helmet", "vest"})))


class EPPPlugin(BasePlugin):
    name = "epp"
    version = "1.1.0"
    description = "Detección profesional de cumplimiento EPP con tracking, persistencia y zonas inteligentes"
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
        self._track_windows: dict[str, dict[int, list[dict]]] = {}
        self._violation_log: list[dict] = []
        self._model_path: str = ""
        self._status: dict = {"state": "not_loaded", "message": "Motor EPP no inicializado", "missing": []}

    async def on_load(self, config: dict) -> None:
        self._config = self._normalize_config(config)
        self._model_path = self._config["model_path"]
        self._setup_zones(self._config)

        self._status = {
            "state": "loading",
            "message": "Cargando detector EPP",
            "model_path": self._model_path,
            "backend": None,
            "missing": [],
        }
        if not os.path.exists(self._model_path):
            self._engine = None
            self._status = {
                "state": "missing_model",
                "message": f"Falta el modelo EPP: {self._model_path}",
                "model_path": self._model_path,
                "backend": None,
                "missing": [{
                    "type": "model_file",
                    "path": self._model_path,
                    "hint": "Copiar un modelo YOLO/ONNX/XML entrenado para EPP a esa ruta o actualizar model_path en la configuración del plugin.",
                }],
            }
            log.warning("epp: model file missing: %s", self._model_path)
            return

        primary_backend = InferenceBackend.TENSORRT if self._config["use_gpu"] else InferenceBackend.OPENVINO
        if self._model_path.lower().endswith(".onnx"):
            primary_backend = InferenceBackend.ONNX_CPU
        elif self._model_path.lower().endswith(".xml"):
            primary_backend = InferenceBackend.OPENVINO

        self._engine = InferenceEngine(model_path=self._model_path, backend=primary_backend)
        try:
            await self._engine.load()
            self._status = {
                "state": "online",
                "message": "Detector EPP cargado",
                "model_path": self._model_path,
                "backend": getattr(primary_backend, "value", str(primary_backend)),
                "missing": [],
            }
        except Exception:
            self._engine = InferenceEngine(model_path=self._model_path, backend=InferenceBackend.PYTORCH_CPU)
            try:
                await self._engine.load()
                self._status = {
                    "state": "online",
                    "message": "Detector EPP cargado con fallback CPU",
                    "model_path": self._model_path,
                    "backend": getattr(InferenceBackend.PYTORCH_CPU, "value", str(InferenceBackend.PYTORCH_CPU)),
                    "missing": [],
                }
            except Exception as exc:
                log.warning("epp: inference engine unavailable (%s) - detection disabled", exc)
                self._engine = None
                self._status = {
                    "state": "load_error",
                    "message": f"No se pudo cargar el modelo EPP: {exc}",
                    "model_path": self._model_path,
                    "backend": getattr(primary_backend, "value", str(primary_backend)),
                    "missing": [{"type": "runtime", "path": self._model_path, "hint": "Verificar formato del modelo y runtime seleccionado."}],
                }

    def _normalize_config(self, config: dict) -> dict:
        return {
            "model_path": config.get("model_path", "/models/epp_yolo.pt"),
            "confidence": float(config.get("confidence", 0.5)),
            "use_gpu": bool(config.get("use_gpu", True)),
            "min_violation_seconds": float(config.get("min_violation_seconds", 3)),
            "alert_cooldown": float(config.get("alert_cooldown", 60)),
            "window_size": int(config.get("window_size", 10)),
            "required_positive_frames": int(config.get("required_positive_frames", 8)),
            "enabled_cameras": config.get("enabled_cameras", []),
            "required_epp": config.get("required_epp", ["helmet", "vest"]),
            "zones": config.get("zones", {}),
        }

    def _setup_zones(self, config: dict) -> None:
        self._zones = {}
        for cam_name, zones in config.get("zones", {}).items():
            self._zones[cam_name] = [
                ZoneConfig(
                    name=z["name"],
                    polygon=[tuple(p) for p in z["polygon"]],
                    labels=z.get("labels", ["person", "worker"]),
                    severity=z.get("severity"),
                    **{f"require_{item}": z.get(f"require_{item}", item in {"helmet", "vest"}) for item in EPP_ITEMS},
                )
                for z in zones
            ]

    async def on_event(self, event: dict) -> None:
        pass

    def get_frame_subscriptions(self) -> list[str]:
        if self._config.get("enabled_cameras"):
            return self._config["enabled_cameras"]
        return list(self._zones.keys())

    async def on_frame(self, camera_name: str, frame: bytes, timestamp: float, width: int, height: int) -> None:
        if camera_name not in self._zones and not self._config.get("enabled_cameras"):
            return
        if self._engine is None:
            return

        image = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return

        detections = await self._engine.predict(image, conf=self._config.get("confidence", 0.5))
        tracker = TrackerManager.get_tracker(camera_name)
        tracked_objects = await tracker.update(
            [Detection(bbox=self._bbox_to_dict(d), class_name=d["class_name"], confidence=d["confidence"]) for d in detections],
            timestamp,
        )

        for track in tracked_objects:
            await self._check_violations(camera_name, track, image, timestamp, width, height)

    def _bbox_to_dict(self, detection: dict) -> dict:
        b = detection["bbox"]
        return {"x1": b["x1"], "y1": b["y1"], "x2": b["x2"], "y2": b["y2"]}

    async def _check_violations(self, camera_name: str, track, image, timestamp: float, width: int, height: int) -> None:
        zones = self._zones.get(camera_name) or [self._default_zone(width, height)]
        center_x = (track.bbox.get("x1", 0) + track.bbox.get("x2", 0)) / 2
        center_y = (track.bbox.get("y1", 0) + track.bbox.get("y2", 0)) / 2

        for zone in zones:
            if not self._point_in_polygon(center_x, center_y, zone.polygon) or track.class_name not in zone.labels:
                continue

            missing = self._missing_equipment(zone, image, track.bbox)
            window = self._track_windows.setdefault(camera_name, {}).setdefault(track.track_id, [])
            window.append({"timestamp": timestamp, "zone_name": zone.name, "missing": missing})
            if len(window) > max(1, self._config["window_size"]):
                window.pop(0)

            confirmed = self._confirmed_violations(window, zone.name)
            if not confirmed:
                self._track_violations.setdefault(camera_name, {}).pop(track.track_id, None)
                continue

            self._track_violations.setdefault(camera_name, {})[track.track_id] = {
                "violations": confirmed,
                "zone_name": zone.name,
                "updated_at": timestamp,
            }
            duration = self._window_duration(window)
            if duration < self._config["min_violation_seconds"]:
                continue

            alerted = self._alerted_tracks.setdefault(camera_name, {}).get(track.track_id, 0)
            if timestamp - alerted < self._config["alert_cooldown"]:
                continue

            self._alerted_tracks.setdefault(camera_name, {})[track.track_id] = timestamp
            required = self._required_for_zone(zone)
            event_data = {
                "event_type": "ppe_violation",
                "track_id": track.track_id,
                "person_id": track.track_id,
                "zone_name": zone.name,
                "zone": zone.name,
                "violations": [f"no_{item}" for item in confirmed],
                "missing_equipment": confirmed,
                "required_equipment": required,
                "label": track.class_name,
                "camera_name": camera_name,
                "confidence": track.confidence,
                "compliance_score": max(0.0, 1.0 - (len(confirmed) / max(1, len(required)))),
                "duration_seconds": round(duration, 2),
                "frames_confirmed": len([state for state in window if state["missing"]]),
                "window_size": len(window),
                "bbox": track.bbox,
            }
            self._violation_log.append({"camera_name": camera_name, "timestamp": timestamp, **event_data})
            if len(self._violation_log) > 500:
                self._violation_log.pop(0)
            snapshot_bytes = self._build_snapshot(image, track.bbox, confirmed, zone.name)
            await self.emit_alert(
                camera_id=camera_name,
                alert_type="epp_violation",
                severity=zone.severity or self._severity_for(confirmed),
                data=event_data,
                snapshot_bytes=snapshot_bytes,
            )

    def _build_snapshot(self, image, bbox: dict, missing: list[str], zone_name: str) -> bytes | None:
        try:
            annotated = image.copy()
            x1, y1, x2, y2 = [int(bbox.get(k, 0)) for k in ("x1", "y1", "x2", "y2")]
            height, width = annotated.shape[:2]
            x1, x2 = max(0, x1), min(width - 1, x2)
            y1, y2 = max(0, y1), min(height - 1, y2)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 3)
            label = f"EPP: {', '.join(missing)}"
            zone = f"Zona: {zone_name}"
            y_text = max(24, y1 - 12)
            cv2.rectangle(annotated, (x1, max(0, y_text - 22)), (min(width - 1, x1 + 360), y_text + 32), (0, 0, 0), -1)
            cv2.putText(annotated, label, (x1 + 6, y_text), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            cv2.putText(annotated, zone, (x1 + 6, y_text + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
            ok, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 82])
            return jpeg.tobytes() if ok else None
        except Exception as exc:
            log.warning("epp: failed to build snapshot: %s", exc)
            return None

    def _missing_equipment(self, zone: ZoneConfig, image, bbox: dict) -> list[str]:
        missing: list[str] = []
        if zone.require_helmet and not self._check_helmet(image, bbox):
            missing.append("helmet")
        if zone.require_vest and not self._check_vest(image, bbox):
            missing.append("vest")
        for item in ("gloves", "boots", "goggles", "mask", "harness"):
            if getattr(zone, f"require_{item}", False):
                missing.append(item)
        return missing

    def _confirmed_violations(self, window: list[dict], zone_name: str) -> list[str]:
        required_frames = min(self._config["required_positive_frames"], len(window))
        counts: dict[str, int] = {}
        for state in window:
            if state["zone_name"] != zone_name:
                continue
            for item in state["missing"]:
                counts[item] = counts.get(item, 0) + 1
        return sorted([item for item, count in counts.items() if count >= required_frames])

    def _window_duration(self, window: list[dict]) -> float:
        if len(window) < 2:
            return 0.0
        return float(window[-1]["timestamp"] - window[0]["timestamp"])

    def _required_for_zone(self, zone: ZoneConfig) -> list[str]:
        return [item for item in EPP_ITEMS if getattr(zone, f"require_{item}", False)]

    def _severity_for(self, missing: list[str]) -> str:
        if "harness" in missing:
            return "critical"
        if "helmet" in missing or "goggles" in missing:
            return "high"
        if any(item in missing for item in ("vest", "gloves", "boots", "mask")):
            return "medium"
        return "low"

    def _default_zone(self, width: int, height: int) -> ZoneConfig:
        required = set(self._config.get("required_epp") or ["helmet", "vest"])
        return ZoneConfig(
            name="default",
            polygon=[(0, 0), (width, 0), (width, height), (0, height)],
            **{f"require_{item}": item in required for item in EPP_ITEMS},
        )

    def _check_helmet(self, image, bbox: dict) -> bool:
        x1, y1, x2, y2 = int(bbox["x1"]), int(bbox["y1"]), int(bbox["x2"]), int(bbox["y2"])
        head_y2 = max(0, y1 + int((y2 - y1) * 0.32))
        head_roi = image[max(0, y1):head_y2, max(0, x1):max(0, x2)]
        if head_roi.size == 0:
            return False
        hsv = cv2.cvtColor(head_roi, cv2.COLOR_BGR2HSV)
        ranges = [
            (np.array([18, 80, 120]), np.array([38, 255, 255])),
            (np.array([8, 100, 120]), np.array([20, 255, 255])),
            (np.array([0, 0, 170]), np.array([180, 40, 255])),
            (np.array([0, 100, 100]), np.array([10, 255, 255])),
            (np.array([170, 100, 100]), np.array([180, 255, 255])),
            (np.array([95, 80, 80]), np.array([135, 255, 255])),
        ]
        total_pixels = head_roi.shape[0] * head_roi.shape[1]
        combined = np.zeros(head_roi.shape[:2], dtype=np.uint8)
        for lower, upper in ranges:
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
        mask_green = cv2.inRange(hsv, np.array([35, 50, 50]), np.array([85, 255, 255]))
        mask_orange = cv2.inRange(hsv, np.array([5, 50, 50]), np.array([25, 255, 255]))
        total_pixels = torso_roi.shape[0] * torso_roi.shape[1]
        return (cv2.countNonZero(mask_green) + cv2.countNonZero(mask_orange)) > 0.15 * total_pixels

    def _point_in_polygon(self, x: float, y: float, polygon: list[tuple]) -> bool:
        pts = np.array(polygon, dtype=np.float32)
        return cv2.pointPolygonTest(pts, (float(x), float(y)), False) >= 0

    async def on_unload(self) -> None:
        if self._engine:
            await self._engine.unload()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "model_path": {"type": "string", "default": "/models/epp_yolo.pt", "description": "Ruta al modelo YOLO entrenado para EPP"},
                "confidence": {"type": "number", "default": 0.5, "minimum": 0, "maximum": 1},
                "use_gpu": {"type": "boolean", "default": True},
                "min_violation_seconds": {"type": "number", "default": 3, "description": "Tiempo mínimo de violación antes de alertar"},
                "alert_cooldown": {"type": "number", "default": 60, "description": "Segundos entre alertas del mismo track"},
                "window_size": {"type": "integer", "default": 10, "description": "Frames recientes usados para confirmar incumplimiento"},
                "required_positive_frames": {"type": "integer", "default": 8, "description": "Frames de la ventana que deben coincidir"},
                "enabled_cameras": {"type": "array", "items": {"type": "string"}, "description": "Cámaras a monitorear"},
                "required_epp": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(EPP_ITEMS)},
                    "default": ["helmet", "vest"],
                    "description": "EPP requerido cuando no hay zonas configuradas",
                },
                "zones": {"type": "object", "additionalProperties": {"type": "array"}},
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
                "active_tracks": sum(len(t) for t in plugin_self._track_windows.values()),
                "active_violations": sum(len(t) for t in plugin_self._track_violations.values()),
                "violations_logged": len(plugin_self._violation_log),
                "configured_model_path": plugin_self._model_path,
                "status": plugin_self._status,
                "zones_configured": sum(len(z) for z in plugin_self._zones.values()),
                "enabled_cameras": plugin_self._config.get("enabled_cameras") or [],
                "required_epp": plugin_self._config.get("required_epp") or ["helmet", "vest"],
                "window_size": plugin_self._config.get("window_size", 10),
                "required_positive_frames": plugin_self._config.get("required_positive_frames", 8),
            }

        @router.delete("/tracks/{person_id}")
        async def clear_person(person_id: int, camera_name: str, _=Depends(get_current_user)):
            plugin_self._track_windows.get(camera_name, {}).pop(person_id, None)
            plugin_self._track_violations.get(camera_name, {}).pop(person_id, None)
            plugin_self._alerted_tracks.get(camera_name, {}).pop(person_id, None)
            return {"ok": True}

        return router
