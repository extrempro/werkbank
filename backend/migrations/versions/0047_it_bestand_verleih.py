"""IT-Bestand: Verleih mit Geräten, Nachrichten an die Person und Nummernkreis L-

Revision ID: 0047
Revises: 0046
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_loans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.String(length=20), nullable=False, unique=True),
        sa.Column("person_oid", sa.String(length=36), nullable=False),
        sa.Column("person_name", sa.String(length=200), nullable=False),
        sa.Column("person_upn", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("person_mail", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("issued_on", sa.Date(), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=False),
        sa.Column("returned_on", sa.Date(), nullable=True),
        sa.Column("note", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("reminded_on", sa.Date(), nullable=True),
        sa.Column("overdue_notified_on", sa.Date(), nullable=True),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_inventory_loans_person_oid", "inventory_loans", ["person_oid"])
    op.create_index("ix_inventory_loans_due_on", "inventory_loans", ["due_on"])
    op.create_index("ix_inventory_loans_returned_on", "inventory_loans", ["returned_on"])
    op.create_table(
        "inventory_loan_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "loan_id",
            sa.Integer(),
            sa.ForeignKey("inventory_loans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("returned_on", sa.Date(), nullable=True),
        sa.Column(
            "returned_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("loan_id", "hardware_id", name="uq_inventory_loan_items_loan_hardware"),
    )
    op.create_index("ix_inventory_loan_items_loan_id", "inventory_loan_items", ["loan_id"])
    op.create_index("ix_inventory_loan_items_hardware_id", "inventory_loan_items", ["hardware_id"])
    op.create_index(
        "uq_inventory_loan_items_open",
        "inventory_loan_items",
        ["hardware_id"],
        unique=True,
        postgresql_where=sa.text("returned_on IS NULL"),
    )
    op.create_table(
        "inventory_loan_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "loan_id",
            sa.Integer(),
            sa.ForeignKey("inventory_loans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("channel", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="offen"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(length=200), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_inventory_loan_messages_loan_id", "inventory_loan_messages", ["loan_id"])
    op.bulk_insert(
        sa.table(
            "inventory_number_ranges",
            sa.column("key", sa.String()),
            sa.column("prefix", sa.String()),
            sa.column("next_value", sa.Integer()),
        ),
        [{"key": "verleih", "prefix": "L-", "next_value": 1}],
    )


def downgrade() -> None:
    op.execute("DELETE FROM inventory_number_ranges WHERE key = 'verleih'")
    op.drop_table("inventory_loan_messages")
    op.drop_table("inventory_loan_items")
    op.drop_table("inventory_loans")
