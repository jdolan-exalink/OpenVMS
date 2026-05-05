"""Add is_protected to events

Revision ID: 0007_events_protected
Revises: 0006_people_counting_hourly
Create Date: 2026-04-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_events_protected"
down_revision: Union[str, None] = "0006_people_counting_hourly"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("is_protected", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("events", "is_protected")