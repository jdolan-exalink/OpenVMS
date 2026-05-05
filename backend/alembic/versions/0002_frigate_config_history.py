"""Add frigate_config_history table

Revision ID: 0002_frigate_config_history
Revises: 0001_initial_schema
Create Date: 2026-04-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_frigate_config_history"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "frigate_config_history",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "server_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("frigate_servers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("change_type", sa.String, nullable=False),
        sa.Column("camera_name", sa.String, nullable=True),
        sa.Column("config_diff", postgresql.JSONB, nullable=True),
        sa.Column("full_config_snapshot", postgresql.JSONB, nullable=True),
        sa.Column(
            "applied_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("success", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("error_message", sa.Text, nullable=True),
    )
    op.execute(
        "CREATE INDEX idx_config_history_server_time "
        "ON frigate_config_history (server_id, applied_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_config_history_server_time")
    op.drop_table("frigate_config_history")