"""M365-Konfiguration: gepflegte Angaben je Einstellung mit Verlauf

Revision ID: 0007
Revises: 0006
Erstellt: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cfg_setting_meta",
        sa.Column("setting_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("criticality", sa.String(length=16), nullable=True),
        sa.Column("owner", sa.String(length=256), nullable=True),
        sa.Column("learn_url", sa.String(length=500), nullable=True),
        sa.Column("target_set", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "target_value", postgresql.JSONB(), server_default=sa.text("'null'"), nullable=False
        ),
        sa.Column("target_source", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["setting_id"],
            ["cfg_settings.id"],
            name=op.f("fk_cfg_setting_meta_setting_id_cfg_settings"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("setting_id", name=op.f("pk_cfg_setting_meta")),
    )
    op.create_table(
        "cfg_setting_meta_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("setting_id", sa.Integer(), nullable=False),
        sa.Column("field", sa.String(length=32), nullable=False),
        sa.Column("old_value", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("new_value", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["setting_id"],
            ["cfg_settings.id"],
            name=op.f("fk_cfg_setting_meta_history_setting_id_cfg_settings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_cfg_setting_meta_history_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cfg_setting_meta_history")),
    )
    op.create_index(
        op.f("ix_cfg_setting_meta_history_setting_id"),
        "cfg_setting_meta_history",
        ["setting_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("cfg_setting_meta_history")
    op.drop_table("cfg_setting_meta")
