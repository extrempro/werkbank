"""Rückmeldungen: Fehler und Ideen mit Antworten der IT

Revision ID: 0095
Revises: 0094
Erstellt: 2026-11-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0095"
down_revision: str | None = "0094"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("user_name", sa.String(256), nullable=False, server_default=""),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("page", sa.String(500), nullable=False, server_default=""),
        sa.Column("status", sa.String(12), nullable=False, server_default="neu"),
        sa.Column("technical", JSONB(), nullable=False, server_default="{}"),
        sa.Column("screenshot", sa.LargeBinary(), nullable=True),
        sa.Column("screenshot_type", sa.String(20), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_feedback_entries_user_id", "feedback_entries", ["user_id"])
    op.create_index("ix_feedback_entries_status", "feedback_entries", ["status"])
    op.create_index("ix_feedback_entries_created_at", "feedback_entries", ["created_at"])
    op.create_table(
        "feedback_replies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "entry_id",
            sa.Integer(),
            sa.ForeignKey("feedback_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("author_name", sa.String(256), nullable=False, server_default=""),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_feedback_replies_entry_id", "feedback_replies", ["entry_id"])
    op.create_index("ix_feedback_replies_created_at", "feedback_replies", ["created_at"])


def downgrade() -> None:
    op.drop_table("feedback_replies")
    op.drop_table("feedback_entries")
