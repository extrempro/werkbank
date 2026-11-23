"""Bestand: Grund des letzten fehlgeschlagenen PSREF-Abrufs je Modell

Revision ID: 0073
Revises: 0072
Erstellt: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0073"
down_revision: str | None = "0072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_models",
        sa.Column("psref_error", sa.String(length=300), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("inventory_models", "psref_error")
