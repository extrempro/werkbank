"""IT-Monitoring, FortiGate: seit wann Objekte unbenutzt sind

Revision ID: 0098
Revises: 0097
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0098"
down_revision: str | None = "0097"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_fg_unused",
        sa.Column(
            "device_id",
            sa.Integer,
            sa.ForeignKey("mon_fg_devices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("kind", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(255), primary_key=True),
        sa.Column("since", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("mon_fg_unused")
