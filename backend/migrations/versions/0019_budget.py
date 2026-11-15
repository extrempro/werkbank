"""IT-Budget: Konten und Plan je Geschäftsjahr

Revision ID: 0019
Revises: 0018
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("number", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("note", sa.String(length=500), server_default="", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_accounts")),
        sa.UniqueConstraint("number", name=op.f("uq_budget_accounts_number")),
    )
    op.create_table(
        "budget_plans",
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["budget_accounts.id"],
            name=op.f("fk_budget_plans_account_id_budget_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"], name=op.f("fk_budget_plans_updated_by_users")
        ),
        sa.PrimaryKeyConstraint("account_id", "fiscal_year", name=op.f("pk_budget_plans")),
    )


def downgrade() -> None:
    op.drop_table("budget_plans")
    op.drop_table("budget_accounts")
