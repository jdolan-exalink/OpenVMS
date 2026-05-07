import logging
import os
from datetime import datetime, timezone

import cv2
import numpy as np

from app.database import AsyncSessionLocal
from app.models.event import Event as EventModel
from app.models.plugins import LprEvent
from app.plugins.base import BasePlugin
from app.plugins.builtin.lpr import _correct_plate_ocr, _normalize_plate_value, _plate_format, _score_decimal
from app.plugins.shared.inference_engine import InferenceBackend, InferenceEngine
from app.plugins.shared.alert_service import AlertService

log = logging.getLogger(__name__)

# Class names produced by LP-specific detection models
_PLATE_KEYWORDS = ("plate", "license", "matricula", "patente", "nummernschild")

# COCO class IDs for vehicles (used when a generic yolov8n is loaded as fallback)
# In that mode the plugin OCRs the lower 30 % of each vehicle bbox as the plate region.
_VEHICLE_CLASS_IDS = frozenset({"2", "3", "5", "7"})          # car, motorcycle, bus, truck
_VEHICLE_LABEL_KEYWORDS = ("car", "truck", "bus", "motorcycle", "vehicle")


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
        self._plate_tracks: dict[str, dict] = {}
        self._engine_status: dict = {
            "state": "not_loaded",
            "message": "Motor LPR avanzado no inicializado",
            "missing": [],
        }
        self._ocr_status: dict = {
            "state": "lazy",
            "message": "OCR se cargará bajo demanda",
        }

    async def on_load(self, config: dict) -> None:
        self._config = self._normalize_config(config)
        self._plate_model_path = self._config.get("plate_model_path", "/models/license_plate_detector.onnx")
        model_path_lower = self._plate_model_path.lower()
        self._engine_status = {
            "state": "loading",
            "message": "Cargando detector de patentes",
            "model_path": self._plate_model_path,
            "backend": None,
            "missing": [],
        }
        if not os.path.exists(self._plate_model_path):
            self._plate_engine = None
            self._engine_status = {
                "state": "missing_model",
                "message": f"Modelo LPR no encontrado en {self._plate_model_path}",
                "model_path": self._plate_model_path,
                "backend": None,
                "missing": [
                    {
                        "type": "model_file",
                        "path": self._plate_model_path,
                        "hint": (
                            "El modelo se descarga automáticamente al desplegar con Docker Compose "
                            "(servicio model-init). Si el archivo sigue faltando, ejecute: "
                            "FORCE_MODEL_DOWNLOAD=1 docker compose up model-init"
                        ),
                    }
                ],
            }
            log.warning("lpr_advanced: model file missing: %s", self._plate_model_path)
            return

        if model_path_lower.endswith(".onnx"):
            primary_backend = InferenceBackend.ONNX_CPU
        elif model_path_lower.endswith(".xml"):
            primary_backend = InferenceBackend.OPENVINO
        else:
            primary_backend = InferenceBackend.TENSORRT if self._config.get("use_gpu", True) else InferenceBackend.PYTORCH_CPU
        self._engine_status["backend"] = getattr(primary_backend, "value", str(primary_backend))

        self._plate_engine = InferenceEngine(
            model_path=self._plate_model_path,
            backend=primary_backend,
        )
        try:
            await self._plate_engine.load()
            self._engine_status = {
                "state": "online",
                "message": "Detector de patentes cargado",
                "model_path": self._plate_model_path,
                "backend": getattr(primary_backend, "value", str(primary_backend)),
                "missing": [],
            }
        except Exception:
            self._plate_engine = InferenceEngine(
                model_path=self._plate_model_path,
                backend=InferenceBackend.PYTORCH_CPU,
            )
            try:
                await self._plate_engine.load()
                self._engine_status = {
                    "state": "online",
                    "message": "Detector de patentes cargado con fallback CPU",
                    "model_path": self._plate_model_path,
                    "backend": getattr(InferenceBackend.PYTORCH_CPU, "value", str(InferenceBackend.PYTORCH_CPU)),
                    "missing": [],
                }
            except Exception as exc:
                log.warning("lpr_advanced: inference engine unavailable (%s) — detection disabled", exc)
                self._plate_engine = None
                self._engine_status = {
                    "state": "load_error",
                    "message": f"No se pudo cargar el modelo LPR: {exc}",
                    "model_path": self._plate_model_path,
                    "backend": getattr(primary_backend, "value", str(primary_backend)),
                    "missing": [
                        {
                            "type": "runtime",
                            "path": self._plate_model_path,
                            "hint": "Verificar que el formato del modelo coincida con el runtime configurado y que las dependencias de inferencia estén instaladas.",
                        }
                    ],
                }

        if self._config.get("preload_ocr", False):
            self._ensure_ocr_engine()

    def _normalize_config(self, config: dict) -> dict:
        return {
            "plate_model_path": config.get("plate_model_path", "/models/license_plate_detector.onnx"),
            "confidence": float(config.get("confidence", 0.5)),
            "use_gpu": bool(config.get("use_gpu", True)),
            "ocr_lang": config.get("ocr_lang", "en"),
            "detection_cooldown": float(config.get("detection_cooldown", 10)),
            "frame_interval": float(config.get("frame_interval", 0.5)),
            "enabled_cameras": config.get("enabled_cameras", []),
            "country": config.get("country", "AR"),
            "enable_ocr_correction": bool(config.get("enable_ocr_correction", True)),
            "min_frames": int(config.get("min_frames", 2)),
            "dedupe_window": float(config.get("dedupe_window", config.get("detection_cooldown", 10))),
            "min_plate_width": int(config.get("min_plate_width", 32)),
            "preload_ocr": bool(config.get("preload_ocr", False)),
        }

    def _ensure_ocr_engine(self) -> None:
        if self._ocr_engine is not None:
            return
        try:
            from paddleocr import PaddleOCR
            self._ocr_engine = PaddleOCR(
                lang=self._config.get("ocr_lang", "en"),
                use_textline_orientation=True,
            )
            self._ocr_status = {
                "state": "online",
                "message": "PaddleOCR cargado",
                "lang": self._config.get("ocr_lang", "en"),
            }
        except Exception as exc:
            log.warning("PaddleOCR init failed: %s", exc)
            self._ocr_engine = None
            self._ocr_status = {
                "state": "fallback",
                "message": f"PaddleOCR no está disponible: {exc}",
                "lang": self._config.get("ocr_lang", "en"),
                "hint": "Instalar PaddleOCR o dejar el fallback simple solo para diagnóstico.",
            }

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

        frame_interval = self._config.get("frame_interval", 0.5)
        if camera_name in self._last_detections and timestamp - self._last_detections[camera_name] < frame_interval:
            return
        self._last_detections[camera_name] = timestamp

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        detections = await self._plate_engine.predict(image, conf=self._config.get("confidence", 0.5))

        plate_detections = [
            d for d in detections
            if any(kw in d["class_name"].lower() for kw in _PLATE_KEYWORDS)
        ]

        if not plate_detections:
            # Fallback: generic model (e.g. yolov8n) — crop lower 30 % of vehicle bbox
            vehicle_detections = [
                d for d in detections
                if d["class_name"] in _VEHICLE_CLASS_IDS or
                   any(kw in d["class_name"].lower() for kw in _VEHICLE_LABEL_KEYWORDS)
            ]
            if not vehicle_detections:
                return
            plate_detections = [self._vehicle_to_plate_region(d) for d in vehicle_detections]

        for plate_det in plate_detections:
            bbox = plate_det["bbox"]
            x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
            if x2 - x1 < self._config.get("min_plate_width", 32):
                continue
            plate_roi = image[y1:y2, x1:x2]

            if plate_roi.size == 0:
                continue

            plate_text = await self._read_plate_text(plate_roi)
            if not plate_text:
                continue

            raw_plate = plate_text
            plate_info = self._normalize_plate(plate_text)
            if not plate_info:
                continue
            plate_text = plate_info["plate"]

            track_id = self._track_key(camera_name, bbox)
            fusion = self._update_fusion_track(track_id, plate_text, float(plate_det["confidence"]), timestamp, raw_plate)
            if fusion["frames_used"] < self._config.get("min_frames", 2):
                continue
            plate_text = fusion["plate"]
            final_confidence = fusion["confidence"]
            is_blacklisted, reason = await self._check_blacklist(plate_text)
            annotated = image.copy()
            cv2.rectangle(
                annotated,
                (int(bbox.get("x1", 0)), int(bbox.get("y1", 0))),
                (int(bbox.get("x2", 0)), int(bbox.get("y2", 0))),
                (0, 0, 220) if is_blacklisted else (0, 180, 255),
                2,
            )
            cv2.putText(
                annotated,
                plate_text,
                (int(bbox.get("x1", 0)), max(20, int(bbox.get("y1", 0)) - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2,
            )
            ok, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 72])
            if not ok:
                continue
            snapshot_bytes = jpeg.tobytes()
            snapshot_path = AlertService._save_plugin_snapshot(
                self.name,
                "blacklisted_plate" if is_blacklisted else "lpr_plate",
                snapshot_bytes,
            )
            if snapshot_path is None:
                continue

            async with AsyncSessionLocal() as db:
                event = EventModel(
                    camera_id=None,
                    label="blacklisted_plate" if is_blacklisted else "lpr_advanced",
                    sub_label=plate_text,
                    event_type="lpr_plate",
                    source="plugin:lpr_advanced",
                    severity="critical" if is_blacklisted else "low",
                    start_time=datetime.now(timezone.utc),
                    score=_score_decimal(final_confidence),
                    zones=[],
                    has_snapshot=True,
                    snapshot_path=snapshot_path,
                    has_clip=False,
                    plate_number=plate_text,
                    plate_score=_score_decimal(final_confidence),
                    extra_metadata={
                        "plugin": "lpr_advanced",
                        "alert_type": "blacklisted_plate" if is_blacklisted else "lpr_plate",
                        "plate": plate_text,
                        "plate_text": plate_text,
                        "plate_number": plate_text,
                        "ocr_raw": raw_plate,
                        "confidence": final_confidence,
                        "detection_confidence": plate_det["confidence"],
                        "country": plate_info["country"],
                        "format": plate_info["format"],
                        "syntax_valid": plate_info["syntax_valid"],
                        "frames_used": fusion["frames_used"],
                        "tracking_id": track_id,
                        "is_blacklisted": is_blacklisted,
                        "blacklist_reason": reason,
                        "camera_name": camera_name,
                        "bbox": bbox,
                    },
                )
                db.add(event)
                await db.flush()
                db.add(LprEvent(
                    event_id=event.id,
                    camera_id=None,
                    server_id=None,
                    plate_number=plate_text,
                    plate_score=final_confidence,
                    is_blacklisted=is_blacklisted,
                    detected_at=datetime.now(timezone.utc),
                ))
                await db.commit()
                await db.refresh(event)

            if is_blacklisted:
                await self.emit_alert(
                    camera_id=camera_name,
                    alert_type="blacklisted_plate",
                    severity="critical",
                    data={
                        "plate_text": plate_text,
                        "camera_name": camera_name,
                        "confidence": final_confidence,
                        "reason": reason,
                        "bbox": bbox,
                        "event_id": getattr(event, "id", None),
                    },
                    snapshot_bytes=snapshot_bytes,
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

    def _normalize_plate(self, plate_text: str) -> dict | None:
        value = _normalize_plate_value(plate_text)
        if not value:
            return None
        country = str(self._config.get("country") or "AR").upper()
        plate = _correct_plate_ocr(value, country) if self._config.get("enable_ocr_correction", True) else value
        fmt = _plate_format(plate, country)
        if len(plate) < 5 or len(plate) > 8:
            return None
        return {
            "plate": plate,
            "country": country,
            "syntax_valid": fmt != "generic",
            "format": fmt,
        }

    def _track_key(self, camera_name: str, bbox: dict) -> str:
        cx = int((bbox["x1"] + bbox["x2"]) / 2 / 80)
        cy = int((bbox["y1"] + bbox["y2"]) / 2 / 60)
        return f"{camera_name}:{cx}:{cy}"

    def _update_fusion_track(self, key: str, plate: str, score: float, timestamp: float, raw_plate: str) -> dict:
        ttl = max(float(self._config.get("dedupe_window", 10)), 1.0) * 2
        track = self._plate_tracks.get(key)
        if not track or timestamp - track.get("updated_at", 0) > ttl:
            track = {"votes": {}, "scores": {}, "raw": [], "updated_at": timestamp}
            self._plate_tracks[key] = track
        track["updated_at"] = timestamp
        track["votes"][plate] = track["votes"].get(plate, 0) + 1
        track["scores"].setdefault(plate, []).append(score)
        track["raw"].append(raw_plate)
        best = max(track["votes"], key=lambda candidate: (track["votes"][candidate], sum(track["scores"][candidate]) / len(track["scores"][candidate])))
        avg_score = sum(track["scores"][best]) / len(track["scores"][best])
        consistency = track["votes"][best] / max(1, sum(track["votes"].values()))
        return {
            "plate": best,
            "confidence": min(1.0, (avg_score * 0.75) + (consistency * 0.25)),
            "frames_used": sum(track["votes"].values()),
            "raw_values": track["raw"][-10:],
        }

    @staticmethod
    def _vehicle_to_plate_region(detection: dict) -> dict:
        """Estimate the plate region as the lower 30 % of a vehicle bounding box."""
        bbox = detection["bbox"]
        h = bbox["y2"] - bbox["y1"]
        plate_y1 = bbox["y2"] - max(20, int(h * 0.30))
        return {
            **detection,
            "bbox": {"x1": bbox["x1"], "y1": plate_y1, "x2": bbox["x2"], "y2": bbox["y2"]},
            "class_name": "vehicle_plate_region",
        }

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
                    "default": "/models/license_plate_detector.onnx",
                    "description": "Ruta al modelo YOLO de detección de matrículas. Se descarga automáticamente en el primer despliegue.",
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
                "frame_interval": {
                    "type": "number",
                    "default": 0.5,
                    "description": "Intervalo mínimo de análisis OCR por cámara",
                },
                "dedupe_window": {
                    "type": "number",
                    "default": 10,
                    "description": "Ventana anti-duplicados y fusión temporal por cámara",
                },
                "min_frames": {
                    "type": "integer",
                    "default": 2,
                    "minimum": 1,
                    "maximum": 20,
                    "description": "Cantidad mínima de frames antes de confirmar lectura",
                },
                "country": {
                    "type": "string",
                    "default": "AR",
                    "description": "País/región para validar formato de patente (AR, ES, US, BR, CL…)",
                },
                "enable_ocr_correction": {
                    "type": "boolean",
                    "default": True,
                    "description": "Corrige confusiones OCR comunes según formato regional",
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
                "engine_loaded": plugin_self._plate_engine is not None,
                "ocr_ready": plugin_self._ocr_engine is not None,
                "last_detection_times": len(plugin_self._last_detections),
                "active_tracks": len(plugin_self._plate_tracks),
                "status": plugin_self._engine_status,
                "ocr_status": plugin_self._ocr_status,
                "configured_model_path": plugin_self._plate_model_path,
                "enabled_cameras": plugin_self._config.get("enabled_cameras") or [],
            }

        @router.post("/reset/{camera_name}")
        async def reset_camera(
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._last_detections.pop(camera_name, None)
            for key in list(plugin_self._plate_tracks):
                if key.startswith(f"{camera_name}:"):
                    plugin_self._plate_tracks.pop(key, None)
            return {"ok": True}

        return router
