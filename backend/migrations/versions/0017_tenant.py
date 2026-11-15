"""Tenant: Lizenzen und Benutzerzahlen mit Verlauf

Revision ID: 0017
Revises: 0016
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tenant_licenses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sku_id", sa.String(length=64), nullable=False),
        sa.Column("part_number", sa.String(length=128), nullable=False),
        sa.Column("applies_to", sa.String(length=32), nullable=True),
        sa.Column("capability_status", sa.String(length=32), nullable=True),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("warning", sa.Integer(), nullable=False),
        sa.Column("suspended", sa.Integer(), nullable=False),
        sa.Column("locked_out", sa.Integer(), nullable=False),
        sa.Column("consumed", sa.Integer(), nullable=False),
        sa.Column("next_lifecycle", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tenant_licenses")),
        sa.UniqueConstraint("sku_id", name=op.f("uq_tenant_licenses_sku_id")),
    )
    op.create_table(
        "tenant_license_samples",
        sa.Column("license_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("consumed", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["license_id"],
            ["tenant_licenses.id"],
            name=op.f("fk_tenant_license_samples_license_id_tenant_licenses"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("license_id", "day", name=op.f("pk_tenant_license_samples")),
    )
    op.create_table(
        "tenant_user_samples",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("guests", sa.Integer(), nullable=False),
        sa.Column("disabled", sa.Integer(), nullable=False),
        sa.Column("guests_disabled", sa.Integer(), nullable=False),
        sa.Column("licensed", sa.Integer(), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("day", name=op.f("pk_tenant_user_samples")),
    )


def downgrade() -> None:
    op.drop_table("tenant_user_samples")
    op.drop_table("tenant_license_samples")
    op.drop_table("tenant_licenses")
