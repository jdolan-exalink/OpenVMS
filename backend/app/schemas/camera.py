from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── Frigate Server schemas ────────────────────────────────────────────────────


class FrigateServerCreate(BaseModel):
    name: str = Field(..., pattern=r"^[a-z0-9_-]+$", description="Unique internal identifier")
    display_name: str
    url: str = Field(..., description="http://frigate-host:5000 or http://frigate-host:8971")
    rtsp_base: str = Field(..., description="rtsp://frigate-host:8554")
    mqtt_host: str | None = None
    mqtt_port: int = 1883
    mqtt_username: str | None = Field(None, description="MQTT broker username (optional)")
    mqtt_password: str | None = Field(None, description="MQTT broker password (optional)")
    api_key: str | None = Field(
        None,
        description="'username:password' for port 8971 auth. Leave empty for port 5000 (no auth).",
    )
    recordings_path: str | None = Field(None, description="Host path where Frigate recordings live")
    config_path: str | None = Field(None, description="Host path where Frigate config lives")
    enabled: bool = True


class FrigateServerUpdate(BaseModel):
    display_name: str | None = None
    url: str | None = None
    rtsp_base: str | None = None
    mqtt_host: str | None = None
    mqtt_port: int | None = None
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    api_key: str | None = None
    recordings_path: str | None = None
    config_path: str | None = None
    enabled: bool | None = None


class FrigateServerResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    display_name: str
    url: str
    rtsp_base: str
    mqtt_host: str | None
    mqtt_port: int
    mqtt_username: str | None
    recordings_path: str | None = None
    config_path: str | None = None
    enabled: bool
    last_seen: datetime | None
    created_at: datetime


class ServerStatusResponse(BaseModel):
    online: bool
    version: str | None = None
    latency_ms: int | None = None
    cameras: list[str] = []
    error: str | None = None


class SyncSummary(BaseModel):
    added: int
    updated: int
    unchanged: int


# ── Camera schemas ────────────────────────────────────────────────────────────


class CameraCreate(BaseModel):
    server_id: uuid.UUID
    name: str
    display_name: str
    frigate_name: str
    has_audio: bool = False
    has_ptz: bool = False
    position_x: float | None = None
    position_y: float | None = None
    floor_level: int = 0
    tags: list[str] = []


class CameraUpdate(BaseModel):
    display_name: str | None = None
    enabled: bool | None = None
    has_audio: bool | None = None
    has_ptz: bool | None = None
    position_x: float | None = None
    position_y: float | None = None
    floor_level: int | None = None
    tags: list[str] | None = None


class CameraResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    server_id: uuid.UUID
    name: str
    display_name: str
    frigate_name: str
    ome_stream_main: str | None
    ome_stream_sub: str | None
    llhls_main: str | None
    llhls_sub: str | None
    rtsp_main: str | None
    rtsp_sub: str | None
    has_audio: bool
    has_ptz: bool
    position_x: float | None
    position_y: float | None
    floor_level: int
    enabled: bool
    tags: list[str]
    created_at: datetime


class CameraStreamResponse(BaseModel):
    webrtc: str | None
    llhls: str | None


class CameraListResponse(BaseModel):
    items: list[CameraResponse]
    total: int
    page: int
    page_size: int
