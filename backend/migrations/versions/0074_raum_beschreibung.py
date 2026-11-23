"""Bestand: freiwillige Beschreibung (Nutzung) am Raum

Revision ID: 0074
Revises: 0073
Erstellt: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0074"
down_revision: str | None = "0073"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_rooms",
        sa.Column("description", sa.String(length=120), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("inventory_rooms", "description")
