"""IT-Tools: Favoriten, zuletzt genutzte Tools und Verlauf je Konto

Revision ID: 0036
Revises: 0035
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tool_prefs",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("favorites", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("recent", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("history_enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_tool_prefs_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_tool_prefs")),
    )
    op.create_table(
        "tool_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("tool", sa.String(length=60), nullable=False),
        sa.Column("params", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("summary", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_tool_history_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tool_history")),
    )
    op.create_index(op.f("ix_tool_history_user_id"), "tool_history", ["user_id"])
    op.create_index(op.f("ix_tool_history_created_at"), "tool_history", ["created_at"])


def downgrade() -> None:
    op.drop_table("tool_history")
    op.drop_table("tool_prefs")
