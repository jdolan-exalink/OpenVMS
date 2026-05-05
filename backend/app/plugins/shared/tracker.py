from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Track:
    track_id: int
    class_name: str
    confidence: float
    bbox: dict
    age: int = 0
    history: list[dict] = field(default_factory=list)

    @property
    def center(self) -> tuple[float, float]:
        x1 = self.bbox.get("x1", 0)
        y1 = self.bbox.get("y1", 0)
        x2 = self.bbox.get("x2", 0)
        y2 = self.bbox.get("y2", 0)
        return ((x1 + x2) / 2, (y1 + y2) / 2)


@dataclass
class Detection:
    bbox: dict
    class_name: str
    confidence: float


class ByteTrackWrapper:
    def __init__(self, camera_name: str):
        self.camera_name = camera_name
        self._tracks: dict[int, Track] = {}
        self._track_ages: dict[int, int] = {}
        self._track_histories: dict[int, list[dict]] = {}

    async def update(
        self,
        detections: list[Detection],
        frame_timestamp: float,
    ) -> list[Track]:
        tracked = []
        for det in detections:
            track_id = self._match_detection_to_track(det)
            if track_id is None:
                track_id = len(self._tracks) + 1

            if track_id not in self._tracks:
                self._tracks[track_id] = Track(
                    track_id=track_id,
                    class_name=det.class_name,
                    confidence=det.confidence,
                    bbox=det.bbox,
                    age=0,
                    history=[],
                )
                self._track_histories[track_id] = []
            else:
                self._tracks[track_id].bbox = det.bbox
                self._tracks[track_id].confidence = det.confidence

            age = self._track_ages.get(track_id, 0) + 1
            self._track_ages[track_id] = age
            self._tracks[track_id].age = age

            history = self._track_histories.setdefault(track_id, [])
            history.append({"bbox": det.bbox, "ts": frame_timestamp})
            if len(history) > 30:
                history.pop(0)
            self._tracks[track_id].history = history

            tracked.append(self._tracks[track_id])

        active_ids = set(t.track_id for t in tracked)
        for tid in list(self._tracks.keys()):
            if tid not in active_ids:
                del self._tracks[tid]
                self._track_ages.pop(tid, None)
                self._track_histories.pop(tid, None)

        return tracked

    def _match_detection_to_track(self, detection: Detection) -> Optional[int]:
        if not self._tracks:
            return None

        det_cx = (detection.bbox.get("x1", 0) + detection.bbox.get("x2", 0)) / 2
        det_cy = (detection.bbox.get("y1", 0) + detection.bbox.get("y2", 0)) / 2

        best_tid: Optional[int] = None
        best_dist = float("inf")
        iou_threshold = 0.3

        for tid, track in self._tracks.items():
            if track.class_name != detection.class_name:
                continue

            cx, cy = track.center
            dist = ((det_cx - cx) ** 2 + (det_cy - cy) ** 2) ** 0.5

            if dist < best_dist:
                best_dist = dist
                best_tid = tid

        if best_dist < 100:
            return best_tid
        return None

    def get_track(self, track_id: int) -> Optional[Track]:
        return self._tracks.get(track_id)

    def get_active_tracks(self) -> list[Track]:
        return list(self._tracks.values())


class TrackerManager:
    _trackers: dict[str, ByteTrackWrapper] = {}

    @classmethod
    def get_tracker(cls, camera_name: str) -> ByteTrackWrapper:
        if camera_name not in cls._trackers:
            cls._trackers[camera_name] = ByteTrackWrapper(camera_name)
        return cls._trackers[camera_name]

    @classmethod
    def reset_tracker(cls, camera_name: str) -> None:
        cls._trackers.pop(camera_name, None)

    @classmethod
    def reset_all(cls) -> None:
        cls._trackers.clear()