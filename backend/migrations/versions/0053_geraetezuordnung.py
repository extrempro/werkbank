"""Gerätezuordnung: gescannte Geräte und zweite Anmeldung mit dem Admin-Konto

Revision ID: 0053
Revises: 0052
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dev_associations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("serial_number", sa.String(length=128), nullable=False),
        sa.Column("manufacturer", sa.String(length=256), nullable=False),
        sa.Column("model", sa.String(length=256), nullable=False),
        sa.Column("link_id", sa.String(length=36), nullable=False),
        sa.Column("qr_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("device_link_enc", sa.Text(), nullable=True),
        sa.Column("link_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("policy_id", sa.String(length=64), nullable=True),
        sa.Column("policy_name", sa.String(length=256), nullable=True),
        sa.Column("graph_id", sa.String(length=64), nullable=True),
        sa.Column("association_state", sa.String(length=64), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column("scanned_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "scanned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("approved_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_admin", sa.String(length=320), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("associated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("managed_device_id", sa.String(length=64), nullable=True),
        sa.Column("device_name", sa.String(length=256), nullable=True),
        sa.Column("compliance", sa.String(length=64), nullable=True),
        sa.Column("user_principal_name", sa.String(length=320), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_dev_associations_serial_number"), "dev_associations", ["serial_number"]
    )
    op.create_index(op.f("ix_dev_associations_status"), "dev_associations", ["status"])
    op.create_index(op.f("ix_dev_associations_graph_id"), "dev_associations", ["graph_id"])
    op.create_table(
        "dev_admin_sessions",
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("user_sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("token_enc", sa.Text(), nullable=False),
        sa.Column("admin_upn", sa.String(length=320), nullable=False),
        sa.Column("admin_name", sa.String(length=256), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(op.f("ix_dev_admin_sessions_expires_at"), "dev_admin_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_table("dev_admin_sessions")
    op.drop_table("dev_associations")
