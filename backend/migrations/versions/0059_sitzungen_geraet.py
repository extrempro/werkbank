"""Sitzungen: Kurzbeschreibung des Geräts für „Angemeldete Geräte“ im Konto

Revision ID: 0059
Revises: 0058
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0059"
down_revision: str | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Bestehende Sitzungen kennen ihr Gerät nicht; sie erscheinen als „Unbekanntes Gerät“.
    op.add_column(
        "user_sessions",
        sa.Column("device", sa.String(80), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("user_sessions", "device")
