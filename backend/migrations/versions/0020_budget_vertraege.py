"""IT-Budget: Partner und Verträge

Revision ID: 0020
Revises: 0019
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_partners",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column(
            "is_contract_partner", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("is_invoicer", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("customer_number", sa.String(length=60), server_default="", nullable=False),
        sa.Column("note", sa.String(length=500), server_default="", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_partners")),
        sa.UniqueConstraint("name", name=op.f("uq_budget_partners_name")),
    )
    op.create_table(
        "budget_contracts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("partner_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("invoicer_id", sa.Integer(), nullable=True),
        sa.Column(
            "dpa_status", sa.String(length=20), server_default="nicht_erforderlich", nullable=False
        ),
        sa.Column("number", sa.String(length=60), server_default="", nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("renewal_months", sa.Integer(), nullable=True),
        sa.Column("notice_months", sa.Integer(), nullable=True),
        sa.Column("cancelled_to", sa.Date(), nullable=True),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("interval", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=500), server_default="", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["budget_accounts.id"],
            name=op.f("fk_budget_contracts_account_id_budget_accounts"),
        ),
        sa.ForeignKeyConstraint(
            ["invoicer_id"],
            ["budget_partners.id"],
            name=op.f("fk_budget_contracts_invoicer_id_budget_partners"),
        ),
        sa.ForeignKeyConstraint(
            ["partner_id"],
            ["budget_partners.id"],
            name=op.f("fk_budget_contracts_partner_id_budget_partners"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_contracts")),
    )
    op.create_index(
        op.f("ix_budget_contracts_partner_id"), "budget_contracts", ["partner_id"], unique=False
    )
    op.create_index(
        op.f("ix_budget_contracts_account_id"), "budget_contracts", ["account_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_budget_contracts_account_id"), table_name="budget_contracts")
    op.drop_index(op.f("ix_budget_contracts_partner_id"), table_name="budget_contracts")
    op.drop_table("budget_contracts")
    op.drop_table("budget_partners")
