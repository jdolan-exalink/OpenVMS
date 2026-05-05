"""Pydantic schemas for Frigate 0.17+ camera configuration."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FFmpegInputConfig(BaseModel):
    path: str
    roles: list[Literal["detect", "record", "audio"]]


class FFmpegCameraConfig(BaseModel):
    inputs: list[FFmpegInputConfig]
    output_args: dict | None = None
    retry_interval: float | None = None


class DetectConfig(BaseModel):
    enabled: bool = True
    width: int = 1280
    height: int = 720
    fps: int = 5
    min_initialized: int | None = None
    max_disappeared: int | None = None


class RecordConfig(BaseModel):
    enabled: bool = False
    retain: dict | None = Field(
        default={"days": 7, "mode": "motion"},
        description="days: retention days, mode: all|motion|active_objects",
    )
    events: dict | None = Field(
        default={"retain": {"default": 10, "mode": "active_objects"}},
        description="Event recording retention",
    )
    export: dict | None = None


class SnapshotsConfig(BaseModel):
    enabled: bool = True
    timestamp: bool = False
    bounding_box: bool = True
    crop: bool = False
    height: int | None = None
    retain: dict | None = Field(
        default={"default": 10},
        description="Snapshot retention days",
    )


class ZoneCoordinate(BaseModel):
    coordinates: str
    objects: list[str] | None = None
    inertia: int | None = None
    loitering_time: int | None = None
    filters: dict | None = None


class ObjectFilterConfig(BaseModel):
    min_score: float | None = None
    threshold: float | None = None
    min_area: int | None = None
    max_area: int | None = None
    min_ratio: float | None = None
    max_ratio: float | None = None


class ObjectsConfig(BaseModel):
    track: list[str] = ["person", "car"]
    filters: dict[str, ObjectFilterConfig] | None = None


class MotionConfig(BaseModel):
    enabled: bool | None = None
    threshold: int | None = None
    improve_contrast: bool | None = None
    contour_area: int | None = None
    frame_alpha: float | None = None
    frame_height: int | None = None
    mask: str | list[str] | None = None


class LiveConfig(BaseModel):
    stream_name: str | None = None
    height: int | None = None
    quality: int | None = None


class PTZConfig(BaseModel):
    enabled: bool = False
    autotracking: dict | None = None


class AudioConfig(BaseModel):
    enabled: bool = False
    listen: list[str] | None = None
    filters: dict | None = None


class CameraConfig(BaseModel):
    """Full camera config for Frigate 0.17+."""

    ffmpeg: FFmpegCameraConfig
    detect: DetectConfig = DetectConfig()
    record: RecordConfig = RecordConfig()
    snapshots: SnapshotsConfig = SnapshotsConfig()
    zones: dict[str, ZoneCoordinate] | None = None
    objects: ObjectsConfig | None = None
    motion: MotionConfig | None = None
    live: LiveConfig | None = None
    ptz: PTZConfig | None = None
    audio: AudioConfig | None = None
    best_image_timeout: int | None = None
    onvif: dict | None = None
    ui: dict | None = None
    enabled: bool = True


class AddCameraRequest(BaseModel):
    """Wizard request to add a camera to Frigate and the VMS."""

    camera_name: str = Field(
        ...,
        pattern=r"^[a-z0-9_-]+$",
        description="Camera key in Frigate config (lowercase, digits, hyphens, underscores)",
    )
    display_name: str
    server_id: str
    rtsp_main: str = Field(..., description="RTSP URL for main stream")
    rtsp_sub: str | None = Field(None, description="RTSP URL for sub-stream (used for detect)")
    detect_width: int = 1280
    detect_height: int = 720
    detect_fps: int = 5
    detect_enabled: bool = True
    record_enabled: bool = True
    record_retain_days: int = 7
    record_mode: Literal["all", "motion", "active_objects"] = "motion"
    snapshots_enabled: bool = True
    snapshots_retain_days: int = 10
    track_objects: list[str] = ["person", "car", "truck"]
    has_audio: bool = False
    has_ptz: bool = False
    zones: dict | None = None
    tags: list[str] = []
    auto_save: bool = True


class UpdateCameraConfigRequest(BaseModel):
    """Partial camera config update."""

    detect: DetectConfig | None = None
    record: RecordConfig | None = None
    snapshots: SnapshotsConfig | None = None
    zones: dict[str, ZoneCoordinate] | None = None
    objects: ObjectsConfig | None = None
    motion: MotionConfig | None = None
    audio: AudioConfig | None = None
    auto_save: bool = True


class Go2rtcStreamCreate(BaseModel):
    name: str
    url: str | list[str]


class GlobalConfigUpdate(BaseModel):
    section: Literal["mqtt", "ffmpeg", "detect", "record", "snapshots", "birdseye", "live", "ui", "logger"]
    config: dict
    auto_save: bool = True


class ConfigHistoryResponse(BaseModel):
    id: int
    server_id: str
    user_id: str | None
    change_type: str
    camera_name: str | None
    config_diff: dict | None
    applied_at: str
    success: bool
    error_message: str | None
