"""Enable pgvector extension for semantic search

Revision ID: 0008_pgvector_extension
Revises: 0007_events_protected
Create Date: 2026-05-04

Requires the pgvector/pgvector:pg16 image (or pgvector installed on the DB host).
On fresh installs, docker/postgres/init-extensions.sql runs first as superuser.
On existing installs this migration attempts the same — it's safe to ignore
if the DB user lacks SUPERUSER (semantic_search degrades gracefully).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008_pgvector_extension"
down_revision: Union[str, None] = "0007_events_protected"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    try:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except Exception:
        pass  # semantic_search handles missing vector extension gracefully


def downgrade() -> None:
    pass  # never drop — would destroy any stored vector data
