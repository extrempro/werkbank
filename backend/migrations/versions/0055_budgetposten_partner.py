"""Partner am Budgetposten; Import legt Posten ohne Rechnung an

Revision ID: 0055
Revises: 0054
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0055"
down_revision: str | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "budget_items",
        sa.Column("partner_id", sa.Integer(), sa.ForeignKey("budget_partners.id"), nullable=True),
    )
    op.create_index("ix_budget_items_partner_id", "budget_items", ["partner_id"])
    op.add_column(
        "budget_import_rows",
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("budget_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Bisher übernommene Zeilen: Posten über ihre Rechnung nachtragen
    op.execute(
        "UPDATE budget_import_rows AS r SET item_id = l.item_id "
        "FROM budget_invoice_lines AS l "
        "WHERE l.invoice_id = r.invoice_id AND l.position = 0 AND r.item_id IS NULL"
    )


def downgrade() -> None:
    op.drop_column("budget_import_rows", "item_id")
    op.drop_index("ix_budget_items_partner_id", table_name="budget_items")
    op.drop_column("budget_items", "partner_id")
