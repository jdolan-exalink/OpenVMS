import logging

import cv2
import numpy as np

from app.database import AsyncSessionLocal
from app.plugins.base import BasePlugin
from app.plugins.shared.inference_engine import InferenceBackend, InferenceEngine

log = logging.getLogger(__name__)


class LPRAdvancedPlugin(BasePlugin):
    name = "lpr_advanced"
    version = "1.0.0"
    description = "Reconocimiento de matrículas con YOLO + PaddleOCR"
    requires_gpu = True
    supports_openvino = True
    min_ram_gb = 8
    category = "recognition"
    has_sidebar_page = True
    sidebar_icon = "🚗"
    sidebar_label = "LPR Avanzado"
    sidebar_route = "lpr_advanced"

    def __init__(self):
        self._config: dict = {}
        self._plate_engine: InferenceEngine | None = None
        self._plate_model_path: str = ""
        self._ocr_engine = None
        self._last_detections: dict[str, float] = {}

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._plate_model_path = config.get("plate_model_path", "/models/license_plate_detector.pt")
        model_path_lower = self._plate_model_path.lower()
        if model_path_lower.endswith(".onnx"):
            primary_backend = InferenceBackend.ONNX_CPU
        elif model_path_lower.endswith(".xml"):
            primary_backend = InferenceBackend.OPENVINO
        else:
            primary_backend = InferenceBackend.TENSORRT if config.get("use_gpu", True) else InferenceBackend.PYTORCH_CPU

        self._plate_engine = InferenceEngine(
            model_path=self._plate_model_path,
            backend=primary_backend,
        )
        try:
            await self._plate_engine.load()
        except Exception:
            self._plate_engine = InferenceEngine(
                model_path=self._plate_model_path,
                backend=InferenceBackend.PYTORCH_CPU,
            )
            try:
                await self._plate_engine.load()
            except Exception as exc:
                log.warning("lpr_advanced: inference engine unavailable (%s) — detection disabled", exc)
                self._plate_engine = None

        if config.get("preload_ocr", False):
            self._ensure_ocr_engine()

    def _ensure_ocr_engine(self) -> None:
        if self._ocr_engine is not None:
            return
        try:
            from paddleocr import PaddleOCR
            self._ocr_engine = PaddleOCR(
                lang=self._config.get("ocr_lang", "en"),
                use_textline_orientation=True,
            )
        except Exception as exc:
            log.warning("PaddleOCR init failed: %s", exc)
            self._ocr_engine = None

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
        if self._plate_engine is None:
            return

        cooldown = self._config.get("detection_cooldown", 10)
        if camera_name in self._last_detections and timestamp - self._last_detections[camera_name] < cooldown:
            return

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        detections = await self._plate_engine.predict(
            image, conf=self._config.get("confidence", 0.5)
        )

        vehicle_labels = {"car", "truck", "bus", "motorcycle", "vehicle"}
        plate_detections = [d for d in detections if "plate" in d["class_name"].lower()]

        if not plate_detections:
            return

        self._last_detections[camera_name] = timestamp

        for plate_det in plate_detections:
            bbox = plate_det["bbox"]
            x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
            plate_roi = image[y1:y2, x1:x2]

            if plate_roi.size == 0:
                continue

            plate_text = await self._read_plate_text(plate_roi)
            if not plate_text:
                continue

            plate_text = plate_text.upper().replace(" ", "").replace("-", "")

            is_blacklisted, reason = await self._check_blacklist(plate_text)

            async with AsyncSessionLocal() as db:
                from app.models.event import Event as EventModel

                event = EventModel(
                    camera_id=camera_name,
                    label="lpr_advanced",
                    sub_label=plate_text,
                    source="plugin:lpr_advanced",
                    severity="critical" if is_blacklisted else "low",
                    has_snapshot=True,
                    metadata={
                        "plate_text": plate_text,
                        "confidence": plate_det["confidence"],
                        "is_blacklisted": is_blacklisted,
                        "blacklist_reason": reason,
                        "bbox": bbox,
                    },
                )
                db.add(event)
                await db.commit()
                await db.refresh(event)

            if is_blacklisted:
                _, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 70])
                await self.emit_alert(
                    camera_id=camera_name,
                    alert_type="blacklisted_plate",
                    severity="critical",
                    data={
                        "plate_text": plate_text,
                        "camera_name": camera_name,
                        "confidence": plate_det["confidence"],
                        "reason": reason,
                        "bbox": bbox,
                        "event_id": getattr(event, "id", None),
                    },
                    snapshot_bytes=jpeg.tobytes(),
                )

    async def _read_plate_text(self, plate_roi: np.ndarray) -> str | None:
        self._ensure_ocr_engine()
        if self._ocr_engine is None:
            return self._simple_ocr(plate_roi)

        try:
            result = self._ocr_engine.ocr(plate_roi, cls=True)
            if result and result[0]:
                texts = []
                for line in result[0]:
                    if line and len(line) >= 2:
                        text = line[1][0] if isinstance(line[1], (list, tuple)) else line[1]
                        texts.append(text)
                return " ".join(texts) if texts else None
        except Exception as exc:
            log.warning("PaddleOCR failed: %s", exc)
        return self._simple_ocr(plate_roi)

    def _simple_ocr(self, plate_roi: np.ndarray) -> str | None:
        try:
            gray = cv2.cvtColor(plate_roi, cv2.COLOR_BGR2GRAY)
            blur = cv2.bilateralFilter(gray, 9, 75, 75)
            _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                x, y, w, h = cv2.boundingRect(largest)
                char_roi = binary[y:y+h, x:x+w] if h > 10 and w > 20 else binary
                return f"PLATE_{char_roi.shape[1]}x{char_roi.shape[0]}"
        except Exception:
            pass
        return None

    async def _check_blacklist(self, plate_text: str) -> tuple[bool, str | None]:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            try:
                from app.plugins.builtin.lpr import LprBlacklist
                result = await db.execute(
                    select(LprBlacklist).where(LprBlacklist.plate_number == plate_text)
                )
                entry = result.scalar_one_or_none()
                if entry:
                    return True, entry.reason
            except Exception:
                pass
        return False, None

    async def on_unload(self) -> None:
        if self._plate_engine:
            await self._plate_engine.unload()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "plate_model_path": {
                    "type": "string",
                    "default": "/models/license_plate_detector.pt",
                    "description": "Ruta al modelo YOLO de detección de matrículas",
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
                "ocr_lang": {
                    "type": "string",
                    "default": "en",
                    "description": "Idioma para PaddleOCR (en, ch, etc.)",
                },
                "detection_cooldown": {
                    "type": "number",
                    "default": 10,
                    "description": "Segundos entre detecciones por cámara",
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
                "ocr_ready": plugin_self._ocr_engine is not None,
                "last_detection_times": len(plugin_self._last_detection_time),
            }

        @router.post("/reset/{camera_name}")
        async def reset_camera(
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._last_detection_time.pop(camera_name, None)
            return {"ok": True}

        return router
