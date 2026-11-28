"""IT-Monitoring, NetBird: HTTPS-Abrufe der Dienste am Reverse Proxy

Revision ID: 0102
Revises: 0101
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0102"
down_revision: str | None = "0101"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_nb_checks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("service_id", sa.String(64), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ok", sa.Boolean, nullable=False),
        sa.Column("status_code", sa.SmallInteger),
        sa.Column("ms", sa.Integer),
    )
    op.create_index("ix_mon_nb_checks_service_id", "mon_nb_checks", ["service_id"])
    op.create_index("ix_mon_nb_checks_checked_at", "mon_nb_checks", ["checked_at"])


def downgrade() -> None:
    op.drop_index("ix_mon_nb_checks_checked_at", table_name="mon_nb_checks")
    op.drop_index("ix_mon_nb_checks_service_id", table_name="mon_nb_checks")
    op.drop_table("mon_nb_checks")
