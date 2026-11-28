"""IT-Monitoring, NetBird: Abweisungen durch CrowdSec je Dienst und Stunde

Revision ID: 0104
Revises: 0103
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0104"
down_revision: str | None = "0103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_nb_blocks",
        sa.Column("service_id", sa.String(64), primary_key=True),
        sa.Column("hour", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("observe", sa.Boolean, primary_key=True),
        sa.Column("count", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_mon_nb_blocks_hour", "mon_nb_blocks", ["hour"])


def downgrade() -> None:
    op.drop_index("ix_mon_nb_blocks_hour", table_name="mon_nb_blocks")
    op.drop_table("mon_nb_blocks")
