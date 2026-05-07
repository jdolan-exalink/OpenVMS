from __future__ import annotations

import logging

import cv2
import numpy as np

from app.plugins.base import BasePlugin
from app.plugins.shared.inference_engine import InferenceBackend, InferenceEngine

log = logging.getLogger(__name__)


class SmokeFirePlugin(BasePlugin):
    name = "smoke_fire"
    version = "1.0.0"
    description = "Detección de humo y fuego en tiempo real"
    display_name = "Humo y Fuego"
    requires_gpu = True
    supports_openvino = True
    min_ram_gb = 8
    category = "safety"
    has_sidebar_page = True
    sidebar_icon = "🔥"
    sidebar_label = "Humo / Fuego"
    sidebar_route = "smoke_fire"

    def __init__(self):
        self._config: dict = {}
        self._engine: InferenceEngine | None = None
        self._model_path: str = ""
        self._alerted_cameras: dict[str, float] = {}
        self._consecutive_detections: dict[str, int] = {}

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._model_path = config.get("model_path", "/models/smoke_fire_yolo.pt")

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
                log.warning("smoke_fire: inference engine unavailable (%s) — detection disabled", exc)
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
            image, conf=self._config.get("confidence", 0.4)
        )

        fire_detected = any(d["class_name"] in ["fire", "flame"] for d in detections)
        smoke_detected = any(d["class_name"] in ["smoke"] for d in detections)

        if not fire_detected and not smoke_detected:
            self._consecutive_detections.pop(camera_name, None)
            return

        consecutive = self._consecutive_detections.get(camera_name, 0) + 1
        self._consecutive_detections[camera_name] = consecutive

        required_frames = self._config.get("consecutive_frames_required", 3)
        if consecutive < required_frames:
            return

        cooldown = self._config.get("alert_cooldown", 120)
        last_alert = self._alerted_cameras.get(camera_name, 0)
        if timestamp - last_alert < cooldown:
            return

        self._alerted_cameras[camera_name] = timestamp

        severity = "critical" if fire_detected else "high"
        alert_type = "fire_detected" if fire_detected else "smoke_detected"

        fire_boxes = [d["bbox"] for d in detections if d["class_name"] in ["fire", "flame"]]
        smoke_boxes = [d["bbox"] for d in detections if d["class_name"] == "smoke"]

        from app.plugins.shared.annotation import annotate_frame, encode_jpeg
        annotated = image.copy()
        annotated = annotate_frame(annotated, fire_boxes, color=(0, 60, 255), label="fire")
        annotated = annotate_frame(annotated, smoke_boxes, color=(160, 160, 160), label="smoke")
        snapshot = encode_jpeg(annotated, quality=70)

        await self.emit_alert(
            camera_id=camera_name,
            alert_type=alert_type,
            severity=severity,
            data={
                "fire_detected": fire_detected,
                "smoke_detected": smoke_detected,
                "fire_count": len(fire_boxes),
                "smoke_count": len(smoke_boxes),
                "camera_name": camera_name,
                "confidence": max((d["confidence"] for d in detections), default=0),
                "fire_boxes": fire_boxes,
                "smoke_boxes": smoke_boxes,
            },
            snapshot_bytes=snapshot,
        )

    async def on_unload(self) -> None:
        if self._engine:
            await self._engine.unload()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "model_path": {
                    "type": "string",
                    "default": "/models/smoke_fire_yolo.pt",
                    "description": "Ruta al modelo YOLO entrenado para humo/fuego",
                },
                "confidence": {
                    "type": "number",
                    "default": 0.4,
                    "minimum": 0,
                    "maximum": 1,
                },
                "use_gpu": {
                    "type": "boolean",
                    "default": True,
                },
                "consecutive_frames_required": {
                    "type": "integer",
                    "default": 3,
                    "description": "Frames consecutivos necesarios para confirmar detección",
                },
                "alert_cooldown": {
                    "type": "number",
                    "default": 120,
                    "description": "Segundos entre alertas para la misma cámara",
                },
                "enabled_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Cámaras a monitorear (vacío = todas)",
                },
            },
        }

    def get_routes(self) -> APIRouter:
        from fastapi import APIRouter, Depends

        from app.deps import get_current_user

        router = APIRouter()
        plugin_self = self

        @router.get("/stats")
        async def get_stats(_=Depends(get_current_user)):
            return {
                "engine_loaded": plugin_self._engine is not None,
                "alerted_cameras": len(plugin_self._alerted_cameras),
                "consecutive_tracking": len(plugin_self._consecutive_detections),
            }

        @router.delete("/reset/{camera_name}")
        async def reset_camera(
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._alerted_cameras.pop(camera_name, None)
            plugin_self._consecutive_detections.pop(camera_name, None)
            return {"ok": True}

        return router
