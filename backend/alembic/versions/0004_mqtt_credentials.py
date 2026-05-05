"""Add mqtt_username and mqtt_password to frigate_servers

Revision ID: 0004_mqtt_credentials
Revises: 0003_lpr_tables
Create Date: 2026-04-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_mqtt_credentials"
down_revision: Union[str, None] = "0003_lpr_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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