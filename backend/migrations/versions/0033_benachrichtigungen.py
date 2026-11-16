"""Kern: Benachrichtigungen (Glocke)

Revision ID: 0033
Revises: 0032
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("link", sa.String(length=300), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notifications_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
    )
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"])
    op.create_index(op.f("ix_notifications_created_at"), "notifications", ["created_at"])
    op.create_table(
        "notification_marks",
        sa.Column("key", sa.String(length=200), nullable=False),
        sa.Column(
            "seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_notification_marks")),
    )
    op.create_index(op.f("ix_notification_marks_seen_at"), "notification_marks", ["seen_at"])
    op.create_table(
        "notification_kinds",
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("kind", name=op.f("pk_notification_kinds")),
    )
    op.create_table(
        "notification_mutes",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notification_mutes_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "kind", name=op.f("pk_notification_mutes")),
    )


def downgrade() -> None:
    op.drop_table("notification_mutes")
    op.drop_table("notification_kinds")
    op.drop_table("notification_marks")
    op.drop_table("notifications")
