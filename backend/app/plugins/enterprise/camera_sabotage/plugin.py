from __future__ import annotations

import asyncio
import os
import subprocess
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.camera import Camera
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
        self._reference_frames: dict[str, np.ndarray] = {}
        self._consecutive_alerts: dict[str, int] = {}
        self._last_ref_update: dict[str, float] = {}
        self._camera_ids: dict[str, str] = {}
        self._frame_history: dict[str, deque[tuple[float, bytes]]] = {}
        self._active_sabotage: dict[str, dict] = {}
        self._recovery_counts: dict[str, int] = {}
        self._last_frame_seen: dict[str, float] = {}
        self._monitor_task: asyncio.Task | None = None

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._monitor_task = asyncio.create_task(self._monitor_signal_loss())

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
        self._remember_frame(camera_name, timestamp, frame)
        self._last_frame_seen[camera_name] = timestamp
        img = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None:
            return

        analysis_img = self._prepare_analysis_frame(img)
        sabotage_type: Optional[str] = None

        mean_brightness = float(np.mean(analysis_img))
        image_std = float(np.std(analysis_img))
        if self._sabotage_type_enabled("loss_of_signal") and mean_brightness < 5:
            sabotage_type = "loss_of_signal"
        elif self._sabotage_type_enabled("solid_color") and self._is_uniform_image(analysis_img, mean_brightness, image_std):
            sabotage_type = "solid_color"
        elif self._sabotage_type_enabled("blur") and self._detect_blur(analysis_img):
            sabotage_type = "blur"
        elif self._sabotage_type_enabled("scene_change") and camera_name in self._reference_frames:
            ref = self._reference_frames[camera_name]
            if ref.shape == analysis_img.shape:
                ssim_score = self._compute_ssim(analysis_img, ref)
                if ssim_score < self._config.get("ssim_threshold", 0.4):
                    sabotage_type = "scene_change"

        if sabotage_type:
            count = self._consecutive_alerts.get(camera_name, 0) + 1
            self._consecutive_alerts[camera_name] = count
            self._recovery_counts[camera_name] = 0
            required = self._config.get("consecutive_frames_required", 3)
            if count >= required and camera_name not in self._active_sabotage:
                self._consecutive_alerts[camera_name] = 0
                evidence_snapshot = self._pre_event_snapshot(camera_name, timestamp) or frame
                await self._emit_sabotage_started(
                    camera_name,
                    sabotage_type,
                    timestamp,
                    evidence_snapshot,
                )
        else:
            self._consecutive_alerts[camera_name] = 0
            self._update_reference_frame(camera_name, analysis_img, timestamp)
            if camera_name in self._active_sabotage:
                recovered = self._recovery_counts.get(camera_name, 0) + 1
                self._recovery_counts[camera_name] = recovered
                if recovered >= int(self._config.get("recovery_frames_required", 3)):
                    state = self._active_sabotage.pop(camera_name)
                    self._recovery_counts[camera_name] = 0
                    camera_id = state.get("camera_id") or await self._resolve_camera_id(camera_name)
                    if camera_id is None:
                        return
                    clip_path = self._save_pre_event_clip(camera_name, timestamp)
                    await self.emit_alert(
                        camera_id=camera_id,
                        alert_type="camera_sabotage_recovered",
                        severity="low",
                        data={
                            "sabotage_type": state.get("type"),
                            "camera_name": camera_name,
                            "timestamp": timestamp,
                            "started_at": state.get("started_at"),
                            "duration_seconds": round(timestamp - float(state.get("started_at") or timestamp), 2),
                            "active": False,
                        },
                        snapshot_bytes=frame,
                        clip_path=clip_path,
                    )

    def _detect_blur(self, gray_img) -> bool:
        laplacian_var = cv2.Laplacian(gray_img, cv2.CV_64F).var()
        return laplacian_var < self._config.get("blur_threshold", 50)

    def _sabotage_type_enabled(self, sabotage_type: str) -> bool:
        enabled_types = self._config.get("enabled_sabotage_types")
        if isinstance(enabled_types, list):
            return sabotage_type in enabled_types

        legacy_key = f"detect_{sabotage_type}"
        defaults = {
            "loss_of_signal": True,
            "solid_color": False,
            "blur": False,
            "scene_change": True,
        }
        return bool(self._config.get(legacy_key, defaults.get(sabotage_type, True)))

    def _is_uniform_image(self, gray_img: np.ndarray, mean_brightness: float, image_std: float) -> bool:
        if mean_brightness < 5:
            return True
        if not self._config.get("detect_solid_color", False):
            return False

        threshold = float(self._config.get("solid_color_std_threshold", 2.0))
        if image_std > threshold:
            return False

        # A quiet scene can have low global variance. Treat it as sabotage only
        # when almost every pixel is close to the same value.
        tolerance = float(self._config.get("solid_color_pixel_tolerance", 4.0))
        uniform_ratio = float(np.mean(np.abs(gray_img.astype(np.float32) - mean_brightness) <= tolerance))
        required_ratio = float(self._config.get("solid_color_uniform_ratio", 0.995))
        return uniform_ratio >= required_ratio

    def _prepare_analysis_frame(self, gray_img: np.ndarray) -> np.ndarray:
        max_width = int(self._config.get("analysis_width", 640))
        if max_width <= 0:
            return gray_img

        height, width = gray_img.shape[:2]
        if width <= max_width:
            return gray_img

        scale = max_width / width
        target_size = (max_width, max(1, int(height * scale)))
        return cv2.resize(gray_img, target_size, interpolation=cv2.INTER_AREA)

    def _compute_ssim(self, img1, img2) -> float:
        try:
            from skimage.metrics import structural_similarity as ssim

            score, _ = ssim(img1, img2, full=True, channel_axis=False)
            return float(score)
        except Exception:
            return 1.0

    def _update_reference_frame(self, camera_name: str, analysis_img: np.ndarray, timestamp: float) -> None:
        last = self._last_ref_update.get(camera_name, 0)
        if timestamp - last > 60:
            self._reference_frames[camera_name] = analysis_img.copy()
            self._last_ref_update[camera_name] = timestamp

    async def _resolve_camera_id(self, camera_name: str) -> str | None:
        if camera_name in self._camera_ids:
            return self._camera_ids[camera_name]
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Camera.id).where(Camera.frigate_name == camera_name))
                camera_id = result.scalar_one_or_none()
                if camera_id:
                    self._camera_ids[camera_name] = str(camera_id)
                    return str(camera_id)
        except Exception:
            return None
        return None

    async def _emit_sabotage_started(
        self,
        camera_name: str,
        sabotage_type: str,
        timestamp: float,
        snapshot_bytes: bytes,
    ) -> None:
        if camera_name in self._active_sabotage:
            return
        camera_id = await self._resolve_camera_id(camera_name)
        if camera_id is None:
            return
        clip_path = self._save_pre_event_clip(camera_name, timestamp)
        self._active_sabotage[camera_name] = {
            "type": sabotage_type,
            "started_at": timestamp,
            "camera_id": camera_id,
        }
        await self.emit_alert(
            camera_id=camera_id,
            alert_type="camera_sabotage",
            severity="critical",
            data={
                "sabotage_type": sabotage_type,
                "camera_name": camera_name,
                "timestamp": timestamp,
                "pre_event_seconds": self._pre_event_seconds(),
                "active": True,
            },
            snapshot_bytes=snapshot_bytes,
            clip_path=clip_path,
        )

    async def _monitor_signal_loss(self) -> None:
        while True:
            try:
                await asyncio.sleep(2)
                now = time.time()
                threshold = float(self._config.get("signal_loss_seconds", 15))
                for camera_name, last_seen in list(self._last_frame_seen.items()):
                    if camera_name in self._active_sabotage:
                        continue
                    if now - last_seen < threshold:
                        continue
                    snapshot = self._pre_event_snapshot(camera_name, now)
                    if snapshot is None:
                        continue
                    await self._emit_sabotage_started(camera_name, "loss_of_signal", now, snapshot)
            except asyncio.CancelledError:
                break
            except Exception:
                continue

    async def on_unload(self) -> None:
        if self._monitor_task is not None:
            self._monitor_task.cancel()
            self._monitor_task = None

    def _remember_frame(self, camera_name: str, timestamp: float, frame: bytes) -> None:
        history = self._frame_history.setdefault(camera_name, deque())
        history.append((timestamp, frame))
        cutoff = timestamp - max(self._pre_event_seconds() + 2.0, 3.0)
        while history and history[0][0] < cutoff:
            history.popleft()

    def _pre_event_seconds(self) -> float:
        return float(self._config.get("pre_event_seconds", 10))

    def _clip_fps(self) -> float:
        return float(self._config.get("clip_fps", 2))

    def _save_pre_event_clip(self, camera_name: str, timestamp: float) -> str | None:
        frames = [
            frame
            for ts, frame in self._frame_history.get(camera_name, [])
            if timestamp - self._pre_event_seconds() <= ts <= timestamp
        ]
        if len(frames) < 2:
            return None

        try:
            decoded = []
            for raw in frames:
                image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
                if image is not None:
                    decoded.append(image)
            if len(decoded) < 2:
                return None

            height, width = decoded[-1].shape[:2]
            base_dir = Path(os.getenv("PLUGIN_CLIP_DIR", "/tmp/exports/plugin_clips"))
            day = datetime.now(timezone.utc).strftime("%Y/%m/%d")
            out_dir = base_dir / self.name / day
            out_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{datetime.now(timezone.utc).strftime('%H%M%S_%f')}_camera_sabotage.mp4"
            path = out_dir / filename
            tmp_path = path.with_name(f"{path.stem}.raw{path.suffix}")

            writer = cv2.VideoWriter(
                str(tmp_path),
                cv2.VideoWriter_fourcc(*"mp4v"),
                max(0.5, self._clip_fps()),
                (width, height),
            )
            if not writer.isOpened():
                return None
            for image in decoded:
                if image.shape[1] != width or image.shape[0] != height:
                    image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
                writer.write(image)
            writer.release()
            if not tmp_path.exists() or tmp_path.stat().st_size <= 0:
                return None
            try:
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-loglevel",
                        "error",
                        "-i",
                        str(tmp_path),
                        "-an",
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        str(path),
                    ],
                    check=True,
                    timeout=25,
                )
                tmp_path.unlink(missing_ok=True)
            except Exception:
                tmp_path.replace(path)
            return str(path) if path.exists() and path.stat().st_size > 0 else None
        except Exception:
            return None

    def _pre_event_snapshot(self, camera_name: str, timestamp: float) -> bytes | None:
        history = self._frame_history.get(camera_name, [])
        if not history:
            return None
        target = timestamp - min(self._pre_event_seconds(), 10.0)
        before = [(ts, frame) for ts, frame in history if ts < timestamp]
        if not before:
            return None
        return min(before, key=lambda item: abs(item[0] - target))[1]

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "detect_loss_of_signal": {
                    "type": "boolean",
                    "default": True,
                    "description": "Detectar corte de servicio o frames negros como posible sabotaje",
                },
                "detect_solid_color": {
                    "type": "boolean",
                    "default": False,
                    "description": "Detectar imagen casi uniforme como posible tapado o señal inválida",
                },
                "detect_blur": {
                    "type": "boolean",
                    "default": False,
                    "description": "Detectar desenfoque persistente como posible sabotaje",
                },
                "detect_scene_change": {
                    "type": "boolean",
                    "default": True,
                    "description": "Detectar cambio fuerte de escena como posible movimiento de cámara",
                },
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
                "solid_color_std_threshold": {
                    "type": "number",
                    "default": 2,
                    "minimum": 0,
                    "maximum": 20,
                    "description": "Desvío estándar máximo para considerar una imagen casi uniforme",
                },
                "solid_color_uniform_ratio": {
                    "type": "number",
                    "default": 0.995,
                    "minimum": 0.9,
                    "maximum": 1,
                    "description": "Proporción de píxeles que deben tener casi el mismo valor",
                },
                "consecutive_frames_required": {
                    "type": "integer",
                    "default": 3,
                    "description": "Frames consecutivos con sabotage para disparar alerta",
                },
                "analysis_width": {
                    "type": "integer",
                    "default": 640,
                    "minimum": 160,
                    "description": "Ancho máximo en píxeles usado para análisis interno",
                },
                "pre_event_seconds": {
                    "type": "number",
                    "default": 10,
                    "minimum": 2,
                    "maximum": 30,
                    "description": "Segundos previos a guardar como clip cuando se detecta sabotaje",
                },
                "recovery_frames_required": {
                    "type": "integer",
                    "default": 3,
                    "minimum": 1,
                    "maximum": 30,
                    "description": "Frames normales consecutivos para emitir recuperación",
                },
                "signal_loss_seconds": {
                    "type": "number",
                    "default": 15,
                    "minimum": 5,
                    "maximum": 120,
                    "description": "Segundos sin frames para considerar corte de servicio",
                },
                "clip_fps": {
                    "type": "number",
                    "default": 2,
                    "minimum": 0.5,
                    "maximum": 10,
                    "description": "FPS del clip de evidencia",
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
                "active_sabotage_cameras": len(plugin_self._active_sabotage),
                "active_sabotage": [
                    {
                        "camera_name": camera_name,
                        "sabotage_type": state.get("type"),
                        "started_at": state.get("started_at"),
                    }
                    for camera_name, state in plugin_self._active_sabotage.items()
                ],
            }

        @router.delete("/reset/{camera_name}")
        async def reset_camera(
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._reference_frames.pop(camera_name, None)
            plugin_self._consecutive_alerts.pop(camera_name, None)
            plugin_self._last_ref_update.pop(camera_name, None)
            plugin_self._camera_ids.pop(camera_name, None)
            plugin_self._frame_history.pop(camera_name, None)
            plugin_self._active_sabotage.pop(camera_name, None)
            plugin_self._recovery_counts.pop(camera_name, None)
            return {"ok": True}

        return router
