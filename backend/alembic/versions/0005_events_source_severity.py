"""Add source and severity to events table

Revision ID: 0005_events_source_severity
Revises: 0004_mqtt_credentials
Create Date: 2026-04-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_events_source_severity"
down_revision: Union[str, None] = "0004_mqtt_credentials"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS source TEXT")
    op.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS severity TEXT")


def downgrade() -> None:
    op.drop_column("events", "severity")
    op.drop_column("events", "source")