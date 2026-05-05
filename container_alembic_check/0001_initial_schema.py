"""Initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "frigate_servers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String, nullable=False, unique=True),
        sa.Column("display_name", sa.String, nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("rtsp_base", sa.Text, nullable=False),
        sa.Column("mqtt_host", sa.String, nullable=True),
        sa.Column("mqtt_port", sa.Integer, nullable=False, server_default="1883"),
        sa.Column("api_key", sa.Text, nullable=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "cameras",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("frigate_servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("display_name", sa.String, nullable=False),
        sa.Column("frigate_name", sa.String, nullable=False),
        sa.Column("ome_stream_main", sa.Text, nullable=True),
        sa.Column("ome_stream_sub", sa.Text, nullable=True),
        sa.Column("llhls_main", sa.Text, nullable=True),
        sa.Column("llhls_sub", sa.Text, nullable=True),
        sa.Column("rtsp_main", sa.Text, nullable=True),
        sa.Column("rtsp_sub", sa.Text, nullable=True),
        sa.Column("has_audio", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("has_ptz", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("position_x", sa.Float, nullable=True),
        sa.Column("position_y", sa.Float, nullable=True),
        sa.Column("floor_level", sa.Integer, nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("tags", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("server_id", "frigate_name", name="uq_camera_server_frigate_name"),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("username", sa.String, nullable=False, unique=True),
        sa.Column("email", sa.String, nullable=True, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("full_name", sa.String, nullable=True),
        sa.Column("role", sa.String, nullable=False, server_default=sa.text("'viewer'")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "camera_permissions",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("camera_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False),
        sa.Column("can_view", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("can_playback", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("can_export", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("can_ptz", sa.Boolean, nullable=False, server_default="false"),
        sa.PrimaryKeyConstraint("user_id", "camera_id"),
    )

    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("frigate_event_id", sa.String, nullable=True, unique=True),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("frigate_servers.id"), nullable=True),
        sa.Column("camera_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cameras.id"), nullable=True),
        sa.Column("label", sa.String, nullable=False),
        sa.Column("sub_label", sa.String, nullable=True),
        sa.Column("event_type", sa.String, nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("score", sa.Numeric(5, 2), nullable=True),
        sa.Column("zones", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("has_clip", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("has_snapshot", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("snapshot_path", sa.Text, nullable=True),
        sa.Column("clip_path", sa.Text, nullable=True),
        sa.Column("plate_number", sa.String, nullable=True),
        sa.Column("plate_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=False, server_default="{}"),
    )

    op.execute("CREATE INDEX idx_events_camera_time ON events (camera_id, start_time DESC)")
    op.execute("CREATE INDEX idx_events_label_time ON events (label, start_time DESC)")
    op.execute("CREATE INDEX idx_events_plate ON events (plate_number) WHERE plate_number IS NOT NULL")
    op.execute("CREATE INDEX idx_events_metadata_gin ON events USING GIN (metadata)")
    op.execute("CREATE INDEX idx_events_server_time ON events (server_id, start_time DESC)")

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String, nullable=False),
        sa.Column("resource_type", sa.String, nullable=True),
        sa.Column("resource_id", sa.String, nullable=True),
        sa.Column("details", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("ip_address", postgresql.INET, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "plugins",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String, nullable=False, unique=True),
        sa.Column("version", sa.String, nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("config", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )


def downgrade() -> None:
    op.drop_table("plugins")
    op.drop_table("audit_logs")
    op.execute("DROP INDEX IF EXISTS idx_events_server_time")
    op.execute("DROP INDEX IF EXISTS idx_events_metadata_gin")
    op.execute("DROP INDEX IF EXISTS idx_events_plate")
    op.execute("DROP INDEX IF EXISTS idx_events_label_time")
    op.execute("DROP INDEX IF EXISTS idx_events_camera_time")
    op.drop_table("events")
    op.drop_table("camera_permissions")
    op.drop_table("users")
    op.drop_table("cameras")
    op.drop_table("frigate_servers")
