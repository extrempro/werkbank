"""IT-Bestand: Nutzungsdauer je Hardware-Art (Erneuerungsbedarf in der Statistik)

Revision ID: 0063
Revises: 0062
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0063"
down_revision: str | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("inventory_kinds", sa.Column("lifetime_years", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("inventory_kinds", "lifetime_years")
