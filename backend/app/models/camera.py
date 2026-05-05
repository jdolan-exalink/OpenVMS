import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Camera(Base):
    __tablename__ = "cameras"
    __table_args__ = (
        sa.UniqueConstraint("server_id", "frigate_name", name="uq_camera_server_frigate_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("frigate_servers.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(sa.String, nullable=False)
    display_name: Mapped[str] = mapped_column(sa.String, nullable=False)
    frigate_name: Mapped[str] = mapped_column(sa.String, nullable=False)
    ome_stream_main: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    ome_stream_sub: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    llhls_main: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    llhls_sub: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    rtsp_main: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    rtsp_sub: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    has_audio: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    has_ptz: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    position_x: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    position_y: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    floor_level: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(sa.String), nullable=False, default=list)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )

    server: Mapped["FrigateServer"] = relationship("FrigateServer", back_populates="cameras")  # type: ignore[name-defined]
    permissions: Mapped[list["CameraPermission"]] = relationship("CameraPermission", back_populates="camera")  # type: ignore[name-defined]
