"""Tickets: Geräte ohne Schalter je Bereich (Sichtbarkeit nur über Rechte im IT-Bestand)

Revision ID: 0068
Revises: 0067
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0068"
down_revision: str | None = "0067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("ticket_areas", "device_in_inventory")
    op.drop_column("ticket_areas", "device_suggest")
    op.drop_column("ticket_areas", "device_kinds")
    op.drop_column("ticket_areas", "devices_enabled")


def downgrade() -> None:
    op.add_column(
        "ticket_areas",
        sa.Column("devices_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "device_kinds",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("device_suggest", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "device_in_inventory", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
