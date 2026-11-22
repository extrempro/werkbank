"""Tickets: Grundgerüst (Bereiche, Rollen je Bereich, Tickets, Verlauf, Protokoll)

Revision ID: 0064
Revises: 0063
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0064"
down_revision: str | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:

    op.create_table(
        "ticket_areas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("mailbox", sa.String(length=320), server_default="", nullable=False),
        sa.Column("assignment", sa.String(length=20), server_default="first", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "assignment IN ('first', 'round_robin')",
            name=op.f("ck_ticket_areas_ck_ticket_area_assignment"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_areas")),
        sa.UniqueConstraint("name", name=op.f("uq_ticket_areas_name")),
    )
    op.create_table(
        "ticket_audit",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("actor_oid", sa.String(length=64), nullable=True),
        sa.Column("actor_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("ticket_number", sa.BigInteger(), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_audit")),
    )
    op.create_index(op.f("ix_ticket_audit_area_id"), "ticket_audit", ["area_id"], unique=False)
    op.create_index(
        op.f("ix_ticket_audit_occurred_at"), "ticket_audit", ["occurred_at"], unique=False
    )
    op.create_table(
        "ticket_group_members",
        sa.Column("group_oid", sa.String(length=64), nullable=False),
        sa.Column("oid", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("mail", sa.String(length=320), server_default="", nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("group_oid", "oid", name=op.f("pk_ticket_group_members")),
    )
    op.create_table(
        "ticket_membership_cache",
        sa.Column("oid", sa.String(length=64), nullable=False),
        sa.Column("group_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("oid", name=op.f("pk_ticket_membership_cache")),
    )
    op.create_table(
        "ticket_area_grants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("oid", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("mail", sa.String(length=320), server_default="", nullable=False),
        sa.CheckConstraint(
            "kind IN ('group', 'person')", name=op.f("ck_ticket_area_grants_ck_ticket_grant_kind")
        ),
        sa.CheckConstraint(
            "role IN ('admin', 'edit', 'read')",
            name=op.f("ck_ticket_area_grants_ck_ticket_grant_role"),
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_area_grants_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_area_grants")),
        sa.UniqueConstraint("area_id", "role", "kind", "oid", name="uq_ticket_grant"),
    )
    op.create_table(
        "tickets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.BigInteger(), sa.Identity(always=False, start=1000), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(length=250), nullable=False),
        sa.Column("reporter_name", sa.String(length=200), server_default="", nullable=False),
        sa.Column("reporter_mail", sa.String(length=320), server_default="", nullable=False),
        sa.Column("priority", sa.String(length=10), server_default="medium", nullable=False),
        sa.Column("status", sa.String(length=20), server_default="new", nullable=False),
        sa.Column("assignee_oid", sa.String(length=64), nullable=True),
        sa.Column("assignee_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("channel", sa.String(length=10), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("solved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=256), server_default="", nullable=False),
        sa.CheckConstraint(
            "channel IN ('mail', 'manual', 'phone')", name=op.f("ck_tickets_ck_ticket_channel")
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'medium', 'high')", name=op.f("ck_tickets_ck_ticket_priority")
        ),
        sa.CheckConstraint(
            "status IN ('new', 'in_progress', 'waiting', 'reminder', 'solved', 'closed', 'merged')",
            name=op.f("ck_tickets_ck_ticket_status"),
        ),
        sa.ForeignKeyConstraint(
            ["area_id"], ["ticket_areas.id"], name=op.f("fk_tickets_area_id_ticket_areas")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tickets")),
        sa.UniqueConstraint("number", name=op.f("uq_tickets_number")),
    )
    op.create_index(op.f("ix_tickets_area_id"), "tickets", ["area_id"], unique=False)
    op.create_index("ix_tickets_area_status", "tickets", ["area_id", "status"], unique=False)
    op.create_index(op.f("ix_tickets_assignee_oid"), "tickets", ["assignee_oid"], unique=False)
    op.create_table(
        "ticket_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("body", sa.Text(), server_default="", nullable=False),
        sa.Column("author_oid", sa.String(length=64), nullable=True),
        sa.Column("author_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("original", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('inbound', 'reply', 'note', 'system')",
            name=op.f("ck_ticket_entries_ck_ticket_entry_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["tickets.id"],
            name=op.f("fk_ticket_entries_ticket_id_tickets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_entries")),
    )
    op.create_index(
        op.f("ix_ticket_entries_ticket_id"), "ticket_entries", ["ticket_id"], unique=False
    )
    op.create_table(
        "ticket_participants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), server_default="", nullable=False),
        sa.Column("mail", sa.String(length=320), nullable=False),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["tickets.id"],
            name=op.f("fk_ticket_participants_ticket_id_tickets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_participants")),
        sa.UniqueConstraint("ticket_id", "mail", name="uq_ticket_participant"),
    )


def downgrade() -> None:

    op.drop_table("ticket_participants")
    op.drop_index(op.f("ix_ticket_entries_ticket_id"), table_name="ticket_entries")
    op.drop_table("ticket_entries")
    op.drop_index(op.f("ix_tickets_assignee_oid"), table_name="tickets")
    op.drop_index("ix_tickets_area_status", table_name="tickets")
    op.drop_index(op.f("ix_tickets_area_id"), table_name="tickets")
    op.drop_table("tickets")
    op.drop_table("ticket_area_grants")
    op.drop_table("ticket_membership_cache")
    op.drop_table("ticket_group_members")
    op.drop_index(op.f("ix_ticket_audit_occurred_at"), table_name="ticket_audit")
    op.drop_index(op.f("ix_ticket_audit_area_id"), table_name="ticket_audit")
    op.drop_table("ticket_audit")
    op.drop_table("ticket_areas")
