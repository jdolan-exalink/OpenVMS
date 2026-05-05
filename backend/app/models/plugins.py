from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LprEvent(Base):
    __tablename__ = "lpr_events"
    __table_args__ = (
        sa.Index("idx_lpr_events_plate", "plate_number"),
        sa.Index("idx_lpr_events_camera", "camera_id", "detected_at"),
    )

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[int | None] = mapped_column(
        sa.BigInteger, sa.ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )
    camera_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    server_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    plate_number: Mapped[str] = mapped_column(sa.String, nullable=False)
    plate_score: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    is_blacklisted: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    detected_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )


class LprBlacklist(Base):
    __tablename__ = "lpr_blacklist"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    plate_number: Mapped[str] = mapped_column(sa.String, nullable=False, unique=True)
    reason: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    added_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    added_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )


class FaceEmbedding(Base):
    __tablename__ = "face_embeddings"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True, autoincrement=True)
    person_name: Mapped[str] = mapped_column(sa.String, nullable=False)
    person_id: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    embedding: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True)
    image_bytes: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True)
    camera_id: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )
    metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class SemanticEvent(Base):
    __tablename__ = "semantic_events"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    event_time: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    image_embedding: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True)
    text_embedding: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True)
    thumbnail_bytes: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True)
    metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )
