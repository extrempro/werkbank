"""IT-Budget: PDF-Beleg an der Rechnung

Revision ID: 0024
Revises: 0023
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("budget_invoices", sa.Column("doc_name", sa.String(length=200), nullable=True))
    op.add_column("budget_invoices", sa.Column("doc_key", sa.String(length=64), nullable=True))
    op.add_column("budget_invoices", sa.Column("doc_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("budget_invoices", "doc_size")
    op.drop_column("budget_invoices", "doc_key")
    op.drop_column("budget_invoices", "doc_name")
