"""Add mqtt_username and mqtt_password to frigate_servers

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "frigate_servers",
        sa.Column("mqtt_username", sa.Text, nullable=True),
    )
    op.add_column(
        "frigate_servers",
        sa.Column("mqtt_password", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("frigate_servers", "mqtt_password")
    op.drop_column("frigate_servers", "mqtt_username")
