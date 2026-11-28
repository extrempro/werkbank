"""IT-Monitoring, NetBird: Ereignisprotokoll, beobachtete Richtlinien, offene Hinweise

Revision ID: 0103
Revises: 0102
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0103"
down_revision: str | None = "0102"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_nb_events",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code", sa.String(80), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("activity", sa.String(255), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("initiator", sa.String(255), nullable=False),
        sa.Column("initiator_id", sa.String(255), nullable=False),
        sa.Column("meta", postgresql.JSONB, nullable=False),
    )
    op.create_index("ix_mon_nb_events_at", "mon_nb_events", ["at"])
    op.create_index("ix_mon_nb_events_category", "mon_nb_events", ["category"])
    op.create_index("ix_mon_nb_events_target_id", "mon_nb_events", ["target_id"])
    op.create_table(
        "mon_nb_policies_seen",
        sa.Column("policy_id", sa.String(64), primary_key=True),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True)),
        sa.Column("disabled_since", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "mon_nb_hints",
        sa.Column("key", sa.String(300), primary_key=True),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("link", sa.String(300), nullable=False),
        sa.Column("since", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("mon_nb_hints")
    op.drop_table("mon_nb_policies_seen")
    op.drop_index("ix_mon_nb_events_target_id", table_name="mon_nb_events")
    op.drop_index("ix_mon_nb_events_category", table_name="mon_nb_events")
    op.drop_index("ix_mon_nb_events_at", table_name="mon_nb_events")
    op.drop_table("mon_nb_events")
