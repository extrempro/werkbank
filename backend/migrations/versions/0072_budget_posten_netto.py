"""Budget: Netto und Steuersatz am Budgetposten

Bestehende Posten bekommen 19 % und das aus dem Brutto zurückgerechnete Netto (so entschieden).

Revision ID: 0072
Revises: 0071
Erstellt: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0072"
down_revision: str | None = "0071"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "budget_items",
        sa.Column("net_cents", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "budget_items",
        sa.Column("tax_rate_bp", sa.Integer(), server_default=sa.text("1900"), nullable=False),
    )
    # Netto = Brutto / 1,19, kaufmännisch gerundet (wie net_from_gross)
    op.execute(
        "UPDATE budget_items SET net_cents = (amount_cents * 20000 + 11900) / 23800, "
        "tax_rate_bp = 1900"
    )


def downgrade() -> None:
    op.drop_column("budget_items", "tax_rate_bp")
    op.drop_column("budget_items", "net_cents")
