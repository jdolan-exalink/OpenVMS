import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np

from app.database import AsyncSessionLocal
from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)


@dataclass
class OCRResult:
    text: str
    confidence: float
    bbox: list
    class_name: str = "text"


class OCRGeneralPlugin(BasePlugin):
    name = "ocr_general"
    version = "1.0.0"
    description = "Reconocimiento óptico de caracteres general"
    requires_gpu = False
    supports_openvino = False
    min_ram_gb = 6
    category = "recognition"
    has_sidebar_page = True
    sidebar_icon = "🔤"
    sidebar_label = "OCR"
    sidebar_route = "ocr_general"

    def __init__(self):
        self._config: dict = {}
        self._ocr_engine = None
        self._last_ocr_time: dict[str, float] = {}
        self._min_ocr_interval: float = 5.0
        self._alerted_texts: dict[str, set] = defaultdict(set)
        self._target_patterns: list = []

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._min_ocr_interval = config.get("min_ocr_interval", 5.0)
        self._target_patterns = config.get("target_patterns", [])

        if config.get("preload_ocr", False):
            self._ensure_ocr_engine()

    def _ensure_ocr_engine(self) -> bool:
        if self._ocr_engine is not None:
            return True
        try:
            from paddleocr import PaddleOCR
            import os
            os.environ.setdefault("FLAGS_use_mkldnn", "0")
            self._ocr_engine = PaddleOCR(
                lang=self._config.get("ocr_lang", "en"),
                use_textline_orientation=True,
            )
            log.info("PaddleOCR initialized successfully")
            return True
        except Exception as exc:
            log.error("Failed to initialize PaddleOCR: %s", exc)
            self._ocr_engine = None
            return False

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
        enabled_cameras = self._config.get("enabled_cameras")
        if enabled_cameras and camera_name not in enabled_cameras:
            return

        if not self._ensure_ocr_engine():
            return

        if camera_name in self._last_ocr_time:
            if timestamp - self._last_ocr_time[camera_name] < self._min_ocr_interval:
                return

        self._last_ocr_time[camera_name] = timestamp

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        regions = self._config.get("roi_regions", {})
        if regions and camera_name in regions:
            for roi in regions[camera_name]:
                await self._process_roi(image, camera_name, roi, timestamp)
        else:
            await self._process_full_image(image, camera_name, timestamp)

    async def _process_roi(self, image: np.ndarray, camera_name: str, roi: dict, timestamp: float) -> None:
        x1, y1, x2, y2 = roi.get("x1", 0), roi.get("y1", 0), roi.get("x2", 100), roi.get("y2", 100)
        roi_image = image[y1:y2, x1:x2]
        await self._perform_ocr(roi_image, camera_name, timestamp, roi.get("name", "roi"))

    async def _process_full_image(self, image: np.ndarray, camera_name: str, timestamp: float) -> None:
        await self._perform_ocr(image, camera_name, timestamp, "full_frame")

    async def _perform_ocr(self, image: np.ndarray, camera_name: str, timestamp: float, region: str) -> None:
        try:
            try:
                result = self._ocr_engine.ocr(image, cls=True)
            except TypeError:
                result = self._ocr_engine.ocr(image)
            if not result or not result[0]:
                return

            ocr_results = []
            for line in result[0]:
                if line and len(line) >= 2:
                    bbox = line[0]
                    text_info = line[1]
                    if isinstance(text_info, (list, tuple)) and len(text_info) >= 2:
                        text, confidence = text_info[0], text_info[1]
                    else:
                        text, confidence = str(text_info), 0.5

                    ocr_results.append(OCRResult(
                        text=str(text),
                        confidence=float(confidence),
                        bbox=bbox,
                    ))

            await self._process_results(ocr_results, camera_name, timestamp, region, image)

        except Exception as exc:
            log.warning("OCR failed for %s: %s", camera_name, exc)

    async def _process_results(
        self,
        results: list[OCRResult],
        camera_name: str,
        timestamp: float,
        region: str,
        image: np.ndarray,
    ) -> None:
        for result in results:
            text = result.text.strip()
            if not text:
                continue

            if len(text) < self._config.get("min_text_length", 3):
                continue

            confidence_threshold = self._config.get("confidence_threshold", 0.6)
            if result.confidence < confidence_threshold:
                continue

            is_match = False
            match_reason = ""

            if self._target_patterns:
                import re
                for pattern in self._target_patterns:
                    if re.search(pattern, text, re.IGNORECASE):
                        is_match = True
                        match_reason = f"pattern:{pattern}"
                        break

            whitelist = self._config.get("whitelist", [])
            if whitelist and any(term.lower() in text.lower() for term in whitelist):
                is_match = True
                match_reason = "whitelist_match"

            if not is_match:
                continue

            alerted_texts = self._alerted_texts.get(camera_name, set())
            cooldown = self._config.get("alert_cooldown", 300)

            text_hash = hash(text)
            if text_hash in alerted_texts:
                continue

            alerted_texts.add(text_hash)
            self._alerted_texts[camera_name] = alerted_texts

            _, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 70])

            await self.emit_alert(
                camera_id=camera_name,
                alert_type="ocr_match",
                severity=self._config.get("alert_severity", "medium"),
                data={
                    "recognized_text": text,
                    "confidence": result.confidence,
                    "camera_name": camera_name,
                    "region": region,
                    "bbox": result.bbox,
                    "match_reason": match_reason,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                snapshot_bytes=jpeg.tobytes(),
            )

            await self._save_ocr_event(text, result.confidence, camera_name, region, result.bbox)

    async def _save_ocr_event(
        self,
        text: str,
        confidence: float,
        camera_name: str,
        region: str,
        bbox: list,
    ) -> None:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.event import Event as EventModel

            try:
                event = EventModel(
                    camera_id=camera_name,
                    label="ocr_general",
                    sub_label=text[:100],
                    source="plugin:ocr_general",
                    severity="medium",
                    has_snapshot=True,
                    metadata={
                        "recognized_text": text,
                        "confidence": confidence,
                        "region": region,
                        "bbox": bbox,
                    },
                )
                db.add(event)
                await db.commit()
            except Exception as exc:
                log.error("Failed to save OCR event: %s", exc)

    async def on_unload(self) -> None:
        self._ocr_engine = None
        self._alerted_texts.clear()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "ocr_lang": {
                    "type": "string",
                    "default": "en",
                    "description": "Idioma PaddleOCR (en, ch, fr, de, etc.)",
                },
                "use_gpu": {
                    "type": "boolean",
                    "default": False,
                },
                "confidence_threshold": {
                    "type": "number",
                    "default": 0.6,
                    "minimum": 0,
                    "maximum": 1,
                },
                "min_text_length": {
                    "type": "integer",
                    "default": 3,
                    "description": "Longitud mínima de texto a considerar",
                },
                "min_ocr_interval": {
                    "type": "number",
                    "default": 5.0,
                    "description": "Intervalo mínimo entre ejecuciones OCR (segundos)",
                },
                "alert_cooldown": {
                    "type": "number",
                    "default": 300,
                    "description": "Cooldown entre alertas del mismo texto (segundos)",
                },
                "alert_severity": {
                    "type": "string",
                    "default": "medium",
                    "enum": ["low", "medium", "high", "critical"],
                },
                "target_patterns": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Patrones regex para detectar texto de interés",
                },
                "whitelist": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Términos que siempre disparan alerta",
                },
                "roi_regions": {
                    "type": "object",
                    "description": "Regiones de interés por cámara {x1,y1,x2,y2}",
                    "additionalProperties": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "x1": {"type": "integer"},
                                "y1": {"type": "integer"},
                                "x2": {"type": "integer"},
                                "y2": {"type": "integer"},
                            },
                        },
                    },
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
                "ocr_ready": plugin_self._ocr is not None,
                "cooldown_keys": len(plugin_self._text_cooldown),
                "last_results": len(plugin_self._last_results),
            }

        @router.post("/reset-cooldown")
        async def reset_cooldown(
            camera_name: str = "",
            _=Depends(get_current_user),
        ):
            if camera_name:
                plugin_self._text_cooldown.pop(camera_name, None)
            else:
                plugin_self._text_cooldown.clear()
            return {"ok": True}

        return router
