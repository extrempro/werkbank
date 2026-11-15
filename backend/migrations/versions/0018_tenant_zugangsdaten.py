"""Tenant: Zertifikate und Secrets der Anwendungen

Revision ID: 0018
Revises: 0017
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tenant_credentials",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_kind", sa.String(length=8), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("app_id", sa.String(length=64), nullable=True),
        sa.Column("owner_name", sa.String(length=256), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("key_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tenant_credentials")),
        sa.UniqueConstraint(
            "owner_kind",
            "owner_id",
            "kind",
            "key_id",
            name=op.f("uq_tenant_credentials_owner_kind"),
        ),
    )
    op.create_index(
        op.f("ix_tenant_credentials_expires_at"), "tenant_credentials", ["expires_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tenant_credentials_expires_at"), table_name="tenant_credentials")
    op.drop_table("tenant_credentials")
