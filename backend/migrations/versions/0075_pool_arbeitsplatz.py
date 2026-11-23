"""Bestand: Pool-Arbeitsplätze mit Zweck (Stammdaten) und freiwilliger Abteilung

Revision ID: 0075
Revises: 0074
Erstellt: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0075"
down_revision: str | None = "0074"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_workplace_purposes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_inventory_workplace_purposes")),
        sa.UniqueConstraint("name", name=op.f("uq_inventory_workplace_purposes_name")),
    )
    op.add_column(
        "inventory_workplaces",
        sa.Column("pool", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column("inventory_workplaces", sa.Column("purpose_id", sa.Integer(), nullable=True))
    op.add_column("inventory_workplaces", sa.Column("department_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        op.f("fk_inventory_workplaces_purpose_id_inventory_workplace_purposes"),
        "inventory_workplaces",
        "inventory_workplace_purposes",
        ["purpose_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_inventory_workplaces_department_id_inventory_departments"),
        "inventory_workplaces",
        "inventory_departments",
        ["department_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        op.f("ix_inventory_workplaces_purpose_id"), "inventory_workplaces", ["purpose_id"]
    )
    op.create_index(
        op.f("ix_inventory_workplaces_department_id"), "inventory_workplaces", ["department_id"]
    )
    # Vorschläge für den Zweck; lassen sich in den Stammdaten ändern oder löschen
    op.execute(
        "INSERT INTO inventory_workplace_purposes (name) VALUES "
        "('Desk-Sharing'), ('Gast'), ('Schulung'), ('Besprechung')"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_inventory_workplaces_department_id"), table_name="inventory_workplaces")
    op.drop_index(op.f("ix_inventory_workplaces_purpose_id"), table_name="inventory_workplaces")
    op.drop_constraint(
        op.f("fk_inventory_workplaces_department_id_inventory_departments"),
        "inventory_workplaces",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_inventory_workplaces_purpose_id_inventory_workplace_purposes"),
        "inventory_workplaces",
        type_="foreignkey",
    )
    op.drop_column("inventory_workplaces", "department_id")
    op.drop_column("inventory_workplaces", "purpose_id")
    op.drop_column("inventory_workplaces", "pool")
    op.drop_table("inventory_workplace_purposes")
