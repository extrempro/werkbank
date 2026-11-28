"""IT-Monitoring, FortiGate: Geräte, Konfigurationsstände, Abrufe

Revision ID: 0097
Revises: 0096
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0097"
down_revision: str | None = "0096"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_fg_devices",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
        sa.Column("url", sa.String(300), nullable=False),
        sa.Column("token_encrypted", sa.Text, nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "runtime",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("runtime_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_table(
        "mon_fg_snapshots",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "device_id",
            sa.Integer,
            sa.ForeignKey("mon_fg_devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("data", postgresql.JSONB, nullable=False),
    )
    op.create_table(
        "mon_fg_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "device_id",
            sa.Integer,
            sa.ForeignKey("mon_fg_devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("duration_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean, nullable=False),
        sa.Column("error", sa.String(500)),
        sa.Column("changed", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column(
            "snapshot_id",
            sa.Integer,
            sa.ForeignKey("mon_fg_snapshots.id", ondelete="SET NULL"),
        ),
    )


def downgrade() -> None:
    op.drop_table("mon_fg_runs")
    op.drop_table("mon_fg_snapshots")
    op.drop_table("mon_fg_devices")
