import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PeopleCountingHourly(Base):
    __tablename__ = "people_counting_hourly"
    __table_args__ = (
        sa.UniqueConstraint(
            "camera_name",
            "hour_start",
            "zone_name",
            "line_name",
            "label",
            name="uq_people_counting_hourly_bucket",
        ),
        sa.Index("idx_people_counting_hourly_camera_hour", "camera_name", "hour_start"),
        sa.Index("idx_people_counting_hourly_hour", "hour_start"),
    )

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    camera_name: Mapped[str] = mapped_column(sa.String, nullable=False)
    hour_start: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    zone_name: Mapped[str] = mapped_column(sa.String, nullable=False, default="default")
    line_name: Mapped[str] = mapped_column(sa.String, nullable=False, default="unknown")
    label: Mapped[str] = mapped_column(sa.String, nullable=False)
    enter_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    exit_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")
    )
