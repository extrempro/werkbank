"""Tickets: Erfolge (freiwillig, je Person)

Einstellungen je Person (aus, Sichtbarkeit, Einblendung, Stil, Vitrine, gesehene Stufen) und
gezählte Ereignisse, je Anlass einmal. Textbausteine merken sich, wer sie angelegt hat.

Revision ID: 0091
Revises: 0090
Erstellt: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0091"
down_revision: str | None = "0090"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ticket_templates", sa.Column("created_by_oid", sa.String(64), nullable=True))
    op.create_table(
        "ticket_achievement_profiles",
        sa.Column("oid", sa.String(64), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("audience", sa.String(10), nullable=False, server_default="me"),
        sa.Column("toast", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("style", sa.String(12), nullable=False, server_default="wappen"),
        sa.Column("showcase", JSONB(), nullable=False, server_default="[]"),
        sa.Column("seen", JSONB(), nullable=False, server_default="{}"),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("audience IN ('me', 'areas')", name="ck_ticket_achievement_audience"),
    )
    op.create_table(
        "ticket_achievement_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("oid", sa.String(64), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("ref", sa.String(80), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("oid", "category", "ref", name="uq_ticket_achievement_event"),
    )
    op.create_index(
        "ix_ticket_achievement_events_oid", "ticket_achievement_events", ["oid"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_ticket_achievement_events_oid", table_name="ticket_achievement_events")
    op.drop_table("ticket_achievement_events")
    op.drop_table("ticket_achievement_profiles")
    op.drop_column("ticket_templates", "created_by_oid")
