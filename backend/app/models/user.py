import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(sa.String, nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(sa.String, nullable=True, unique=True)
    password_hash: Mapped[str] = mapped_column(sa.Text, nullable=False)
    full_name: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    role: Mapped[str] = mapped_column(sa.String, nullable=False, default="viewer")
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    last_login: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )

    permissions: Mapped[list["CameraPermission"]] = relationship("CameraPermission", back_populates="user")


class CameraPermission(Base):
    __tablename__ = "camera_permissions"
    __table_args__ = (sa.PrimaryKeyConstraint("user_id", "camera_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    camera_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False
    )
    can_view: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    can_playback: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    can_export: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    can_ptz: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)

    user: Mapped["User"] = relationship("User", back_populates="permissions")
    camera: Mapped["Camera"] = relationship("Camera", back_populates="permissions")  # type: ignore[name-defined]
