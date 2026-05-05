import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FrigateServer(Base):
    __tablename__ = "frigate_servers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(sa.String, nullable=False)
    url: Mapped[str] = mapped_column(sa.Text, nullable=False)
    rtsp_base: Mapped[str] = mapped_column(sa.Text, nullable=False)
    mqtt_host: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    mqtt_port: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=1883)
    mqtt_username: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    mqtt_password: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    api_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    last_seen: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )

    cameras: Mapped[list["Camera"]] = relationship("Camera", back_populates="server", lazy="select")  # type: ignore[name-defined]

    @property
    def recordings_path(self) -> str | None:
        return self.extra_metadata.get("recordings_path")

    @property
    def config_path(self) -> str | None:
        return self.extra_metadata.get("config_path")
