"""Evergreen: Kennzeichen, Abschnitte, Steckbrief, Rollout-Phasen und Bewertung

Revision ID: 0057
Revises: 0056
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0057"
down_revision: str | None = "0056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_LISTS = ("tags", "sections", "phases", "phases_previous", "suggested")


def upgrade() -> None:
    for name in JSON_LISTS:
        op.add_column(
            "ev_entries",
            sa.Column(name, JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        )
    op.add_column("ev_entries", sa.Column("schedule_previous", sa.Text(), nullable=True))
    op.add_column(
        "ev_entries",
        sa.Column("schedule_changed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("ev_entries", sa.Column("affected", sa.String(200), nullable=True))
    op.add_column("ev_entries", sa.Column("default_state", sa.String(16), nullable=True))
    op.add_column("ev_entries", sa.Column("controllable", sa.Boolean(), nullable=True))
    op.add_column("ev_entries", sa.Column("controllable_how", sa.String(300), nullable=True))
    op.add_column("ev_entries", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("ev_entries", sa.Column("staff_change", sa.Text(), nullable=True))
    op.add_column("ev_entries", sa.Column("training", sa.Text(), nullable=True))
    op.add_column("ev_entries", sa.Column("codetermination", sa.String(16), nullable=True))
    op.add_column("ev_entries", sa.Column("codetermination_reason", sa.Text(), nullable=True))
    op.add_column(
        "ev_entries",
        sa.Column(
            "setting_id",
            sa.Integer(),
            sa.ForeignKey("cfg_settings.id", ondelete="SET NULL", name="fk_ev_entries_setting_id"),
            nullable=True,
        ),
    )
    op.add_column("ev_notes", sa.Column("details", JSONB(), nullable=True))
    # Abschnitte und Vorschläge für bestehende Meldungen ergänzt der nächste Abruf
    # des Nachrichtencenters (message_center.backfill), nicht die Migration.


def downgrade() -> None:
    op.drop_column("ev_notes", "details")
    op.drop_constraint("fk_ev_entries_setting_id", "ev_entries", type_="foreignkey")
    for name in (
        "setting_id",
        "codetermination_reason",
        "codetermination",
        "training",
        "staff_change",
        "summary",
        "controllable_how",
        "controllable",
        "default_state",
        "affected",
        "schedule_changed_at",
        "schedule_previous",
        *JSON_LISTS,
    ):
        op.drop_column("ev_entries", name)
