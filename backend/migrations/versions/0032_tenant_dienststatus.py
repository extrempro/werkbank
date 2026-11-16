"""Tenant: Dienststatus von Microsoft 365 (Zustand je Dienst, Störungen und Hinweise)

Revision ID: 0032
Revises: 0031
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tenant_service_health",
        sa.Column("service_id", sa.String(length=64), nullable=False),
        sa.Column("service_name", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=48), nullable=False),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("service_id", name=op.f("pk_tenant_service_health")),
    )
    op.create_table(
        "tenant_service_issues",
        sa.Column("issue_id", sa.String(length=32), nullable=False),
        sa.Column("service_id", sa.String(length=64), nullable=False),
        sa.Column("service_name", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("classification", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=48), nullable=False),
        sa.Column("feature_group", sa.String(length=128), nullable=True),
        sa.Column("feature", sa.String(length=128), nullable=True),
        sa.Column("impact", sa.String(length=2000), nullable=True),
        sa.Column("resolved", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "posts",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("issue_id", name=op.f("pk_tenant_service_issues")),
    )
    op.create_index(
        op.f("ix_tenant_service_issues_service_id"), "tenant_service_issues", ["service_id"]
    )
    op.create_index(
        op.f("ix_tenant_service_issues_start_at"), "tenant_service_issues", ["start_at"]
    )


def downgrade() -> None:
    op.drop_table("tenant_service_issues")
    op.drop_table("tenant_service_health")
