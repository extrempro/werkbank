"""IT-Bestand: Monitore aus dem Custom Field in NinjaOne

Revision ID: 0045
Revises: 0044
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_hardware",
        sa.Column(
            "connected_to_id",
            sa.Integer(),
            sa.ForeignKey(
                "inventory_hardware.id",
                ondelete="SET NULL",
                name="fk_inventory_hardware_connected_to_id_inventory_hardware",
            ),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_inventory_hardware_connected_to_id", "inventory_hardware", ["connected_to_id"]
    )
    op.create_table(
        "inventory_monitor_ignored",
        sa.Column("serial", sa.String(length=80), primary_key=True),
        sa.Column("model", sa.String(length=120), nullable=False, server_default=""),
        sa.Column(
            "ignored_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "ignored_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("inventory_monitor_ignored")
    op.drop_index("ix_inventory_hardware_connected_to_id", table_name="inventory_hardware")
    op.drop_column("inventory_hardware", "connected_to_id")
