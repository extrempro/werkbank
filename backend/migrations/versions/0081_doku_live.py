"""Dokumentation (Phase D2): Stand des gemeinsamen Dokuments für die Live-Bearbeitung

Revision ID: 0081
Revises: 0080
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0081"
down_revision: str | None = "0080"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("doku_pages", sa.Column("ystate", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("doku_pages", "ystate")
