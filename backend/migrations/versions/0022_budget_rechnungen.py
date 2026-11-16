"""IT-Budget: Rechnungen

Revision ID: 0022
Revises: 0021
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXED = ("invoicer_id", "invoice_date", "item_id", "contract_id", "status")


def upgrade() -> None:
    op.create_table(
        "budget_invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoicer_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.String(length=80), nullable=False),
        sa.Column("internal_number", sa.String(length=60), server_default="", nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("contract_id", sa.Integer(), nullable=True),
        sa.Column("net_cents", sa.BigInteger(), nullable=False),
        sa.Column("tax_rate_bp", sa.Integer(), nullable=False),
        sa.Column("gross_cents", sa.BigInteger(), nullable=False),
        sa.Column("description", sa.String(length=200), server_default="", nullable=False),
        sa.Column("is_project", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_yearly", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("booked_by", sa.Uuid(), nullable=True),
        sa.Column("booked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["invoicer_id"],
            ["budget_partners.id"],
            name=op.f("fk_budget_invoices_invoicer_id_budget_partners"),
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["budget_items.id"], name=op.f("fk_budget_invoices_item_id_budget_items")
        ),
        sa.ForeignKeyConstraint(
            ["contract_id"],
            ["budget_contracts.id"],
            name=op.f("fk_budget_invoices_contract_id_budget_contracts"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_budget_invoices_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["booked_by"], ["users.id"], name=op.f("fk_budget_invoices_booked_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_invoices")),
    )
    for column in INDEXED:
        op.create_index(
            op.f(f"ix_budget_invoices_{column}"), "budget_invoices", [column], unique=False
        )


def downgrade() -> None:
    for column in reversed(INDEXED):
        op.drop_index(op.f(f"ix_budget_invoices_{column}"), table_name="budget_invoices")
    op.drop_table("budget_invoices")
