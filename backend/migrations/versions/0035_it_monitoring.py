"""IT-Monitoring: DNS-Abgleich mit NetBox

Revision ID: 0035
Revises: 0034
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_dns_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("zones", sa.Integer(), nullable=False),
        sa.Column("records", sa.Integer(), nullable=False),
        sa.Column("queries", sa.Integer(), nullable=False),
        sa.Column("counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mon_dns_runs")),
    )
    op.create_index(op.f("ix_mon_dns_runs_started_at"), "mon_dns_runs", ["started_at"])
    op.create_table(
        "mon_dns_rows",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=300), nullable=False),
        sa.Column("fqdn", sa.String(length=260), nullable=False),
        sa.Column("type", sa.String(length=12), nullable=False),
        sa.Column("zone", sa.String(length=260), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["mon_dns_runs.id"],
            name=op.f("fk_mon_dns_rows_run_id_mon_dns_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mon_dns_rows")),
    )
    op.create_index(op.f("ix_mon_dns_rows_run_id"), "mon_dns_rows", ["run_id"])


def downgrade() -> None:
    op.drop_table("mon_dns_rows")
    op.drop_table("mon_dns_runs")
