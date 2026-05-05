from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Generic, TypeVar

from pydantic import BaseModel, Field, computed_field

T = TypeVar("T")


class EventResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    frigate_event_id: str | None
    server_id: uuid.UUID | None
    camera_id: uuid.UUID | None
    label: str
    sub_label: str | None
    event_type: str | None
    source: str | None = None
    severity: str | None = None
    start_time: datetime
    end_time: datetime | None
    score: Decimal | None
    zones: list[str]
    has_clip: bool
    has_snapshot: bool
    snapshot_path: str | None
    clip_path: str | None
    plate_number: str | None
    plate_score: Decimal | None
    extra_metadata: dict = Field(default_factory=dict)
    is_protected: bool = False

    @computed_field
    @property
    def snapshot_url(self) -> str | None:
        if self.has_snapshot and self.id:
            return f"/api/v1/events/{self.id}/snapshot"
        return None


class EventFilters(BaseModel):
    camera_id: uuid.UUID | None = None
    server_id: uuid.UUID | None = None
    label: str | None = None
    plate: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    zone: str | None = None
    score_min: float | None = None
    has_clip: bool | None = None
    cursor: str | None = None
    limit: int = Field(default=50, ge=1, le=1000)
    source: str | None = None
    severity: str | None = None
    is_protected: bool | None = None


class CursorPage(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None


def encode_cursor(start_time: datetime, event_id: int) -> str:
    payload = {"st": start_time.isoformat(), "id": event_id}
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    return datetime.fromisoformat(payload["st"]), payload["id"]
