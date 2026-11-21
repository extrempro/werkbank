"""Feste Nummer je Budgetposten: BP-<Jahr>-<laufende Nummer>

Revision ID: 0056
Revises: 0055
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0056"
down_revision: str | None = "0055"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("budget_items", sa.Column("number_year", sa.Integer(), nullable=True))
    op.add_column("budget_items", sa.Column("number_seq", sa.Integer(), nullable=True))
    # Bestehende Posten: Jahr ist ihr erstes Geschäftsjahr, gezählt in der Reihenfolge der Anlage
    op.execute(
        "UPDATE budget_items AS i SET number_year = n.start_year, number_seq = n.seq "
        "FROM (SELECT id, start_year, "
        "ROW_NUMBER() OVER (PARTITION BY start_year ORDER BY id) AS seq FROM budget_items) AS n "
        "WHERE n.id = i.id"
    )
    op.alter_column("budget_items", "number_year", nullable=False)
    op.alter_column("budget_items", "number_seq", nullable=False)
    op.create_unique_constraint(
        "uq_budget_items_number_year", "budget_items", ["number_year", "number_seq"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_budget_items_number_year", "budget_items", type_="unique")
    op.drop_column("budget_items", "number_seq")
    op.drop_column("budget_items", "number_year")
