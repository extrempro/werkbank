"""IT-Bestand: Platz des Arbeitsplatzes im Raum (Grundriss)

Revision ID: 0050
Revises: 0049
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("inventory_workplaces", sa.Column("spot_x", sa.Float(), nullable=True))
    op.add_column("inventory_workplaces", sa.Column("spot_y", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("inventory_workplaces", "spot_y")
    op.drop_column("inventory_workplaces", "spot_x")
