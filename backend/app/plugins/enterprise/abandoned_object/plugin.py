import logging
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import cv2
import numpy as np

from app.plugins.base import BasePlugin
from app.plugins.shared.inference_engine import InferenceBackend, InferenceEngine
from app.plugins.shared.tracker import Detection, TrackerManager

log = logging.getLogger(__name__)


class ObjectState(str, Enum):
    NEW = "NEW"
    MOVING = "MOVING"
    STATIC_CANDIDATE = "STATIC_CANDIDATE"
    ABANDONED_PENDING = "ABANDONED_PENDING"
    ABANDONED_CONFIRMED = "ABANDONED_CONFIRMED"
    REMOVED = "REMOVED"
    CLEARED = "CLEARED"


@dataclass
class ZoneRule:
    name: str
    zone_type: str
    polygon: list[tuple[float, float]]
    min_abandoned_seconds: int
    suspicious_seconds: int
    pending_seconds: int
    severity_boost: int = 0


@dataclass
class ObjectTrackState:
    track_id: int
    class_name: str
    confidence: float
    first_seen: float
    last_seen: float
    bbox: dict
    state: ObjectState = ObjectState.NEW
    positions: list[tuple[float, float]] = field(default_factory=list)
    bbox_history: list[dict] = field(default_factory=list)
    owner_track_id: Optional[int] = None
    owner_last_seen: Optional[float] = None
    static_since: Optional[float] = None
    unattended_since: Optional[float] = None
    zone_name: Optional[str] = None
    zone_type: str = "default"
    emitted_events: set[str] = field(default_factory=set)


class AbandonedObjectPlugin(BasePlugin):
    name = "abandoned_object"
    version = "1.1.0"
    description = "Detección profesional de objetos abandonados, removidos y permanencia sospechosa"
    display_name = "Objeto Abandonado"
    requires_gpu = True
    supports_openvino = True
    min_ram_gb = 8
    category = "analytics"
    has_sidebar_page = True
    sidebar_icon = "📦"
    sidebar_label = "Obj. Abandonado"
    sidebar_route = "abandoned_object"

    DEFAULT_OBJECT_LABELS = {
        "backpack",
        "suitcase",
        "handbag",
        "box",
        "package",
        "bag",
        "bottle",
        "bicycle",
        "motorcycle",
        "car",
        "truck",
    }
    PERSON_LABELS = {"person"}
    HIGH_RISK_LABELS = {"backpack", "suitcase", "box", "package", "bag"}
    MEDIUM_RISK_LABELS = {"bicycle", "motorcycle", "car", "truck", "handbag"}

    def __init__(self):
        self._config: dict = {}
        self._engine: Optional[InferenceEngine] = None
        self._model_path: str = ""
        self._object_states: dict[str, dict[int, ObjectTrackState]] = defaultdict(dict)
        self._last_person_tracks: dict[str, dict[int, dict]] = defaultdict(dict)
        self._zones: dict[str, list[ZoneRule]] = defaultdict(list)
        self._confidence_threshold: float = 0.5
        self._min_abandoned_seconds: int = 60
        self._suspicious_seconds: int = 10
        self._pending_seconds: int = 30
        self._movement_threshold: float = 35.0
        self._owner_distance_px: float = 140.0
        self._min_area_ratio: float = 0.001
        self._max_bbox_jitter_ratio: float = 0.35
        self._required_persistence_frames: int = 8
        self._stale_seconds: float = 8.0
        self._removed_seconds: float = 15.0
        self._alert_cooldown_seconds: float = 120.0
        self._object_labels: set[str] = set(self.DEFAULT_OBJECT_LABELS)
        self._person_labels: set[str] = set(self.PERSON_LABELS)
        self._last_event_at: dict[str, dict[tuple[int, str], float]] = defaultdict(dict)
        self._tracker_names: set[str] = set()

    async def on_load(self, config: dict) -> None:
        self._config = config
        self._model_path = config.get("model_path", "/models/abandoned_object_yolo.pt")
        self._confidence_threshold = float(config.get("confidence", 0.5))
        self._min_abandoned_seconds = int(config.get("min_abandoned_seconds", 60))
        self._suspicious_seconds = int(config.get("suspicious_seconds", 10))
        self._pending_seconds = int(config.get("pending_seconds", 30))
        self._movement_threshold = float(config.get("movement_threshold", 35))
        self._owner_distance_px = float(config.get("owner_distance_px", 140))
        self._min_area_ratio = float(config.get("min_area_ratio", 0.001))
        self._max_bbox_jitter_ratio = float(config.get("max_bbox_jitter_ratio", 0.35))
        self._required_persistence_frames = int(config.get("required_persistence_frames", 8))
        self._stale_seconds = float(config.get("stale_seconds", 8))
        self._removed_seconds = float(config.get("removed_seconds", 15))
        self._alert_cooldown_seconds = float(config.get("alert_cooldown_seconds", 120))
        self._object_labels = set(config.get("object_labels", list(self.DEFAULT_OBJECT_LABELS)))
        self._person_labels = set(config.get("person_labels", list(self.PERSON_LABELS)))

        excluded = set(config.get("excluded_labels", []))
        self._object_labels -= excluded
        self._zones = self._normalize_zones(config.get("zones", {}))

        self._engine = InferenceEngine(
            model_path=self._model_path,
            backend=InferenceBackend.TENSORRT if config.get("use_gpu", True) else InferenceBackend.OPENVINO,
        )
        try:
            await self._engine.load()
        except Exception:
            self._engine = InferenceEngine(model_path=self._model_path, backend=InferenceBackend.PYTORCH_CPU)
            try:
                await self._engine.load()
            except Exception as exc:
                log.warning("abandoned_object: inference engine unavailable (%s) - detection disabled", exc)
                self._engine = None

    async def on_event(self, event: dict) -> None:
        return None

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

        image = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return

        detections = await self._engine.predict(image, conf=self._confidence_threshold)
        await self._process_detections(camera_name, detections, timestamp, width, height, image)

    async def _process_detections(
        self,
        camera_name: str,
        raw_detections: list[dict],
        timestamp: float,
        width: int,
        height: int,
        image,
    ) -> None:
        person_detections: list[Detection] = []
        object_detections: list[Detection] = []

        for raw in raw_detections:
            label = raw.get("class_name", "")
            bbox = raw.get("bbox") or {}
            confidence = float(raw.get("confidence", 0))
            if confidence < self._confidence_threshold:
                continue
            if not self._valid_bbox(bbox, width, height):
                continue
            if label in self._person_labels:
                person_detections.append(Detection(bbox=bbox, class_name=label, confidence=confidence))
            elif label in self._object_labels and self._passes_zone_filter(camera_name, bbox, width, height):
                object_detections.append(Detection(bbox=bbox, class_name=label, confidence=confidence))

        person_tracker_name = f"{self.name}:person:{camera_name}"
        object_tracker_name = f"{self.name}:object:{camera_name}"
        self._tracker_names.update({person_tracker_name, object_tracker_name})
        person_tracks = await TrackerManager.get_tracker(person_tracker_name).update(person_detections, timestamp)
        object_tracks = await TrackerManager.get_tracker(object_tracker_name).update(object_detections, timestamp)

        self._last_person_tracks[camera_name] = {
            track.track_id: {"bbox": track.bbox, "center": track.center, "last_seen": timestamp}
            for track in person_tracks
        }
        active_object_ids = set()

        for track in object_tracks:
            active_object_ids.add(track.track_id)
            state = self._upsert_object_state(camera_name, track, timestamp, width, height)
            self._associate_owner(camera_name, state, timestamp)
            await self._advance_state(camera_name, state, timestamp, image)

        await self._handle_missing_objects(camera_name, active_object_ids, timestamp, image)

    def _upsert_object_state(
        self,
        camera_name: str,
        track,
        timestamp: float,
        width: int,
        height: int,
    ) -> ObjectTrackState:
        states = self._object_states[camera_name]
        center = track.center
        zone = self._zone_for_bbox(camera_name, track.bbox, width, height)

        if track.track_id not in states:
            states[track.track_id] = ObjectTrackState(
                track_id=track.track_id,
                class_name=track.class_name,
                confidence=track.confidence,
                first_seen=timestamp,
                last_seen=timestamp,
                bbox=track.bbox,
                positions=[center],
                bbox_history=[track.bbox],
                zone_name=zone.name if zone else None,
                zone_type=zone.zone_type if zone else "default",
            )
            return states[track.track_id]

        state = states[track.track_id]
        state.class_name = track.class_name
        state.confidence = track.confidence
        state.last_seen = timestamp
        state.bbox = track.bbox
        state.zone_name = zone.name if zone else state.zone_name
        state.zone_type = zone.zone_type if zone else state.zone_type
        state.positions.append(center)
        state.bbox_history.append(track.bbox)
        if len(state.positions) > 45:
            state.positions.pop(0)
        if len(state.bbox_history) > 45:
            state.bbox_history.pop(0)
        return state

    async def _advance_state(self, camera_name: str, state: ObjectTrackState, timestamp: float, image) -> None:
        is_static = self._is_stationary(state) and self._bbox_is_stable(state)
        persisted = len(state.positions) >= self._required_persistence_frames
        owner_near = self._owner_is_near(camera_name, state)

        if not persisted:
            await self._emit_once(camera_name, state, "object_appeared", "low", timestamp, image)
            return

        if not is_static:
            state.state = ObjectState.MOVING
            state.static_since = None
            state.unattended_since = None
            return

        if state.static_since is None:
            state.static_since = timestamp
        if owner_near:
            state.unattended_since = None
            if state.state in {ObjectState.ABANDONED_PENDING, ObjectState.ABANDONED_CONFIRMED}:
                await self._emit_once(camera_name, state, "owner_returned", "low", timestamp, image)
            state.state = ObjectState.STATIC_CANDIDATE
            return

        if state.unattended_since is None:
            state.unattended_since = timestamp

        unattended_seconds = timestamp - state.unattended_since
        thresholds = self._thresholds_for_state(camera_name, state)

        if unattended_seconds >= thresholds["abandoned"]:
            state.state = ObjectState.ABANDONED_CONFIRMED
            await self._emit_once(
                camera_name,
                state,
                "abandoned_object",
                self._severity_for_state(state, unattended_seconds),
                timestamp,
                image,
            )
        elif unattended_seconds >= thresholds["pending"]:
            state.state = ObjectState.ABANDONED_PENDING
            await self._emit_once(camera_name, state, "abandoned_pending", "medium", timestamp, image)
        elif unattended_seconds >= thresholds["suspicious"]:
            state.state = ObjectState.STATIC_CANDIDATE
            await self._emit_once(camera_name, state, "suspicious_static_object", "low", timestamp, image)

    async def _handle_missing_objects(
        self,
        camera_name: str,
        active_object_ids: set[int],
        timestamp: float,
        image,
    ) -> None:
        states = self._object_states.get(camera_name, {})
        for track_id, state in list(states.items()):
            if track_id in active_object_ids:
                continue
            missing_seconds = timestamp - state.last_seen
            if state.state == ObjectState.ABANDONED_CONFIRMED and missing_seconds >= self._removed_seconds:
                state.state = ObjectState.REMOVED
                await self._emit_once(camera_name, state, "removed_object", "medium", timestamp, image)
            if missing_seconds >= self._stale_seconds:
                state.state = ObjectState.CLEARED
                await self._emit_once(camera_name, state, "object_cleared", "low", timestamp, image)
                states.pop(track_id, None)
                self._last_event_at[camera_name] = {
                    key: value
                    for key, value in self._last_event_at.get(camera_name, {}).items()
                    if key[0] != track_id
                }

    def _associate_owner(self, camera_name: str, state: ObjectTrackState, timestamp: float) -> None:
        best_id: Optional[int] = None
        best_dist = float("inf")
        for person_id, info in self._last_person_tracks.get(camera_name, {}).items():
            dist = self._distance(self._bbox_center(state.bbox), info["center"])
            if dist < best_dist and dist <= self._owner_distance_px:
                best_id = person_id
                best_dist = dist
        if best_id is not None:
            state.owner_track_id = best_id
            state.owner_last_seen = timestamp

    def _owner_is_near(self, camera_name: str, state: ObjectTrackState) -> bool:
        if state.owner_track_id is None:
            return False
        person = self._last_person_tracks.get(camera_name, {}).get(state.owner_track_id)
        if not person:
            return False
        return self._distance(self._bbox_center(state.bbox), person["center"]) <= self._owner_distance_px

    def _is_stationary(self, state: ObjectTrackState) -> bool:
        if len(state.positions) < self._required_persistence_frames:
            return False
        recent = state.positions[-self._required_persistence_frames :]
        xs = [p[0] for p in recent]
        ys = [p[1] for p in recent]
        return (max(xs) - min(xs)) <= self._movement_threshold and (max(ys) - min(ys)) <= self._movement_threshold

    def _bbox_is_stable(self, state: ObjectTrackState) -> bool:
        if len(state.bbox_history) < self._required_persistence_frames:
            return False
        areas = [max(1, self._bbox_area(b)) for b in state.bbox_history[-self._required_persistence_frames :]]
        avg_area = sum(areas) / len(areas)
        return (max(areas) - min(areas)) / avg_area <= self._max_bbox_jitter_ratio

    def _valid_bbox(self, bbox: dict, width: int, height: int) -> bool:
        area = self._bbox_area(bbox)
        frame_area = max(1, width * height)
        return area > 0 and (area / frame_area) >= self._min_area_ratio

    def _passes_zone_filter(self, camera_name: str, bbox: dict, width: int, height: int) -> bool:
        zones = self._zones.get(camera_name, [])
        if not zones:
            return True
        zone = self._zone_for_bbox(camera_name, bbox, width, height)
        return zone is None or zone.zone_type != "ignore"

    def _zone_for_bbox(self, camera_name: str, bbox: dict, width: int, height: int) -> Optional[ZoneRule]:
        cx, cy = self._bbox_center(bbox)
        point_norm = (cx / max(1, width), cy / max(1, height))
        point_abs = (cx, cy)
        for zone in self._zones.get(camera_name, []):
            polygon_uses_pixels = any(x > 1 or y > 1 for x, y in zone.polygon)
            point = point_abs if polygon_uses_pixels else point_norm
            if self._point_in_polygon(point, zone.polygon):
                return zone
        return None

    def _thresholds_for_state(self, camera_name: str, state: ObjectTrackState) -> dict[str, int]:
        for zone in self._zones.get(camera_name, []):
            if zone.name == state.zone_name:
                return {
                    "suspicious": zone.suspicious_seconds,
                    "pending": zone.pending_seconds,
                    "abandoned": zone.min_abandoned_seconds,
                }
        return {
            "suspicious": self._suspicious_seconds,
            "pending": self._pending_seconds,
            "abandoned": self._min_abandoned_seconds,
        }

    def _severity_for_state(self, state: ObjectTrackState, unattended_seconds: float) -> str:
        score = 1
        if state.class_name in self.HIGH_RISK_LABELS:
            score += 2
        elif state.class_name in self.MEDIUM_RISK_LABELS:
            score += 1
        if state.zone_type in {"high_risk", "sensitive"}:
            score += 2
        elif state.zone_type == "staff_only":
            score += 1
        if unattended_seconds >= self._min_abandoned_seconds * 2:
            score += 1
        if score >= 5:
            return "critical"
        if score >= 4:
            return "high"
        if score >= 2:
            return "medium"
        return "low"

    async def _emit_once(
        self,
        camera_name: str,
        state: ObjectTrackState,
        event_type: str,
        severity: str,
        timestamp: float,
        image,
    ) -> None:
        key = (state.track_id, event_type)
        last_at = self._last_event_at[camera_name].get(key)
        if event_type in state.emitted_events and last_at is not None:
            return
        if last_at is not None and timestamp - last_at < self._alert_cooldown_seconds:
            return

        state.emitted_events.add(event_type)
        self._last_event_at[camera_name][key] = timestamp
        snapshot = None
        if image is not None:
            from app.plugins.shared.annotation import annotate_frame, encode_jpeg
            color = {
                "ABANDONED_CONFIRMED": (0, 0, 220),
                "ABANDONED_PENDING": (0, 120, 255),
                "REMOVED": (180, 0, 220),
            }.get(state.state.value, (0, 200, 200))
            annotated = annotate_frame(image, [state.bbox], color=color, label=state.class_name)
            snapshot = encode_jpeg(annotated, quality=75)

        await self.emit_alert(
            camera_id=camera_name,
            alert_type=event_type,
            severity=severity,
            data=self._event_payload(camera_name, state, event_type, timestamp, severity),
            snapshot_bytes=snapshot,
        )

    def _event_payload(
        self,
        camera_name: str,
        state: ObjectTrackState,
        event_type: str,
        timestamp: float,
        severity: str,
    ) -> dict:
        unattended = int(timestamp - state.unattended_since) if state.unattended_since else 0
        thresholds = self._thresholds_for_state(camera_name, state)
        countdown = max(0, thresholds["abandoned"] - unattended)
        return {
            "event": event_type,
            "camera_name": camera_name,
            "track_id": state.track_id,
            "object_type": state.class_name,
            "confidence": round(state.confidence, 3),
            "severity": severity,
            "state": state.state.value,
            "zone": state.zone_name or "default",
            "zone_type": state.zone_type,
            "duration_seconds": int(timestamp - state.first_seen),
            "unattended_seconds": unattended,
            "countdown_seconds": countdown,
            "owner_track_id": state.owner_track_id,
            "owner_last_seen": state.owner_last_seen,
            "bbox": state.bbox,
            "position": tuple(round(v, 1) for v in self._bbox_center(state.bbox)),
            "overlay": {
                "object_bbox": state.bbox,
                "owner_track_id": state.owner_track_id,
                "state_color": self._state_color(state.state),
                "show_countdown": countdown > 0,
            },
        }

    def _normalize_zones(self, zones_config: dict) -> dict[str, list[ZoneRule]]:
        zones: dict[str, list[ZoneRule]] = defaultdict(list)
        for camera_name, items in (zones_config or {}).items():
            for item in items or []:
                polygon = item.get("polygon") or []
                if len(polygon) < 3:
                    continue
                zone_type = str(item.get("type", item.get("zone_type", "sensitive"))).lower()
                zones[camera_name].append(
                    ZoneRule(
                        name=item.get("name", zone_type),
                        zone_type=zone_type,
                        polygon=[(float(p[0]), float(p[1])) for p in polygon],
                        min_abandoned_seconds=int(item.get("min_abandoned_seconds", self._min_abandoned_seconds)),
                        suspicious_seconds=int(item.get("suspicious_seconds", self._suspicious_seconds)),
                        pending_seconds=int(item.get("pending_seconds", self._pending_seconds)),
                        severity_boost=int(item.get("severity_boost", 0)),
                    )
                )
        return zones

    @staticmethod
    def _bbox_center(bbox: dict) -> tuple[float, float]:
        return ((bbox.get("x1", 0) + bbox.get("x2", 0)) / 2, (bbox.get("y1", 0) + bbox.get("y2", 0)) / 2)

    @staticmethod
    def _bbox_area(bbox: dict) -> float:
        return max(0, bbox.get("x2", 0) - bbox.get("x1", 0)) * max(0, bbox.get("y2", 0) - bbox.get("y1", 0))

    @staticmethod
    def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5

    @staticmethod
    def _point_in_polygon(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
        x, y = point
        inside = False
        j = len(polygon) - 1
        for i, (xi, yi) in enumerate(polygon):
            xj, yj = polygon[j]
            intersects = ((yi > y) != (yj > y)) and (
                x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi
            )
            if intersects:
                inside = not inside
            j = i
        return inside

    @staticmethod
    def _state_color(state: ObjectState) -> str:
        return {
            ObjectState.NEW: "blue",
            ObjectState.MOVING: "blue",
            ObjectState.STATIC_CANDIDATE: "yellow",
            ObjectState.ABANDONED_PENDING: "orange",
            ObjectState.ABANDONED_CONFIRMED: "red",
            ObjectState.REMOVED: "purple",
            ObjectState.CLEARED: "green",
        }.get(state, "blue")

    async def on_unload(self) -> None:
        if self._engine:
            await self._engine.unload()
        self._object_states.clear()
        self._last_person_tracks.clear()
        self._zones.clear()
        self._last_event_at.clear()
        for tracker_name in self._tracker_names:
            TrackerManager.reset_tracker(tracker_name)
        self._tracker_names.clear()

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "model_path": {
                    "type": "string",
                    "default": "/models/abandoned_object_yolo.pt",
                    "description": "Ruta al modelo YOLO/RT-DETR para objetos abandonados",
                },
                "confidence": {"type": "number", "default": 0.5, "minimum": 0, "maximum": 1},
                "use_gpu": {"type": "boolean", "default": True},
                "min_abandoned_seconds": {
                    "type": "integer",
                    "default": 60,
                    "description": "Tiempo sin dueño para confirmar abandono",
                },
                "suspicious_seconds": {"type": "integer", "default": 10},
                "pending_seconds": {"type": "integer", "default": 30},
                "movement_threshold": {
                    "type": "integer",
                    "default": 35,
                    "description": "Movimiento máximo del centro para considerar objeto inmóvil",
                },
                "owner_distance_px": {"type": "integer", "default": 140},
                "min_area_ratio": {"type": "number", "default": 0.001, "minimum": 0, "maximum": 1},
                "max_bbox_jitter_ratio": {"type": "number", "default": 0.35, "minimum": 0, "maximum": 2},
                "required_persistence_frames": {"type": "integer", "default": 8, "minimum": 1},
                "removed_seconds": {"type": "integer", "default": 15},
                "stale_seconds": {"type": "integer", "default": 8},
                "object_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": sorted(self.DEFAULT_OBJECT_LABELS),
                },
                "person_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": sorted(self.PERSON_LABELS),
                },
                "excluded_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": [],
                    "description": "Clases a excluir del análisis de objetos",
                },
                "enabled_cameras": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Cámaras a monitorear (vacío = todas)",
                },
                "zones": {
                    "type": "object",
                    "description": "Zonas por cámara: ignore, sensitive, transit, high_risk, staff_only",
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
            states = [state for camera in plugin_self._object_states.values() for state in camera.values()]
            return {
                "engine_loaded": plugin_self._engine is not None,
                "tracked_objects": len(states),
                "confirmed_abandoned": sum(1 for state in states if state.state == ObjectState.ABANDONED_CONFIRMED),
                "pending": sum(1 for state in states if state.state == ObjectState.ABANDONED_PENDING),
                "zones": sum(len(items) for items in plugin_self._zones.values()),
            }

        @router.get("/objects")
        async def list_objects(camera_name: Optional[str] = None, _=Depends(get_current_user)):
            cameras = [camera_name] if camera_name else list(plugin_self._object_states.keys())
            return {
                "objects": [
                    plugin_self._event_payload(camera, state, "object_state", state.last_seen, "low")
                    for camera in cameras
                    for state in plugin_self._object_states.get(camera, {}).values()
                ]
            }

        @router.delete("/objects/{object_id}")
        async def clear_object(
            object_id: int,
            camera_name: str,
            _=Depends(get_current_user),
        ):
            plugin_self._object_states.get(camera_name, {}).pop(object_id, None)
            plugin_self._last_event_at[camera_name] = {
                key: value
                for key, value in plugin_self._last_event_at.get(camera_name, {}).items()
                if key[0] != object_id
            }
            TrackerManager.reset_tracker(f"{plugin_self.name}:object:{camera_name}")
            return {"ok": True}

        return router
