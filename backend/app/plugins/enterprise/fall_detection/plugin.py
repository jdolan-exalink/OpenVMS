from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.camera import Camera
from app.plugins.base import BasePlugin

log = logging.getLogger(__name__)


@dataclass
class PersonTrack:
    person_id: int
    keypoints_history: list[dict] = field(default_factory=list)
    fall_start_time: Optional[float] = None
    alerted: bool = False
    last_seen: float = 0


class FallDetectionPlugin(BasePlugin):
    name = "fall_detection"
    version = "1.0.0"
    description = "Detección de caídas mediante MediaPipe Pose"
    requires_gpu = False
    supports_openvino = False
    min_ram_gb = 4
    category = "safety"
    has_sidebar_page = True
    sidebar_icon = "🚨"
    sidebar_label = "Caídas"
    sidebar_route = "fall_detection"

    def __init__(self):
        self._config: dict = {}
        self._pose = None
        self._person_tracks: dict[str, dict[int, PersonTrack]] = defaultdict(dict)
        self._alerted_tracks: dict[str, dict[int, float]] = defaultdict(dict)
        self._camera_ids: dict[str, str] = {}

    async def on_load(self, config: dict) -> None:
        self._config = self._normalize_config(config)

        try:
            import mediapipe as mp
            self._mp_pose = mp.solutions.pose
            self._pose = self._mp_pose.Pose(
                static_image_mode=False,
                model_complexity=self._config["model_complexity"],
                enable_segmentation=False,
                min_detection_confidence=self._config["detection_confidence"],
                min_tracking_confidence=self._config["tracking_confidence"],
            )
            log.info("MediaPipe Pose initialized successfully")
        except Exception as exc:
            log.error("Failed to initialize MediaPipe Pose: %s", exc)
            self._pose = None

    async def on_event(self, event: dict) -> None:
        return None

    def _normalize_config(self, config: dict) -> dict:
        sensitivity = config.get("sensitivity", "normal")
        presets = {
            "low": {"fall_angle_threshold": 60, "detection_confidence": 0.65, "tracking_confidence": 0.65},
            "normal": {"fall_angle_threshold": 50, "detection_confidence": 0.55, "tracking_confidence": 0.55},
            "high": {"fall_angle_threshold": 40, "detection_confidence": 0.45, "tracking_confidence": 0.45},
        }
        preset = presets.get(sensitivity, presets["normal"])
        return {
            "enabled_cameras": config.get("enabled_cameras", []),
            "sensitivity": sensitivity,
            "alert_cooldown": config.get("alert_cooldown", 60),
            "model_complexity": config.get("model_complexity", 1),
            "detection_confidence": config.get("detection_confidence", preset["detection_confidence"]),
            "tracking_confidence": config.get("tracking_confidence", preset["tracking_confidence"]),
            "fall_angle_threshold": config.get("fall_angle_threshold", preset["fall_angle_threshold"]),
        }

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
        if self._pose is None:
            return

        nparr = np.frombuffer(frame, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        rgb_image.flags.writeable = False

        try:
            results = self._pose.process(rgb_image)
        except Exception as exc:
            log.warning("Pose detection failed: %s", exc)
            return

        if not results.pose_landmarks:
            return

        landmarks = results.pose_landmarks.landmark
        keypoints = self._extract_keypoints(landmarks, width, height)

        person_id = self._assign_person_id(camera_name, keypoints, timestamp)
        track = self._person_tracks[camera_name].setdefault(
            person_id, PersonTrack(person_id=person_id)
        )
        track.keypoints_history.append(keypoints)
        track.last_seen = timestamp

        if len(track.keypoints_history) > 30:
            track.keypoints_history.pop(0)

        fall_detected, fall_confidence = self._detect_fall(track)

        if fall_detected:
            cooldown = self._config.get("alert_cooldown", 60)
            last_alert = self._alerted_tracks[camera_name].get(person_id, 0)

            if timestamp - last_alert < cooldown:
                return

            self._alerted_tracks[camera_name][person_id] = timestamp

            fall_type = self._classify_fall_type(track.keypoints_history[-1])
            camera_id = await self._resolve_camera_id(camera_name)

            _, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 70])

            await self.emit_alert(
                camera_id=camera_id or "",
                alert_type="fall_detected",
                severity="high",
                data={
                    "person_id": person_id,
                    "camera_name": camera_name,
                    "fall_confidence": fall_confidence,
                    "fall_type": fall_type,
                    "keypoints": keypoints,
                    "timestamp": timestamp,
                },
                snapshot_bytes=jpeg.tobytes(),
            )

        self._cleanup_old_tracks(camera_name, timestamp)

    async def _resolve_camera_id(self, camera_name: str) -> Optional[str]:
        if camera_name in self._camera_ids:
            return self._camera_ids[camera_name]
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Camera.id).where(Camera.frigate_name == camera_name))
                camera_id = result.scalar_one_or_none()
                if camera_id:
                    self._camera_ids[camera_name] = str(camera_id)
                    return str(camera_id)
        except Exception as exc:
            log.warning("Could not resolve camera id for fall_detection camera=%s: %s", camera_name, exc)
        return None

    def _extract_keypoints(self, landmarks, width: int, height: int) -> dict:
        keypoint_names = [
            "nose", "left_eye_inner", "left_eye", "left_eye_outer",
            "right_eye_inner", "right_eye", "right_eye_outer",
            "left_ear", "right_ear", "mouth_left", "mouth_right",
            "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
            "left_wrist", "right_wrist", "left_pinky", "right_pinky",
            "left_index", "right_index", "left_thumb", "right_thumb",
            "left_hip", "right_hip", "left_knee", "right_knee",
            "left_ankle", "right_ankle", "left_heel", "right_heel",
            "left_foot_index", "right_foot_index"
        ]

        keypoints = {}
        for i, name in enumerate(keypoint_names):
            if i < len(landmarks):
                lm = landmarks[i]
                keypoints[name] = {
                    "x": lm.x * width,
                    "y": lm.y * height,
                    "z": lm.z * width,
                    "visibility": lm.visibility,
                }

        center_hip = self._calculate_center(
            keypoints.get("left_hip", {"x": 0, "y": 0}),
            keypoints.get("right_hip", {"x": 0, "y": 0})
        )
        keypoints["center_hip"] = center_hip

        shoulder_center = self._calculate_center(
            keypoints.get("left_shoulder", {"x": 0, "y": 0}),
            keypoints.get("right_shoulder", {"x": 0, "y": 0})
        )
        keypoints["shoulder_center"] = shoulder_center

        ankle_center = self._calculate_center(
            keypoints.get("left_ankle", {"x": 0, "y": 0}),
            keypoints.get("right_ankle", {"x": 0, "y": 0})
        )
        keypoints["ankle_center"] = ankle_center

        return keypoints

    def _calculate_center(self, p1: dict, p2: dict) -> dict:
        return {
            "x": (p1.get("x", 0) + p2.get("x", 0)) / 2,
            "y": (p1.get("y", 0) + p2.get("y", 0)) / 2,
        }

    def _assign_person_id(self, camera_name: str, keypoints: dict, timestamp: float) -> int:
        tracks = self._person_tracks[camera_name]
        center_hip = keypoints.get("center_hip", {"x": 0, "y": 0})

        best_id = None
        best_dist = float("inf")

        for person_id, track in tracks.items():
            if not track.keypoints_history:
                continue
            prev_center = track.keypoints_history[-1].get("center_hip", {"x": 0, "y": 0})
            dist = ((center_hip["x"] - prev_center["x"])**2 + (center_hip["y"] - prev_center["y"])**2)**0.5
            if dist < best_dist and dist < 150:
                best_dist = dist
                best_id = person_id

        if best_id is not None:
            return best_id

        new_id = max([t.person_id for t in tracks.values()], default=0) + 1
        return new_id

    def _detect_fall(self, track: PersonTrack) -> tuple[bool, float]:
        if len(track.keypoints_history) < 15:
            return False, 0.0

        recent = track.keypoints_history[-15:]
        first = recent[0]
        last = recent[-1]

        first_hip_y = first.get("center_hip", {}).get("y", 0)
        last_hip_y = last.get("center_hip", {}).get("y", 0)

        hip_height_change = last_hip_y - first_hip_y

        if hip_height_change < 50:
            return False, 0.0

        first_shoulder_y = first.get("shoulder_center", {}).get("y", 0)
        last_shoulder_y = last.get("shoulder_center", {}).get("y", 0)

        shoulder_height_change = last_shoulder_y - first_shoulder_y

        if shoulder_height_change < 40:
            return False, 0.0

        pose_angle = self._calculate_pose_angle(last)

        if pose_angle < self._config.get("fall_angle_threshold", 45):
            return False, 0.0

        confidence = min(1.0, (hip_height_change + shoulder_height_change) / 300)

        return True, confidence

    def _calculate_pose_angle(self, keypoints: dict) -> float:
        shoulder = keypoints.get("shoulder_center", {"x": 0, "y": 0})
        hip = keypoints.get("center_hip", {"x": 0, "y": 0})
        ankle = keypoints.get("ankle_center", {"x": 0, "y": 0})

        dx = shoulder["x"] - ankle["x"]
        dy = shoulder["y"] - ankle["y"]

        if dy == 0:
            return 90.0

        angle = abs(np.arctan2(dy, dx) * 180 / np.pi)

        return angle

    def _classify_fall_type(self, keypoints: dict) -> str:
        nose_y = keypoints.get("nose", {}).get("y", 0)
        ankle_y = keypoints.get("ankle_center", {}).get("y", 0)

        body_horizontal = abs(keypoints.get("left_shoulder", {}).get("x", 0) -
                              keypoints.get("right_shoulder", {}).get("x", 0)) > \
                          abs(keypoints.get("left_shoulder", {}).get("y", 0) -
                              keypoints.get("right_shoulder", {}).get("y", 0))

        if body_horizontal:
            return "lateral"
        return "forward"

    def _cleanup_old_tracks(self, camera_name: str, current_time: float) -> None:
        timeout = 10.0
        tracks = self._person_tracks.get(camera_name, {})
        stale_ids = [
            pid for pid, track in tracks.items()
            if current_time - track.last_seen > timeout
        ]
        for pid in stale_ids:
            tracks.pop(pid, None)

    async def on_unload(self) -> None:
        self._pose = None
        self._person_tracks.clear()
        self._alerted_tracks.clear()
        self._camera_ids.clear()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "title": "Detección de caídas",
            "description": (
                "Analiza la postura de una persona en video. Genera una alerta de severidad alta "
                "cuando detecta una caída probable por cambio brusco de cadera/hombros y cuerpo horizontal."
            ),
            "properties": {
                "enabled_cameras": {
                    "type": "array",
                    "title": "Cámaras a monitorear",
                    "items": {"type": "string"},
                    "default": [],
                    "description": "Lista de nombres Frigate. Vacío = monitorear todas las cámaras.",
                },
                "sensitivity": {
                    "type": "string",
                    "title": "Sensibilidad",
                    "enum": ["low", "normal", "high"],
                    "default": "normal",
                    "description": "Alta detecta más caídas pero puede generar más falsos positivos; baja es más estricta.",
                },
                "alert_cooldown": {
                    "type": "number",
                    "title": "Tiempo entre alertas",
                    "default": 60,
                    "minimum": 10,
                    "description": "Segundos mínimos antes de volver a alertar por la misma persona/cámara.",
                },
                "model_complexity": {
                    "type": "integer",
                    "title": "Calidad del modelo",
                    "default": 1,
                    "enum": [0, 1, 2],
                    "description": "0 rápido, 1 recomendado, 2 más preciso y más pesado.",
                },
                "fall_angle_threshold": {
                    "type": "number",
                    "title": "Umbral avanzado de ángulo",
                    "default": 50,
                    "description": "Opcional. Ángulo mínimo del cuerpo para considerar caída.",
                },
            },
            "default": {
                "enabled_cameras": [],
                "sensitivity": "normal",
                "alert_cooldown": 60,
                "model_complexity": 1,
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
                "pose_initialized": plugin_self._pose is not None,
                "active_tracks": sum(len(t) for t in plugin_self._person_tracks.values()),
                "alerted_tracks": sum(len(t) for t in plugin_self._alerted_tracks.values()),
            }

        @router.delete("/tracks/{person_id}")
        async def clear_person(
            person_id: int,
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._person_tracks.get(camera_name, {}).pop(person_id, None)
            plugin_self._alerted_tracks.get(camera_name, {}).pop(person_id, None)
            return {"ok": True}

        return router
