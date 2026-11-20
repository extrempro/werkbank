"""IT-Bestand: Hardware, Stammdaten, Ausmusterung und Verlauf

Revision ID: 0041
Revises: 0040
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Vorschläge zum Start; in den Stammdaten änderbar
KINDS = [
    ("Notebook", True),
    ("PC", True),
    ("Tablet", True),
    ("Monitor", False),
    ("Dockingstation", False),
    ("Headset", False),
    ("Beamer", False),
    ("Drucker", False),
]
REASONS = ["defekt", "veraltet", "verloren oder gestohlen", "Garantietausch"]


def upgrade() -> None:
    kinds = op.create_table(
        "inventory_kinds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True),
        sa.Column("has_storage", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_table(
        "inventory_makers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True),
    )
    op.create_table(
        "inventory_models",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "maker_id",
            sa.Integer(),
            sa.ForeignKey("inventory_makers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.UniqueConstraint("maker_id", "name", name="uq_inventory_models_maker_name"),
    )
    op.create_index("ix_inventory_models_maker_id", "inventory_models", ["maker_id"])
    reasons = op.create_table(
        "inventory_retire_reasons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True),
    )
    op.create_table(
        "inventory_hardware",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kind_id",
            sa.Integer(),
            sa.ForeignKey("inventory_kinds.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "model_id",
            sa.Integer(),
            sa.ForeignKey("inventory_models.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("serial", sa.String(length=80), server_default="", nullable=False),
        sa.Column("inventory_no", sa.String(length=40), nullable=True),
        sa.Column("hostname", sa.String(length=80), server_default="", nullable=False),
        sa.Column("source", sa.String(length=16), server_default="manuell", nullable=False),
        sa.Column("note", sa.String(length=500), server_default="", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="aktiv", nullable=False),
        sa.Column("retired_on", sa.Date(), nullable=True),
        sa.Column(
            "retire_reason_id",
            sa.Integer(),
            sa.ForeignKey("inventory_retire_reasons.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("retire_whereabouts", sa.String(length=16), nullable=True),
        sa.Column("retire_wiped", sa.Boolean(), nullable=True),
        sa.Column("retire_note", sa.String(length=300), server_default="", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_inventory_hardware_kind_id", "inventory_hardware", ["kind_id"])
    op.create_index("ix_inventory_hardware_model_id", "inventory_hardware", ["model_id"])
    op.create_index("ix_inventory_hardware_status", "inventory_hardware", ["status"])
    op.create_index(
        "uq_inventory_hardware_inventory_no",
        "inventory_hardware",
        ["inventory_no"],
        unique=True,
        postgresql_where=sa.text("inventory_no IS NOT NULL"),
    )
    op.create_table(
        "inventory_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("text", sa.String(length=400), nullable=False),
    )
    op.create_index("ix_inventory_events_hardware_id", "inventory_events", ["hardware_id"])

    op.bulk_insert(kinds, [{"name": name, "has_storage": storage} for name, storage in KINDS])
    op.bulk_insert(reasons, [{"name": name} for name in REASONS])


def downgrade() -> None:
    op.drop_index("ix_inventory_events_hardware_id", table_name="inventory_events")
    op.drop_table("inventory_events")
    op.drop_index("uq_inventory_hardware_inventory_no", table_name="inventory_hardware")
    op.drop_index("ix_inventory_hardware_status", table_name="inventory_hardware")
    op.drop_index("ix_inventory_hardware_model_id", table_name="inventory_hardware")
    op.drop_index("ix_inventory_hardware_kind_id", table_name="inventory_hardware")
    op.drop_table("inventory_hardware")
    op.drop_table("inventory_retire_reasons")
    op.drop_index("ix_inventory_models_maker_id", table_name="inventory_models")
    op.drop_table("inventory_models")
    op.drop_table("inventory_makers")
    op.drop_table("inventory_kinds")
