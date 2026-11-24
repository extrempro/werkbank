"""Tickets: Leiste „Favoriten“ und „Geöffnet“ je Person mit Einstellungen

Revision ID: 0084
Revises: 0083
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0084"
down_revision: str | None = "0083"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ticket_recent",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("oid", sa.String(64), nullable=False),
        sa.Column(
            "ticket_id",
            sa.Uuid(),
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("favorite", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("oid", "ticket_id", name="uq_ticket_recent_oid_ticket"),
    )
    op.create_index("ix_ticket_recent_oid", "ticket_recent", ["oid"])
    op.create_index("ix_ticket_recent_ticket_id", "ticket_recent", ["ticket_id"])
    op.create_table(
        "ticket_nav_prefs",
        sa.Column("oid", sa.String(64), primary_key=True),
        sa.Column("recent_limit", sa.Integer(), nullable=False, server_default=sa.text("15")),
        sa.Column("compact", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_table("ticket_nav_prefs")
    op.drop_index("ix_ticket_recent_ticket_id", table_name="ticket_recent")
    op.drop_index("ix_ticket_recent_oid", table_name="ticket_recent")
    op.drop_table("ticket_recent")
