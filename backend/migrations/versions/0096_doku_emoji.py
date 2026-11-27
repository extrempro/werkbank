"""Doku: Emoji vor Seitentiteln und Arbeitsbereichen

Revision ID: 0096
Revises: 0095
Erstellt: 2026-11-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0096"
down_revision: str | None = "0095"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("doku_spaces", "doku_pages"):
        op.add_column(table, sa.Column("icon", sa.String(32), nullable=False, server_default=""))


def downgrade() -> None:
    for table in ("doku_pages", "doku_spaces"):
        op.drop_column(table, "icon")
