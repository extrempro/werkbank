"""IT-Budget: Budgetposten, Plan je Posten, Verträge mit Netto und Steuersatz

Revision ID: 0021
Revises: 0020
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("note", sa.String(length=500), server_default="", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["budget_accounts.id"],
            name=op.f("fk_budget_items_account_id_budget_accounts"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_items")),
        sa.UniqueConstraint("account_id", "name", name=op.f("uq_budget_items_account_id")),
    )
    op.create_index(
        op.f("ix_budget_items_account_id"), "budget_items", ["account_id"], unique=False
    )
    # Vorhandene Pläne und Verträge hängen bisher am Konto: Jedes betroffene Konto bekommt
    # einen ersten Posten „Allgemein“, der sie übernimmt.
    op.execute(
        """
        INSERT INTO budget_items (account_id, name)
        SELECT a.id, 'Allgemein' FROM budget_accounts a
        WHERE EXISTS (SELECT 1 FROM budget_plans p WHERE p.account_id = a.id)
           OR EXISTS (SELECT 1 FROM budget_contracts c WHERE c.account_id = a.id)
        """
    )

    op.add_column("budget_plans", sa.Column("item_id", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE budget_plans p SET item_id = i.id FROM budget_items i "
        "WHERE i.account_id = p.account_id"
    )
    op.drop_constraint(op.f("pk_budget_plans"), "budget_plans", type_="primary")
    op.drop_constraint(
        op.f("fk_budget_plans_account_id_budget_accounts"), "budget_plans", type_="foreignkey"
    )
    op.drop_column("budget_plans", "account_id")
    op.alter_column("budget_plans", "item_id", nullable=False)
    op.create_primary_key(op.f("pk_budget_plans"), "budget_plans", ["item_id", "fiscal_year"])
    op.create_foreign_key(
        op.f("fk_budget_plans_item_id_budget_items"),
        "budget_plans",
        "budget_items",
        ["item_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.add_column("budget_contracts", sa.Column("item_id", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE budget_contracts c SET item_id = i.id FROM budget_items i "
        "WHERE i.account_id = c.account_id"
    )
    op.drop_index(op.f("ix_budget_contracts_account_id"), table_name="budget_contracts")
    op.drop_constraint(
        op.f("fk_budget_contracts_account_id_budget_accounts"),
        "budget_contracts",
        type_="foreignkey",
    )
    op.drop_column("budget_contracts", "account_id")
    op.alter_column("budget_contracts", "item_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_budget_contracts_item_id_budget_items"),
        "budget_contracts",
        "budget_items",
        ["item_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_budget_contracts_item_id"), "budget_contracts", ["item_id"], unique=False
    )

    # Bisher war nur das Brutto bekannt: Es bleibt, das Netto wird gleichgesetzt (Steuersatz 0).
    op.add_column("budget_contracts", sa.Column("net_cents", sa.BigInteger(), nullable=True))
    op.add_column(
        "budget_contracts",
        sa.Column("tax_rate_bp", sa.Integer(), server_default="1900", nullable=False),
    )
    op.execute("UPDATE budget_contracts SET net_cents = amount_cents, tax_rate_bp = 0")
    op.alter_column("budget_contracts", "net_cents", nullable=False)


def downgrade() -> None:
    op.drop_column("budget_contracts", "tax_rate_bp")
    op.drop_column("budget_contracts", "net_cents")

    op.add_column("budget_contracts", sa.Column("account_id", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE budget_contracts c SET account_id = i.account_id FROM budget_items i "
        "WHERE i.id = c.item_id"
    )
    op.drop_index(op.f("ix_budget_contracts_item_id"), table_name="budget_contracts")
    op.drop_constraint(
        op.f("fk_budget_contracts_item_id_budget_items"), "budget_contracts", type_="foreignkey"
    )
    op.drop_column("budget_contracts", "item_id")
    op.alter_column("budget_contracts", "account_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_budget_contracts_account_id_budget_accounts"),
        "budget_contracts",
        "budget_accounts",
        ["account_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_budget_contracts_account_id"), "budget_contracts", ["account_id"], unique=False
    )

    # Pläne mehrerer Posten eines Kontos werden wieder zu einem Plan je Konto summiert.
    op.execute(
        """
        CREATE TEMPORARY TABLE budget_plans_alt AS
        SELECT i.account_id, p.fiscal_year, sum(p.amount_cents) AS amount_cents,
               max(p.updated_at) AS updated_at
        FROM budget_plans p JOIN budget_items i ON i.id = p.item_id
        GROUP BY i.account_id, p.fiscal_year
        """
    )
    op.execute("DELETE FROM budget_plans")
    op.drop_constraint(
        op.f("fk_budget_plans_item_id_budget_items"), "budget_plans", type_="foreignkey"
    )
    op.drop_constraint(op.f("pk_budget_plans"), "budget_plans", type_="primary")
    op.drop_column("budget_plans", "item_id")
    op.add_column("budget_plans", sa.Column("account_id", sa.Integer(), nullable=False))
    op.create_primary_key(op.f("pk_budget_plans"), "budget_plans", ["account_id", "fiscal_year"])
    op.create_foreign_key(
        op.f("fk_budget_plans_account_id_budget_accounts"),
        "budget_plans",
        "budget_accounts",
        ["account_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(
        "INSERT INTO budget_plans (account_id, fiscal_year, amount_cents, updated_at) "
        "SELECT account_id, fiscal_year, amount_cents, updated_at FROM budget_plans_alt"
    )
    op.execute("DROP TABLE budget_plans_alt")
    op.drop_index(op.f("ix_budget_items_account_id"), table_name="budget_items")
    op.drop_table("budget_items")
