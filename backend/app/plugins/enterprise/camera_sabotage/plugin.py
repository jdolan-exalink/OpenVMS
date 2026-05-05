from __future__ import annotations

import time
from typing import Optional

import cv2
import numpy as np

from app.plugins.base import BasePlugin


class CameraSabotagePlugin(BasePlugin):
    name = "camera_sabotage"
    version = "1.0.0"
    description = "Detección de sabotaje: tapado, desenfoque, movimiento brusco"
    supports_openvino = True
    min_ram_gb = 8
    category = "security"
    has_sidebar_page = True
    sidebar_icon = "🛡"
    sidebar_label = "Sabotaje"
    sidebar_route = "camera_sabotage"

    def __init__(self):
        self._config: dict = {}
        self._reference_frames: dict[str, bytes] = {}
        self._consecutive_alerts: dict[str, int] = {}
        self._last_ref_update: dict[str, float] = {}

    async def on_load(self, config: dict) -> None:
        self._config = config

    async def on_event(self, event: dict) -> None:
        pass

    def get_frame_subscriptions(self) -> list[str]:
        return self._config.get("monitored_cameras") or []

    async def on_frame(
        self,
        camera_name: str,
        frame: bytes,
        timestamp: float,
        width: int,
        height: int,
    ) -> None:
        img = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None:
            return

        sabotage_type: Optional[str] = None

        mean_brightness = np.mean(img)
        if mean_brightness < 5:
            sabotage_type = "loss_of_signal"
        elif np.std(img) < 8:
            sabotage_type = "solid_color"
        elif self._detect_blur(img):
            sabotage_type = "blur"
        elif camera_name in self._reference_frames:
            ref = cv2.imdecode(
                np.frombuffer(self._reference_frames[camera_name], np.uint8),
                cv2.IMREAD_GRAYSCALE,
            )
            if ref is not None and ref.shape == img.shape:
                ssim_score = self._compute_ssim(img, ref)
                if ssim_score < self._config.get("ssim_threshold", 0.4):
                    sabotage_type = "scene_change"

        self._update_reference_frame(camera_name, frame, timestamp)

        if sabotage_type:
            count = self._consecutive_alerts.get(camera_name, 0) + 1
            self._consecutive_alerts[camera_name] = count
            required = self._config.get("consecutive_frames_required", 3)
            if count >= required:
                self._consecutive_alerts[camera_name] = 0
                await self.emit_alert(
                    camera_id="",
                    alert_type="camera_sabotage",
                    severity="critical",
                    data={
                        "sabotage_type": sabotage_type,
                        "camera_name": camera_name,
                        "timestamp": timestamp,
                    },
                    snapshot_bytes=frame,
                )
        else:
            self._consecutive_alerts[camera_name] = 0

    def _detect_blur(self, gray_img) -> bool:
        laplacian_var = cv2.Laplacian(gray_img, cv2.CV_64F).var()
        return laplacian_var < self._config.get("blur_threshold", 50)

    def _compute_ssim(self, img1, img2) -> float:
        try:
            from skimage.metrics import structural_similarity as ssim

            score, _ = ssim(img1, img2, full=True, channel_axis=False)
            return float(score)
        except Exception:
            return 1.0

    def _update_reference_frame(self, camera_name: str, frame: bytes, timestamp: float) -> None:
        last = self._last_ref_update.get(camera_name, 0)
        if timestamp - last > 60:
            self._reference_frames[camera_name] = frame
            self._last_ref_update[camera_name] = timestamp

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "blur_threshold": {
                    "type": "number",
                    "default": 50,
                    "description": "Varianza Laplacian mínima para considerar imagen enfocada",
                },
                "ssim_threshold": {
                    "type": "number",
                    "default": 0.4,
                    "description": "SSIM mínimo para considerar escena normal (0-1)",
                },
                "consecutive_frames_required": {
                    "type": "integer",
                    "default": 3,
                    "description": "Frames consecutivos con sabotage para disparar alerta",
                },
                "monitored_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
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
                "monitored_cameras": len(plugin_self._reference_frames),
                "consecutive_alerts": len(plugin_self._consecutive_alerts),
            }

        @router.delete("/reset/{camera_name}")
        async def reset_camera(
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._reference_frames.pop(camera_name, None)
            plugin_self._consecutive_alerts.pop(camera_name, None)
            plugin_self._last_ref_update.pop(camera_name, None)
            return {"ok": True}

        return router
