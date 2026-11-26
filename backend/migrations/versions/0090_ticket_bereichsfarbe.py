"""Tickets: Farbe je Bereich

Jeder Bereich bekommt eine Farbe aus einer festen Auswahl von acht Farben. Vorhandene
Bereiche erhalten die Farben der Reihe nach (nach Anlage), damit sie sich gleich unterscheiden.

Revision ID: 0090
Revises: 0089
Erstellt: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0090"
down_revision: str | None = "0089"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Reihenfolge wie AREA_COLORS in werkbank/modules/tickets/models.py
COLORS = ("blau", "petrol", "violett", "orange", "gruen", "rot", "pink", "grau")


def upgrade() -> None:
    op.add_column(
        "ticket_areas",
        sa.Column("color", sa.String(12), nullable=False, server_default="blau"),
    )
    op.get_bind().execute(
        sa.text(
            """
            UPDATE ticket_areas AS a
            SET color = (CAST(:palette AS text[]))[((r.n - 1) % :count) + 1]
            FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM ticket_areas) AS r
            WHERE a.id = r.id
            """
        ),
        {"palette": list(COLORS), "count": len(COLORS)},
    )


def downgrade() -> None:
    op.drop_column("ticket_areas", "color")
