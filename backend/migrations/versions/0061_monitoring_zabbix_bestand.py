"""IT-Monitoring, Zabbix: bewusst nicht überwachte Geräte und Zuordnung von Hand

Revision ID: 0061
Revises: 0060
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: str | None = "0060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "mon_zbx_unmonitored",
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("reason", sa.String(200), nullable=False),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "mon_zbx_host_links",
        sa.Column("hostid", sa.String(20), primary_key=True),
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mon_zbx_host_links_hardware_id", "mon_zbx_host_links", ["hardware_id"])


def downgrade() -> None:
    op.drop_index("ix_mon_zbx_host_links_hardware_id", table_name="mon_zbx_host_links")
    op.drop_table("mon_zbx_host_links")
    op.drop_table("mon_zbx_unmonitored")
