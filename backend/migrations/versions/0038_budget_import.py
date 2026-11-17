"""IT-Budget: Import aus Excel als Vorgang mit Zeilen

Revision ID: 0038
Revises: 0037
Erstellt: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_imports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=200), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("tax_rate_bp", sa.Integer(), server_default="1900", nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "accounts",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "partners",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("skipped_rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_budget_imports_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_imports")),
    )
    op.create_index(op.f("ix_budget_imports_status"), "budget_imports", ["status"])
    op.create_table(
        "budget_import_rows",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("import_id", sa.Integer(), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=True),
        sa.Column("number", sa.String(length=80), server_default="", nullable=False),
        sa.Column("internal_number", sa.String(length=60), server_default="", nullable=False),
        sa.Column("firm", sa.String(length=160), server_default="", nullable=False),
        sa.Column("description", sa.String(length=200), server_default="", nullable=False),
        sa.Column("gross_cents", sa.BigInteger(), nullable=False),
        sa.Column("account_number", sa.String(length=20), nullable=True),
        sa.Column("yearly", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "hints",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=16), server_default="offen", nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=True),
        sa.Column("planned_item_id", sa.Integer(), nullable=True),
        sa.Column("done_by", sa.Uuid(), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["import_id"],
            ["budget_imports.id"],
            name=op.f("fk_budget_import_rows_import_id_budget_imports"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["budget_invoices.id"],
            name=op.f("fk_budget_import_rows_invoice_id_budget_invoices"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["planned_item_id"],
            ["budget_items.id"],
            name=op.f("fk_budget_import_rows_planned_item_id_budget_items"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["done_by"], ["users.id"], name=op.f("fk_budget_import_rows_done_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_import_rows")),
    )
    op.create_index(op.f("ix_budget_import_rows_import_id"), "budget_import_rows", ["import_id"])


def downgrade() -> None:
    op.drop_table("budget_import_rows")
    op.drop_table("budget_imports")
