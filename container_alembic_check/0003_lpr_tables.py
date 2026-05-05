"""Add LPR plugin tables

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lpr_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "event_id",
            sa.BigInteger,
            sa.ForeignKey("events.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "camera_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cameras.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "server_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("frigate_servers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("plate_number", sa.String, nullable=False),
        sa.Column("plate_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("is_blacklisted", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.execute("CREATE INDEX idx_lpr_events_plate ON lpr_events (plate_number)")
    op.execute("CREATE INDEX idx_lpr_events_camera ON lpr_events (camera_id, detected_at DESC)")

    op.create_table(
        "lpr_blacklist",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("plate_number", sa.String, nullable=False, unique=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column(
            "added_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_lpr_events_camera")
    op.execute("DROP INDEX IF EXISTS idx_lpr_events_plate")
    op.drop_table("lpr_blacklist")
    op.drop_table("lpr_events")
