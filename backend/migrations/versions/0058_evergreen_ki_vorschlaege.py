"""Evergreen: Vorschläge für Rollout-Phasen und Steckbrief per KI

Revision ID: 0058
Revises: 0057
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0058"
down_revision: str | None = "0057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ev_entries",
        sa.Column("ai_suggested", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "ev_entries",
        sa.Column("ai_pending", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("ev_entries", sa.Column("ai_at", sa.DateTime(timezone=True), nullable=True))
    # Offene Meldungen bekommen einmalig einen Vorschlag, sobald die KI eingeschaltet ist
    op.execute(
        "UPDATE ev_entries SET ai_pending = true "
        "WHERE source = 'nachrichtencenter' AND status <> 'abgeschlossen'"
    )


def downgrade() -> None:
    op.drop_column("ev_entries", "ai_at")
    op.drop_column("ev_entries", "ai_pending")
    op.drop_column("ev_entries", "ai_suggested")
