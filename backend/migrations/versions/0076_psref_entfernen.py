"""Bestand: Abruf technischer Daten aus Lenovo PSREF entfernt

Entfernt die PSREF-Spalten der Modelle, offene PSREF-Aufträge und die
PSREF-Einstellungen in der NinjaOne-Anbindung.

Revision ID: 0076
Revises: 0075
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0076"
down_revision: str | None = "0075"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TEXT_COLUMNS = (
    ("psref_key", 120),
    ("psref_name", 160),
    ("psref_url", 300),
    ("psref_status", 16),
    ("psref_error", 300),
)


def upgrade() -> None:
    op.execute("DELETE FROM jobs WHERE type = 'bestand.psref'")
    op.execute(
        "UPDATE app_settings SET value = value - 'psref_enabled' - 'psref_user_agent' "
        "WHERE key = 'inventory.ninjaone' AND jsonb_typeof(value) = 'object'"
    )
    op.drop_column("inventory_models", "psref_checked_at")
    op.drop_column("inventory_models", "psref_specs")
    for name, _length in reversed(TEXT_COLUMNS):
        op.drop_column("inventory_models", name)


def downgrade() -> None:
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
