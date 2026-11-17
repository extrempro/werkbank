"""Nutzung der Dienste: Summen je Zeitraum und aktive Benutzer je Tag

Revision ID: 0040
Revises: 0039
Erstellt: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tenant_usage_periods",
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("service", sa.String(length=32), nullable=False),
        sa.Column("active", sa.Integer(), nullable=False),
        sa.Column("inactive", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("days", "service"),
    )
    op.create_table(
        "tenant_usage_days",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("service", sa.String(length=32), nullable=False),
        sa.Column("active", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("day", "service"),
    )


def downgrade() -> None:
    op.drop_table("tenant_usage_days")
    op.drop_table("tenant_usage_periods")
