"""Tickets: Lösung bei „Gelöst“ mit Lösungsart je Bereich

Revision ID: 0078
Revises: 0077
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0078"
down_revision: str | None = "0077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ticket_solution_types",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_solution_types_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_solution_types")),
        sa.UniqueConstraint("area_id", "name", name="uq_ticket_solution_type"),
    )
    op.create_index(op.f("ix_ticket_solution_types_area_id"), "ticket_solution_types", ["area_id"])
    op.add_column("tickets", sa.Column("solution_type_id", sa.Integer(), nullable=True))
    op.add_column(
        "tickets", sa.Column("solution_text", sa.Text(), server_default="", nullable=False)
    )
    op.add_column(
        "tickets",
        sa.Column("solution_public", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.create_foreign_key(
        op.f("fk_tickets_solution_type_id_ticket_solution_types"),
        "tickets",
        "ticket_solution_types",
        ["solution_type_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_tickets_solution_type_id_ticket_solution_types"), "tickets", type_="foreignkey"
    )
    op.drop_column("tickets", "solution_public")
    op.drop_column("tickets", "solution_text")
    op.drop_column("tickets", "solution_type_id")
    op.drop_index(op.f("ix_ticket_solution_types_area_id"), table_name="ticket_solution_types")
    op.drop_table("ticket_solution_types")
