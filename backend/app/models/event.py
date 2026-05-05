import uuid
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    frigate_event_id: Mapped[str | None] = mapped_column(sa.String, nullable=True, unique=True)
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("frigate_servers.id"), nullable=True
    )
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("cameras.id"), nullable=True
    )
    label: Mapped[str] = mapped_column(sa.String, nullable=False)
    sub_label: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    event_type: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    source: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    severity: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    start_time: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    score: Mapped[Decimal | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    zones: Mapped[list[str]] = mapped_column(ARRAY(sa.String), nullable=False, default=list)
    has_clip: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    has_snapshot: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    snapshot_path: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    clip_path: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    plate_number: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    plate_score: Mapped[Decimal | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    is_protected: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
