"""IT-Budget: Stand der Planung je Geschäftsjahr, Partner am Budgetposten

Revision ID: 0023
Revises: 0022
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_years",
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["released_by"], ["users.id"], name=op.f("fk_budget_years_released_by_users")
        ),
        sa.PrimaryKeyConstraint("fiscal_year", name=op.f("pk_budget_years")),
    )
    op.add_column("budget_items", sa.Column("partner_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        op.f("fk_budget_items_partner_id_budget_partners"),
        "budget_items",
        "budget_partners",
        ["partner_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_budget_items_partner_id"), "budget_items", ["partner_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_budget_items_partner_id"), table_name="budget_items")
    op.drop_constraint(
        op.f("fk_budget_items_partner_id_budget_partners"), "budget_items", type_="foreignkey"
    )
    op.drop_column("budget_items", "partner_id")
    op.drop_table("budget_years")
