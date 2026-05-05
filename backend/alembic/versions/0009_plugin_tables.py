"""Add plugin tables: face_embeddings, semantic_events

Revision ID: 0009_plugin_tables
Revises: 0008_pgvector_extension
Create Date: 2026-05-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_plugin_tables"
down_revision: Union[str, None] = "0008_pgvector_extension"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "face_embeddings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("person_name", sa.String, nullable=False),
        sa.Column("person_id", sa.String, nullable=True),
        sa.Column("embedding", sa.LargeBinary, nullable=True),
        sa.Column("image_bytes", sa.LargeBinary, nullable=True),
        sa.Column("camera_id", sa.String, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("metadata", postgresql.JSONB, nullable=False, server_default="{}"),
    )
    op.create_index("idx_face_embeddings_person", "face_embeddings", ["person_name"])

    op.create_table(
        "semantic_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("camera_id", sa.String, nullable=True),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("image_embedding", sa.LargeBinary, nullable=True),
        sa.Column("text_embedding", sa.LargeBinary, nullable=True),
        sa.Column("thumbnail_bytes", sa.LargeBinary, nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_semantic_events_camera", "semantic_events", ["camera_id"])


def downgrade() -> None:
    op.drop_index("idx_semantic_events_camera", table_name="semantic_events")
    op.drop_table("semantic_events")
    op.drop_index("idx_face_embeddings_person", table_name="face_embeddings")
    op.drop_table("face_embeddings")
