"""IT-Budget: Vertrag mehreren Budgetposten zuordnen

Ein Vertrag gehört nicht mehr zu genau einem Budgetposten, sondern ist einem oder mehreren
zugeordnet. Jeder bestehende Vertrag behält seinen bisherigen Posten als einzige Zuordnung.

Revision ID: 0030
Revises: 0029
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_contract_items",
        sa.Column("contract_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["contract_id"],
            ["budget_contracts.id"],
            name=op.f("fk_budget_contract_items_contract_id_budget_contracts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["budget_items.id"],
            name=op.f("fk_budget_contract_items_item_id_budget_items"),
        ),
        sa.PrimaryKeyConstraint("contract_id", "item_id", name=op.f("pk_budget_contract_items")),
    )
    op.create_index(op.f("ix_budget_contract_items_item_id"), "budget_contract_items", ["item_id"])
    op.execute(
        "INSERT INTO budget_contract_items (contract_id, item_id) "
        "SELECT id, item_id FROM budget_contracts"
    )
    op.drop_index(op.f("ix_budget_contracts_item_id"), table_name="budget_contracts")
    op.drop_constraint(
        op.f("fk_budget_contracts_item_id_budget_items"), "budget_contracts", type_="foreignkey"
    )
    op.drop_column("budget_contracts", "item_id")


def downgrade() -> None:
    """Zurück zu einem Posten je Vertrag: Es gilt der Posten mit der kleinsten Nummer.
    Verträge ohne Zuordnung werden dabei gelöscht."""
    op.add_column("budget_contracts", sa.Column("item_id", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE budget_contracts AS contract
        SET item_id = (
            SELECT min(link.item_id) FROM budget_contract_items AS link
            WHERE link.contract_id = contract.id
        )
        """
    )
    op.execute(
        "UPDATE budget_invoice_lines SET contract_id = NULL WHERE contract_id IN "
        "(SELECT id FROM budget_contracts WHERE item_id IS NULL)"
    )
    op.execute("DELETE FROM budget_contracts WHERE item_id IS NULL")
    op.alter_column("budget_contracts", "item_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_budget_contracts_item_id_budget_items"),
        "budget_contracts",
        "budget_items",
        ["item_id"],
        ["id"],
    )
    op.create_index(op.f("ix_budget_contracts_item_id"), "budget_contracts", ["item_id"])
    op.drop_table("budget_contract_items")
