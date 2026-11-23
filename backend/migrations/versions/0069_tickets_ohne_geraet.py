"""Tickets: Verknüpfung mit einem Gerät entfernt (Spalte `hardware_id`)

Bestehende Verknüpfungen gehen dabei verloren (so entschieden); der Eintrag „Gerät: …“ im
Verlauf der Tickets bleibt.

Revision ID: 0069
Revises: 0068
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0069"
down_revision: str | None = "0068"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("fk_tickets_hardware_id_inventory_hardware"), "tickets", type_="foreignkey"
    )
    op.drop_index(op.f("ix_tickets_hardware_id"), table_name="tickets")
    op.drop_column("tickets", "hardware_id")


def downgrade() -> None:
    op.add_column("tickets", sa.Column("hardware_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_tickets_hardware_id"), "tickets", ["hardware_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_tickets_hardware_id_inventory_hardware"),
        "tickets",
        "inventory_hardware",
        ["hardware_id"],
        ["id"],
        ondelete="SET NULL",
    )
