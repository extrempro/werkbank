"""Budgetposten von Hand abschließen (je Geschäftsjahr)

Revision ID: 0054
Revises: 0053
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0054"
down_revision: str | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_item_closures",
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("budget_items.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("closed_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "closed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("budget_item_closures")
