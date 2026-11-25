"""IT-Bestand: Grundriss drehen (Anzeige in 90°-Schritten)

Revision ID: 0087
Revises: 0086
Erstellt: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0087"
down_revision: str | None = "0086"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_floor_plans",
        sa.Column("rotation", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_inventory_floor_plans_rotation_quarter",
        "inventory_floor_plans",
        "rotation IN (0, 90, 180, 270)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_inventory_floor_plans_rotation_quarter", "inventory_floor_plans", type_="check"
    )
    op.drop_column("inventory_floor_plans", "rotation")
