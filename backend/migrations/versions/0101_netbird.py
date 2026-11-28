"""IT-Monitoring, NetBird: jüngster Stand, Abrufe, Tageswerte

Revision ID: 0101
Revises: 0100
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0101"
down_revision: str | None = "0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_nb_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", JSONB, nullable=False),
    )
    op.create_table(
        "mon_nb_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean, nullable=False),
        sa.Column("error", sa.String(500)),
    )
    op.create_index("ix_mon_nb_runs_started_at", "mon_nb_runs", ["started_at"])
    op.create_table(
        "mon_nb_daily",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("max_connected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_table(
        "mon_nb_peer_days",
        sa.Column("peer_id", sa.String(64), primary_key=True),
        sa.Column("day", sa.Date, primary_key=True),
    )
    op.create_index("ix_mon_nb_peer_days_day", "mon_nb_peer_days", ["day"])


def downgrade() -> None:
    op.drop_index("ix_mon_nb_peer_days_day", table_name="mon_nb_peer_days")
    op.drop_table("mon_nb_peer_days")
    op.drop_table("mon_nb_daily")
    op.drop_index("ix_mon_nb_runs_started_at", table_name="mon_nb_runs")
    op.drop_table("mon_nb_runs")
    op.drop_table("mon_nb_state")
