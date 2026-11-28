"""IT-Monitoring, FortiGate: „geändert von“ aus dem FortiAnalyzer je Konfigurationsstand

Revision ID: 0100
Revises: 0099
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0100"
down_revision: str | None = "0099"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("mon_fg_snapshots", sa.Column("analyzer", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("mon_fg_snapshots", "analyzer")
