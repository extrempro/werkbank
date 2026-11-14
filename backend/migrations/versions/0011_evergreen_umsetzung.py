"""Evergreen: geplante Umsetzung (Soll-Werte je Vorgang)

Revision ID: 0011
Revises: 0010
Erstellt: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ev_plan",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("setting_id", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(length=300), nullable=False),
        sa.Column("target_value", postgresql.JSONB(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=True),
        sa.Column("provisional", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("confirmed_by", sa.Uuid(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["ev_items.id"], name=op.f("fk_ev_plan_item_id_ev_items")
        ),
        sa.ForeignKeyConstraint(
            ["setting_id"],
            ["cfg_settings.id"],
            name=op.f("fk_ev_plan_setting_id_cfg_settings"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["confirmed_by"], ["users.id"], name=op.f("fk_ev_plan_confirmed_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_ev_plan_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ev_plan")),
    )
    op.create_index(op.f("ix_ev_plan_item_id"), "ev_plan", ["item_id"], unique=False)
    op.create_index(op.f("ix_ev_plan_setting_id"), "ev_plan", ["setting_id"], unique=False)


def downgrade() -> None:
    op.drop_table("ev_plan")
