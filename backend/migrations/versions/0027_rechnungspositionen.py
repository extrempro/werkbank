"""IT-Budget: Rechnungen mit Positionen

Jede bestehende Rechnung bekommt genau eine Position mit ihrem bisherigen Budgetposten,
Vertrag, Betrag und Steuersatz. Posten, Vertrag und Steuersatz stehen danach nur noch an
der Position; an der Rechnung bleiben die Summen.

Revision ID: 0027
Revises: 0026
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MOVED = ("item_id", "contract_id", "tax_rate_bp", "description", "is_project", "is_yearly")


def upgrade() -> None:
    op.create_table(
        "budget_invoice_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("contract_id", sa.Integer(), nullable=True),
        sa.Column("net_cents", sa.BigInteger(), nullable=False),
        sa.Column("tax_rate_bp", sa.Integer(), nullable=False),
        sa.Column("gross_cents", sa.BigInteger(), nullable=False),
        sa.Column("description", sa.String(length=200), server_default="", nullable=False),
        sa.Column("is_project", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_yearly", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["budget_invoices.id"],
            name=op.f("fk_budget_invoice_lines_invoice_id_budget_invoices"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["budget_items.id"],
            name=op.f("fk_budget_invoice_lines_item_id_budget_items"),
        ),
        sa.ForeignKeyConstraint(
            ["contract_id"],
            ["budget_contracts.id"],
            name=op.f("fk_budget_invoice_lines_contract_id_budget_contracts"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_invoice_lines")),
    )
    for column in ("invoice_id", "item_id", "contract_id"):
        op.create_index(op.f(f"ix_budget_invoice_lines_{column}"), "budget_invoice_lines", [column])
    op.execute(
        """
        INSERT INTO budget_invoice_lines
            (invoice_id, position, item_id, contract_id, net_cents, tax_rate_bp, gross_cents,
             description, is_project, is_yearly)
        SELECT id, 0, item_id, contract_id, net_cents, tax_rate_bp, gross_cents,
               description, is_project, is_yearly
        FROM budget_invoices
        """
    )
    for column in MOVED:
        op.drop_column("budget_invoices", column)


def downgrade() -> None:
    """Zurück zu einem Posten je Rechnung: Es gilt die erste Position, die Summen bleiben."""
    op.add_column("budget_invoices", sa.Column("item_id", sa.Integer(), nullable=True))
    op.add_column("budget_invoices", sa.Column("contract_id", sa.Integer(), nullable=True))
    op.add_column("budget_invoices", sa.Column("tax_rate_bp", sa.Integer(), nullable=True))
    op.add_column(
        "budget_invoices",
        sa.Column("description", sa.String(length=200), server_default="", nullable=False),
    )
    op.add_column(
        "budget_invoices",
        sa.Column("is_project", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "budget_invoices",
        sa.Column("is_yearly", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.execute(
        """
        UPDATE budget_invoices AS invoice
        SET item_id = line.item_id, contract_id = line.contract_id,
            tax_rate_bp = line.tax_rate_bp, description = line.description,
            is_project = line.is_project, is_yearly = line.is_yearly
        FROM budget_invoice_lines AS line
        WHERE line.invoice_id = invoice.id
          AND line.position = (
              SELECT min(position) FROM budget_invoice_lines WHERE invoice_id = invoice.id
          )
        """
    )
    op.alter_column("budget_invoices", "item_id", nullable=False)
    op.alter_column("budget_invoices", "tax_rate_bp", nullable=False)
    op.create_foreign_key(
        op.f("fk_budget_invoices_item_id_budget_items"),
        "budget_invoices",
        "budget_items",
        ["item_id"],
        ["id"],
    )
    op.create_foreign_key(
        op.f("fk_budget_invoices_contract_id_budget_contracts"),
        "budget_invoices",
        "budget_contracts",
        ["contract_id"],
        ["id"],
    )
    op.create_index(op.f("ix_budget_invoices_item_id"), "budget_invoices", ["item_id"])
    op.create_index(op.f("ix_budget_invoices_contract_id"), "budget_invoices", ["contract_id"])
    op.drop_table("budget_invoice_lines")
