"""Zabbix: offene Probleme je Stunde für den Verlauf der Übersicht

Revision ID: 0071
Revises: 0070
Erstellt: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0071"
down_revision: str | None = "0070"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_zbx_problem_hours",
        sa.Column("hour", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", sa.Integer(), nullable=False),
        sa.Column("high", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("hour", name=op.f("pk_mon_zbx_problem_hours")),
    )


def downgrade() -> None:
    op.drop_table("mon_zbx_problem_hours")
