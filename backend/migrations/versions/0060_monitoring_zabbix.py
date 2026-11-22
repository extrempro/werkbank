"""IT-Monitoring: Quelle Zabbix (Hosts, Probleme, Wartungen, Zuordnung, Läufe, Zustand)

Revision ID: 0060
Revises: 0059
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0060"
down_revision: str | None = "0059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "mon_zbx_hosts",
        sa.Column("hostid", sa.String(20), primary_key=True),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("monitored", sa.Boolean(), nullable=False),
        sa.Column("reachable", sa.Boolean(), nullable=True),
        sa.Column("in_maintenance", sa.Boolean(), nullable=False),
        sa.Column("maintenanceid", sa.String(20), nullable=True),
        sa.Column("interfaces", JSONB, nullable=False),
        sa.Column("groups", JSONB, nullable=False),
        sa.Column("templates", JSONB, nullable=False),
        sa.Column("serial", sa.String(80), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("kind", sa.String(80), nullable=False),
        sa.Column(
            "site_id",
            sa.Integer(),
            sa.ForeignKey("inventory_sites.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("last_seen_at", TS, nullable=True),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mon_zbx_hosts_serial", "mon_zbx_hosts", ["serial"])
    op.create_index("ix_mon_zbx_hosts_site_id", "mon_zbx_hosts", ["site_id"])
    op.create_table(
        "mon_zbx_problems",
        sa.Column("eventid", sa.String(20), primary_key=True),
        sa.Column("triggerid", sa.String(20), nullable=False),
        sa.Column("hostid", sa.String(20), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=False),
        sa.Column("since", TS, nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False),
        sa.Column("suppressed", sa.Boolean(), nullable=False),
        sa.Column("tags", JSONB, nullable=False),
    )
    op.create_index("ix_mon_zbx_problems_hostid", "mon_zbx_problems", ["hostid"])
    op.create_table(
        "mon_zbx_maintenances",
        sa.Column("maintenanceid", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("with_data", sa.Boolean(), nullable=False),
        sa.Column("active_since", TS, nullable=False),
        sa.Column("active_till", TS, nullable=False),
        sa.Column("hostids", JSONB, nullable=False),
        sa.Column("groupids", JSONB, nullable=False),
        sa.Column("once", JSONB, nullable=False),
        sa.Column("recurring", JSONB, nullable=False),
    )
    op.create_table(
        "mon_zbx_group_sites",
        sa.Column("groupid", sa.String(20), primary_key=True),
        sa.Column("group_name", sa.String(255), nullable=False),
        sa.Column(
            "site_id",
            sa.Integer(),
            sa.ForeignKey("inventory_sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index("ix_mon_zbx_group_sites_site_id", "mon_zbx_group_sites", ["site_id"])
    op.create_table(
        "mon_zbx_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task", sa.String(20), nullable=False),
        sa.Column("started_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("counts", JSONB, nullable=False),
    )
    op.create_index("ix_mon_zbx_runs_task", "mon_zbx_runs", ["task"])
    op.create_index("ix_mon_zbx_runs_started_at", "mon_zbx_runs", ["started_at"])
    op.create_table(
        "mon_zbx_status",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.String(40), nullable=True),
        sa.Column("checked_at", TS, nullable=True),
        sa.Column("account", JSONB, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("mon_zbx_status")
    op.drop_index("ix_mon_zbx_runs_started_at", table_name="mon_zbx_runs")
    op.drop_index("ix_mon_zbx_runs_task", table_name="mon_zbx_runs")
    op.drop_table("mon_zbx_runs")
    op.drop_index("ix_mon_zbx_group_sites_site_id", table_name="mon_zbx_group_sites")
    op.drop_table("mon_zbx_group_sites")
    op.drop_table("mon_zbx_maintenances")
    op.drop_index("ix_mon_zbx_problems_hostid", table_name="mon_zbx_problems")
    op.drop_table("mon_zbx_problems")
    op.drop_index("ix_mon_zbx_hosts_site_id", table_name="mon_zbx_hosts")
    op.drop_index("ix_mon_zbx_hosts_serial", table_name="mon_zbx_hosts")
    op.drop_table("mon_zbx_hosts")
