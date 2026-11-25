"""Datensicherung: Läufe der Sicherung

Revision ID: 0086
Revises: 0085
Erstellt: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0086"
down_revision: str | None = "0085"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "backup_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("started_by", sa.String(200)),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger()),
        sa.Column("error", sa.Text()),
    )
    op.create_index("ix_backup_runs_started_at", "backup_runs", ["started_at"])


def downgrade() -> None:
    op.drop_index("ix_backup_runs_started_at", table_name="backup_runs")
    op.drop_table("backup_runs")
