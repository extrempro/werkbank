"""Tickets: Kategorien, Fristen, Geräte, Textbausteine, Erinnerung, Zusammenführen

Revision ID: 0066
Revises: 0065
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0066"
down_revision: str | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:

    op.create_table(
        "ticket_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column(
            "default_priority", sa.String(length=10), server_default="medium", nullable=False
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint(
            "default_priority IN ('low', 'medium', 'high')",
            name=op.f("ck_ticket_categories_ck_ticket_category_priority"),
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_categories_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_categories")),
        sa.UniqueConstraint("area_id", "name", name="uq_ticket_category"),
    )
    op.create_index(
        op.f("ix_ticket_categories_area_id"), "ticket_categories", ["area_id"], unique=False
    )
    op.create_table(
        "ticket_sla",
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("priority", sa.String(length=10), nullable=False),
        sa.Column("response_minutes", sa.Integer(), nullable=False),
        sa.Column("solution_minutes", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_sla_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("area_id", "priority", name=op.f("pk_ticket_sla")),
    )
    op.create_table(
        "ticket_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("shortcut", sa.String(length=30), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("status_after", sa.String(length=10), server_default="", nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('reply', 'note')", name=op.f("ck_ticket_templates_ck_ticket_template_kind")
        ),
        sa.CheckConstraint(
            "status_after IN ('', 'waiting', 'solved')",
            name=op.f("ck_ticket_templates_ck_ticket_template_status"),
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_templates_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_templates")),
        sa.UniqueConstraint("area_id", "shortcut", name="uq_ticket_template_shortcut"),
    )
    op.create_index(
        op.f("ix_ticket_templates_area_id"), "ticket_templates", ["area_id"], unique=False
    )
    op.add_column(
        "ticket_areas",
        sa.Column("sla_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "work_days",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[0, 1, 2, 3, 4]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("work_start", sa.Integer(), server_default=sa.text("480"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("work_end", sa.Integer(), server_default=sa.text("1020"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("devices_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "device_kinds",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("device_suggest", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "device_in_inventory", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.add_column("ticket_entries", sa.Column("from_number", sa.BigInteger(), nullable=True))
    op.add_column("tickets", sa.Column("category_id", sa.Integer(), nullable=True))
    op.add_column("tickets", sa.Column("hardware_id", sa.Integer(), nullable=True))
    op.add_column("tickets", sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "tickets",
        sa.Column("reminder_note", sa.String(length=120), server_default="", nullable=False),
    )
    op.add_column(
        "tickets", sa.Column("reminder_fired_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("tickets", sa.Column("merged_into_id", sa.Uuid(), nullable=True))
    op.add_column("tickets", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tickets", sa.Column("assigned_by_oid", sa.String(length=64), nullable=True))
    op.add_column(
        "tickets",
        sa.Column("assign_notify", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "tickets", sa.Column("sla_response_due", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "tickets", sa.Column("sla_solution_due", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "tickets",
        sa.Column("sla_paused_minutes", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "tickets", sa.Column("sla_paused_since", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("tickets", sa.Column("sla_response_met", sa.Boolean(), nullable=True))
    op.add_column("tickets", sa.Column("sla_solution_met", sa.Boolean(), nullable=True))
    op.create_index(op.f("ix_tickets_category_id"), "tickets", ["category_id"], unique=False)
    op.create_index(op.f("ix_tickets_hardware_id"), "tickets", ["hardware_id"], unique=False)
    op.create_index(op.f("ix_tickets_reminder_at"), "tickets", ["reminder_at"], unique=False)
    op.create_index(
        op.f("ix_tickets_sla_solution_due"), "tickets", ["sla_solution_due"], unique=False
    )
    op.create_foreign_key(
        op.f("fk_tickets_category_id_ticket_categories"),
        "tickets",
        "ticket_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_tickets_hardware_id_inventory_hardware"),
        "tickets",
        "inventory_hardware",
        ["hardware_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_tickets_merged_into_id_tickets"),
        "tickets",
        "tickets",
        ["merged_into_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:

    op.drop_constraint(op.f("fk_tickets_merged_into_id_tickets"), "tickets", type_="foreignkey")
    op.drop_constraint(
        op.f("fk_tickets_hardware_id_inventory_hardware"), "tickets", type_="foreignkey"
    )
    op.drop_constraint(
        op.f("fk_tickets_category_id_ticket_categories"), "tickets", type_="foreignkey"
    )
    op.drop_index(op.f("ix_tickets_sla_solution_due"), table_name="tickets")
    op.drop_index(op.f("ix_tickets_reminder_at"), table_name="tickets")
    op.drop_index(op.f("ix_tickets_hardware_id"), table_name="tickets")
    op.drop_index(op.f("ix_tickets_category_id"), table_name="tickets")
    op.drop_column("tickets", "sla_solution_met")
    op.drop_column("tickets", "sla_response_met")
    op.drop_column("tickets", "sla_paused_since")
    op.drop_column("tickets", "sla_paused_minutes")
    op.drop_column("tickets", "sla_solution_due")
    op.drop_column("tickets", "sla_response_due")
    op.drop_column("tickets", "assign_notify")
    op.drop_column("tickets", "assigned_by_oid")
    op.drop_column("tickets", "assigned_at")
    op.drop_column("tickets", "merged_into_id")
    op.drop_column("tickets", "reminder_fired_at")
    op.drop_column("tickets", "reminder_note")
    op.drop_column("tickets", "reminder_at")
    op.drop_column("tickets", "hardware_id")
    op.drop_column("tickets", "category_id")
    op.drop_column("ticket_entries", "from_number")
    op.drop_column("ticket_areas", "device_in_inventory")
    op.drop_column("ticket_areas", "device_suggest")
    op.drop_column("ticket_areas", "device_kinds")
    op.drop_column("ticket_areas", "devices_enabled")
    op.drop_column("ticket_areas", "work_end")
    op.drop_column("ticket_areas", "work_start")
    op.drop_column("ticket_areas", "work_days")
    op.drop_column("ticket_areas", "sla_enabled")
    op.drop_index(op.f("ix_ticket_templates_area_id"), table_name="ticket_templates")
    op.drop_table("ticket_templates")
    op.drop_table("ticket_sla")
    op.drop_index(op.f("ix_ticket_categories_area_id"), table_name="ticket_categories")
    op.drop_table("ticket_categories")
