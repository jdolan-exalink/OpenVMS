"""Add hourly people counting history

Revision ID: 0006_people_counting_hourly
Revises: 0005_events_source_severity
Create Date: 2026-04-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_people_counting_hourly"
down_revision: Union[str, None] = "0005_events_source_severity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "people_counting_hourly",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "camera_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cameras.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("camera_name", sa.String, nullable=False),
        sa.Column("hour_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("zone_name", sa.String, nullable=False, server_default="default"),
        sa.Column("line_name", sa.String, nullable=False, server_default="unknown"),
        sa.Column("label", sa.String, nullable=False),
        sa.Column("enter_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("exit_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint(
            "camera_name",
            "hour_start",
            "zone_name",
            "line_name",
            "label",
            name="uq_people_counting_hourly_bucket",
        ),
    )
    op.create_index(
        "idx_people_counting_hourly_camera_hour",
        "people_counting_hourly",
        ["camera_name", "hour_start"],
    )
    op.create_index("idx_people_counting_hourly_hour", "people_counting_hourly", ["hour_start"])


def downgrade() -> None:
    op.drop_index("idx_people_counting_hourly_hour", table_name="people_counting_hourly")
    op.drop_index("idx_people_counting_hourly_camera_hour", table_name="people_counting_hourly")
    op.drop_table("people_counting_hourly")