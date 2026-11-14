"""Evergreen: Vorgänge

Revision ID: 0009
Revises: 0008
Erstellt: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ev_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("service", sa.String(length=100), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_ref", sa.String(length=128), nullable=True),
        sa.Column("major_change", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("rollout_date", sa.Date(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("departments_feedback", sa.Text(), nullable=True),
        sa.Column(
            "not_controllable", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("workflow_instance_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["workflow_instance_id"],
            ["workflow_instances.id"],
            name=op.f("fk_ev_items_workflow_instance_id_workflow_instances"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_ev_items_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ev_items")),
        sa.UniqueConstraint("year", "sequence", name=op.f("uq_ev_items_year")),
        sa.UniqueConstraint("source", "source_ref", name=op.f("uq_ev_items_source")),
        sa.UniqueConstraint("workflow_instance_id", name=op.f("uq_ev_items_workflow_instance_id")),
    )


def downgrade() -> None:
    op.drop_table("ev_items")
