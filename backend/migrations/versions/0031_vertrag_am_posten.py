"""IT-Budget: Vertrag am Budgetposten, nicht mehr an der Rechnungsposition

Eine Rechnungsposition gehört nur noch zu einem Budgetposten; den Vertrag gibt der Posten vor.
Ein Budgetposten hat höchstens einen Vertrag. Hat ein Posten bisher mehrere, bleibt die
Zuordnung zum zuerst angelegten Vertrag (kleinste Nummer); die Verträge selbst bleiben.

Revision ID: 0031
Revises: 0030
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM budget_contract_items AS link
        WHERE link.contract_id > (
            SELECT min(other.contract_id) FROM budget_contract_items AS other
            WHERE other.item_id = link.item_id
        )
        """
    )
    op.drop_index(op.f("ix_budget_contract_items_item_id"), table_name="budget_contract_items")
    op.create_unique_constraint(
        op.f("uq_budget_contract_items_item_id"), "budget_contract_items", ["item_id"]
    )
    op.drop_index(op.f("ix_budget_invoice_lines_contract_id"), table_name="budget_invoice_lines")
    op.drop_constraint(
        op.f("fk_budget_invoice_lines_contract_id_budget_contracts"),
        "budget_invoice_lines",
        type_="foreignkey",
    )
    op.drop_column("budget_invoice_lines", "contract_id")


def downgrade() -> None:
    """Die Spalte kommt leer zurück; der frühere Vertrag je Position ist nicht wiederherstellbar."""
    op.add_column("budget_invoice_lines", sa.Column("contract_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        op.f("fk_budget_invoice_lines_contract_id_budget_contracts"),
        "budget_invoice_lines",
        "budget_contracts",
        ["contract_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_budget_invoice_lines_contract_id"), "budget_invoice_lines", ["contract_id"]
    )
    op.drop_constraint(
        op.f("uq_budget_contract_items_item_id"), "budget_contract_items", type_="unique"
    )
    op.create_index(op.f("ix_budget_contract_items_item_id"), "budget_contract_items", ["item_id"])
