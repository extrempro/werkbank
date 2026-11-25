"""Bestand: technische Daten aus der offiziellen PSREF-Schnittstelle von Lenovo

Neue Spalten am Modell für Name, Link, Merkmale, Status, Fehlergrund und Zeitpunkt des
letzten Abrufs. Eingeschaltet wird der Abruf in der Verwaltung bei NinjaOne.

Revision ID: 0089
Revises: 0088
Erstellt: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0089"
down_revision: str | None = "0088"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TEXT_COLUMNS = (
    ("psref_name", 160),
    ("psref_url", 300),
    ("psref_status", 16),
    ("psref_error", 300),
)


def upgrade() -> None:
    for name, length in TEXT_COLUMNS:
        op.add_column(
            "inventory_models",
            sa.Column(name, sa.String(length=length), nullable=False, server_default=""),
        )
    op.add_column("inventory_models", sa.Column("psref_specs", JSONB(), nullable=True))
    op.add_column(
        "inventory_models",
        sa.Column("psref_checked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.execute("DELETE FROM jobs WHERE type = 'bestand.psref'")
    op.drop_column("inventory_models", "psref_checked_at")
    op.drop_column("inventory_models", "psref_specs")
    for name, _length in reversed(TEXT_COLUMNS):
        op.drop_column("inventory_models", name)
