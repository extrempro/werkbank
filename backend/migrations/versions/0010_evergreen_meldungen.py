"""Evergreen: Meldungen aus dem Nachrichtencenter

Revision ID: 0010
Revises: 0009
Erstellt: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ev_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("services", postgresql.JSONB(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=True),
        sa.Column("major_change", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("action_required_by", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["ev_items.id"], name=op.f("fk_ev_messages_item_id_ev_items")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ev_messages")),
        sa.UniqueConstraint("message_id", name=op.f("uq_ev_messages_message_id")),
    )
    op.create_index(op.f("ix_ev_messages_status"), "ev_messages", ["status"], unique=False)
    op.create_index(op.f("ix_ev_messages_item_id"), "ev_messages", ["item_id"], unique=False)


def downgrade() -> None:
    op.drop_table("ev_messages")
