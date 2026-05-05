"""FrigateConfigHistory — audit trail of every config change applied to Frigate."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FrigateConfigHistory(Base):
    __tablename__ = "frigate_config_history"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("frigate_servers.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    change_type: Mapped[str] = mapped_column(sa.String, nullable=False)
    camera_name: Mapped[str | None] = mapped_column(sa.String, nullable=True)
    config_diff: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    full_config_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    applied_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )
    success: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    error_message: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
