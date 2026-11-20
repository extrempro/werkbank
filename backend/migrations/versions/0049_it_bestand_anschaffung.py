"""IT-Bestand: Anschaffungsdatum am Gerät (für das Alter in der Statistik)

Revision ID: 0049
Revises: 0048
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0049"
down_revision: str | None = "0048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("inventory_hardware", sa.Column("purchased_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("inventory_hardware", "purchased_on")
