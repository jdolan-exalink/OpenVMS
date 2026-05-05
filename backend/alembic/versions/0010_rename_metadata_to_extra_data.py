"""Rename metadata column to extra_data in face_embeddings and semantic_events

Revision ID: 0010
Revises: 0009_plugin_tables
Create Date: 2025-05-05

"""
from __future__ import annotations

from alembic import op


revision = "0010"
down_revision = "0009_plugin_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("face_embeddings", "metadata", new_column_name="extra_data")
    op.alter_column("semantic_events", "metadata", new_column_name="extra_data")


def downgrade() -> None:
    op.alter_column("face_embeddings", "extra_data", new_column_name="metadata")
    op.alter_column("semantic_events", "extra_data", new_column_name="metadata")
