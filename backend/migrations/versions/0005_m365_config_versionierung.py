"""M365-Konfiguration: Abrufe, Einstellungen, Versionen, Änderungen

Revision ID: 0005
Revises: 0004
Erstellt: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cfg_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "source_status",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("change_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cfg_snapshots")),
    )
    op.create_index(
        op.f("ix_cfg_snapshots_started_at"), "cfg_snapshots", ["started_at"], unique=False
    )
    op.create_table(
        "cfg_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("path", sa.String(length=1024), nullable=False),
        sa.Column("workload", sa.String(length=64), nullable=False),
        sa.Column("area", sa.String(length=128), nullable=False),
        sa.Column("object_id", sa.String(length=256), nullable=False),
        sa.Column("object_name", sa.String(length=512), nullable=True),
        sa.Column("property", sa.String(length=256), nullable=False),
        sa.Column("source", sa.String(length=128), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cfg_settings")),
        sa.UniqueConstraint("path", name=op.f("uq_cfg_settings_path")),
    )
    op.create_index(op.f("ix_cfg_settings_workload"), "cfg_settings", ["workload"], unique=False)
    op.create_index(op.f("ix_cfg_settings_source"), "cfg_settings", ["source"], unique=False)
    op.create_table(
        "cfg_setting_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("setting_id", sa.Integer(), nullable=False),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("snapshot_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["setting_id"],
            ["cfg_settings.id"],
            name=op.f("fk_cfg_setting_versions_setting_id_cfg_settings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["cfg_snapshots.id"],
            name=op.f("fk_cfg_setting_versions_snapshot_id_cfg_snapshots"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cfg_setting_versions")),
    )
    op.create_index(
        op.f("ix_cfg_setting_versions_setting_id"),
        "cfg_setting_versions",
        ["setting_id"],
        unique=False,
    )
    op.create_table(
        "cfg_changes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("setting_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("old_value", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("new_value", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("snapshot_id", sa.Integer(), nullable=False),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("changed_by", sa.String(length=320), nullable=True),
        sa.Column("audit_ref", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["setting_id"],
            ["cfg_settings.id"],
            name=op.f("fk_cfg_changes_setting_id_cfg_settings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["cfg_snapshots.id"],
            name=op.f("fk_cfg_changes_snapshot_id_cfg_snapshots"),
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by"], ["users.id"], name=op.f("fk_cfg_changes_reviewed_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cfg_changes")),
    )
    for column in ("setting_id", "snapshot_id", "detected_at", "status"):
        op.create_index(op.f(f"ix_cfg_changes_{column}"), "cfg_changes", [column], unique=False)


def downgrade() -> None:
    op.drop_table("cfg_changes")
    op.drop_table("cfg_setting_versions")
    op.drop_table("cfg_settings")
    op.drop_table("cfg_snapshots")
