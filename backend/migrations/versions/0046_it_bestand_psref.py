"""IT-Bestand: technische Daten aus Lenovo PSREF je Modell

Revision ID: 0046
Revises: 0045
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("psref_key", 120),
    ("psref_name", 160),
    ("psref_url", 300),
    ("psref_status", 16),
)


def upgrade() -> None:
    for name, length in COLUMNS:
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
    op.drop_column("inventory_models", "psref_checked_at")
    op.drop_column("inventory_models", "psref_specs")
    for name, _length in reversed(COLUMNS):
        op.drop_column("inventory_models", name)
