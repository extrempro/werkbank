"""Tickets: Aufbewahrung (Vorgabe, Abweichung je Bereich, Ausnahmen, Läufe)

Revision ID: 0067
Revises: 0066
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0067"
down_revision: str | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ticket_retention",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("months", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("action", sa.String(length=10), server_default="anonymize", nullable=False),
        sa.CheckConstraint(
            "action IN ('anonymize', 'delete')",
            name=op.f("ck_ticket_retention_ck_ticket_retention_action"),
        ),
        sa.CheckConstraint(
            "months >= 0 AND months <= 1200",
            name=op.f("ck_ticket_retention_ck_ticket_retention_months"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_retention")),
    )
    op.create_table(
        "ticket_retention_runs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("anonymized", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("deleted", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("holds_expired", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("areas", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error", sa.String(length=500), server_default="", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_retention_runs")),
    )
    op.create_index(
        op.f("ix_ticket_retention_runs_started_at"),
        "ticket_retention_runs",
        ["started_at"],
        unique=False,
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "retention_custom", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("retention_months", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "retention_action", sa.String(length=10), server_default="anonymize", nullable=False
        ),
    )
    op.create_check_constraint(
        op.f("ck_ticket_areas_ck_ticket_area_retention_action"),
        "ticket_areas",
        "retention_action IN ('anonymize', 'delete')",
    )
    op.create_check_constraint(
        op.f("ck_ticket_areas_ck_ticket_area_retention_months"),
        "ticket_areas",
        "retention_months >= 0 AND retention_months <= 1200",
    )
    op.add_column("tickets", sa.Column("hold_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "tickets",
        sa.Column("hold_reason", sa.String(length=500), server_default="", nullable=False),
    )
    op.add_column(
        "tickets",
        sa.Column("hold_by_name", sa.String(length=256), server_default="", nullable=False),
    )
    op.add_column("tickets", sa.Column("anonymized_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_tickets_hold_until"), "tickets", ["hold_until"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tickets_hold_until"), table_name="tickets")
    op.drop_column("tickets", "anonymized_at")
    op.drop_column("tickets", "hold_by_name")
    op.drop_column("tickets", "hold_reason")
    op.drop_column("tickets", "hold_until")
    op.drop_constraint(
        op.f("ck_ticket_areas_ck_ticket_area_retention_months"), "ticket_areas", type_="check"
    )
    op.drop_constraint(
        op.f("ck_ticket_areas_ck_ticket_area_retention_action"), "ticket_areas", type_="check"
    )
    op.drop_column("ticket_areas", "retention_action")
    op.drop_column("ticket_areas", "retention_months")
    op.drop_column("ticket_areas", "retention_custom")
    op.drop_index(op.f("ix_ticket_retention_runs_started_at"), table_name="ticket_retention_runs")
    op.drop_table("ticket_retention_runs")
    op.drop_table("ticket_retention")
