"""Dokumentation (Phase D3): Kommentare an Textstellen mit Erwähnungen

Revision ID: 0083
Revises: 0082
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0083"
down_revision: str | None = "0082"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "doku_threads",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "page_id",
            sa.Uuid(),
            sa.ForeignKey("doku_pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("anchor", JSONB()),
        sa.Column("quote", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_by_oid", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_by_name", sa.String(256), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by_name", sa.String(256), nullable=False, server_default=""),
    )
    op.create_index("ix_doku_threads_page_id", "doku_threads", ["page_id"])
    op.create_table(
        "doku_comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "thread_id",
            sa.Uuid(),
            sa.ForeignKey("doku_threads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_oid", sa.String(64), nullable=False, server_default=""),
        sa.Column("author_name", sa.String(256), nullable=False, server_default=""),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("mentions", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_doku_comments_thread_id", "doku_comments", ["thread_id"])
    op.create_index("ix_doku_comments_created_at", "doku_comments", ["created_at"])


def downgrade() -> None:
    op.drop_table("doku_comments")
    op.drop_table("doku_threads")
