"""Kern: Benachrichtigungen zusätzlich per Mail und Teams

Revision ID: 0034
Revises: 0033
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("mailed_at", sa.DateTime(timezone=True)))
    op.add_column("notifications", sa.Column("teams_at", sa.DateTime(timezone=True)))
    op.create_table(
        "notification_channels",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notification_channels_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id", "channel", "kind", name=op.f("pk_notification_channels")
        ),
    )


def downgrade() -> None:
    op.drop_table("notification_channels")
    op.drop_column("notifications", "teams_at")
    op.drop_column("notifications", "mailed_at")
