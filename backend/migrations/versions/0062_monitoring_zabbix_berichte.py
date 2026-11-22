"""IT-Monitoring, Zabbix: Daten für die Berichte (Ausfallzeiten, Auslöser, Wartungszeiten)

Revision ID: 0062
Revises: 0061
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("mon_zbx_status", sa.Column("reports_since", sa.Date(), nullable=True))
    op.create_table(
        "mon_zbx_maint_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hostid", sa.String(20), nullable=False, index=True),
        sa.Column("started_at", TS, nullable=False),
        sa.Column("ended_at", TS, nullable=False, index=True),
    )
    op.create_table(
        "mon_zbx_report_days",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("processed_at", TS, nullable=False),
    )
    op.create_table(
        "mon_zbx_downtime",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("hostid", sa.String(20), primary_key=True),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("site", sa.String(255), nullable=True),
        sa.Column("groups", JSONB(), nullable=False),
        sa.Column("monitored_s", sa.Integer(), nullable=False),
        sa.Column("maintenance_s", sa.Integer(), nullable=False),
        sa.Column("downtime_s", sa.Integer(), nullable=False),
    )
    op.create_table(
        "mon_zbx_trigger_stats",
        sa.Column("month", sa.Date(), primary_key=True),
        sa.Column("triggerid", sa.String(20), primary_key=True),
        sa.Column("hostid", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("duration_s", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "mon_zbx_outages",
        sa.Column("eventid", sa.String(20), primary_key=True),
        sa.Column("hostid", sa.String(20), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("site", sa.String(255), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("started_at", TS, nullable=False, index=True),
        sa.Column("ended_at", TS, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("mon_zbx_outages")
    op.drop_table("mon_zbx_trigger_stats")
    op.drop_table("mon_zbx_downtime")
    op.drop_table("mon_zbx_report_days")
    op.drop_table("mon_zbx_maint_log")
    op.drop_column("mon_zbx_status", "reports_since")
