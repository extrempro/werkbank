"""IT-Monitoring, NetBird: erkannte Änderungen an Gruppen und Policies

Revision ID: 0105
Revises: 0104
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0105"
down_revision: str | None = "0104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_nb_changes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("object_id", sa.String(64), nullable=False),
        sa.Column("object_name", sa.String(255), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("summary", sa.String(300), nullable=False),
        sa.Column("fields", postgresql.JSONB, nullable=False),
        sa.Column("initiator", sa.String(300), nullable=False),
        sa.Column("initiator_kind", sa.String(10), nullable=False),
        sa.Column("via", sa.String(200), nullable=False),
        sa.Column("flag", sa.String(20), nullable=False, server_default=""),
        sa.Column("flag_text", sa.String(300), nullable=False, server_default=""),
        sa.Column("critical", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("reported", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("notified", sa.String(200), nullable=False, server_default=""),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("confirmed_by", sa.Uuid),
        sa.Column("confirmed_by_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("comment", sa.String(500), nullable=False, server_default=""),
    )
    op.create_index("ix_mon_nb_changes_detected_at", "mon_nb_changes", ["detected_at"])
    op.create_index("ix_mon_nb_changes_object_id", "mon_nb_changes", ["object_id"])
    op.create_index("ix_mon_nb_changes_status", "mon_nb_changes", ["status"])


def downgrade() -> None:
    op.drop_index("ix_mon_nb_changes_status", table_name="mon_nb_changes")
    op.drop_index("ix_mon_nb_changes_object_id", table_name="mon_nb_changes")
    op.drop_index("ix_mon_nb_changes_detected_at", table_name="mon_nb_changes")
    op.drop_table("mon_nb_changes")
