"""IT-Budget: Tags am Budgetposten, gespeicherte Statistiken

Revision ID: 0026
Revises: 0025
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "budget_items",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.create_table(
        "budget_statistics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_budget_statistics_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_statistics")),
        sa.UniqueConstraint("name", name=op.f("uq_budget_statistics_name")),
    )


def downgrade() -> None:
    op.drop_table("budget_statistics")
    op.drop_column("budget_items", "tags")
