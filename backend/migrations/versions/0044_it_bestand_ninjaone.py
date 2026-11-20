"""IT-Bestand: Abgleich mit NinjaOne, Vorgänge, Liste der übergangenen Geräte

Revision ID: 0044
Revises: 0043
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NOW = sa.text("now()")


def upgrade() -> None:
    op.add_column("inventory_hardware", sa.Column("ninja_id", sa.Integer(), nullable=True))
    op.create_unique_constraint(
        "uq_inventory_hardware_ninja_id", "inventory_hardware", ["ninja_id"]
    )
    op.add_column("inventory_hardware", sa.Column("ninja_facts", JSONB(), nullable=True))
    op.add_column(
        "inventory_hardware",
        sa.Column("ninja_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "inventory_hardware",
        sa.Column("ninja_missing_since", sa.DateTime(timezone=True), nullable=True),
    )
    op.bulk_insert(
        sa.table(
            "inventory_number_ranges",
            sa.column("key", sa.String()),
            sa.column("prefix", sa.String()),
            sa.column("next_value", sa.Integer()),
        ),
        [{"key": "vorgang", "prefix": "V-", "next_value": 1}],
    )
    op.create_table(
        "inventory_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.String(length=20), nullable=False, unique=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="neu"),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("ninja_id", sa.Integer(), nullable=True),
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "hint_hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("facts", JSONB(), nullable=False),
        sa.Column(
            "assignee_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decision", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_inventory_cases_kind", "inventory_cases", ["kind"])
    op.create_index("ix_inventory_cases_status", "inventory_cases", ["status"])
    op.create_index("ix_inventory_cases_ninja_id", "inventory_cases", ["ninja_id"])
    op.create_index("ix_inventory_cases_hardware_id", "inventory_cases", ["hardware_id"])
    op.create_table(
        "inventory_ninja_ignored",
        sa.Column("ninja_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("hostname", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("serial", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("ignored_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column(
            "ignored_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_table(
        "inventory_sync_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("devices", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("new_cases", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("missing_cases", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
    )

    # Verlauf auch für Vorgänge
    op.add_column(
        "inventory_events",
        sa.Column(
            "case_id",
            sa.Integer(),
            sa.ForeignKey(
                "inventory_cases.id",
                ondelete="CASCADE",
                name="fk_inventory_events_case_id_inventory_cases",
            ),
            nullable=True,
        ),
    )
    op.create_index("ix_inventory_events_case_id", "inventory_events", ["case_id"])
    op.drop_constraint("ck_inventory_events_one_target", "inventory_events", type_="check")
    op.create_check_constraint(
        "ck_inventory_events_one_target",
        "inventory_events",
        "(hardware_id IS NOT NULL)::int + (position_id IS NOT NULL)::int"
        " + (workplace_id IS NOT NULL)::int + (case_id IS NOT NULL)::int = 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_inventory_events_one_target", "inventory_events", type_="check")
    op.execute("DELETE FROM inventory_events WHERE case_id IS NOT NULL")
    op.create_check_constraint(
        "ck_inventory_events_one_target",
        "inventory_events",
        "(hardware_id IS NOT NULL)::int + (position_id IS NOT NULL)::int"
        " + (workplace_id IS NOT NULL)::int = 1",
    )
    op.drop_index("ix_inventory_events_case_id", table_name="inventory_events")
    op.drop_column("inventory_events", "case_id")
    op.drop_table("inventory_sync_runs")
    op.drop_table("inventory_ninja_ignored")
    op.drop_table("inventory_cases")
    op.execute("DELETE FROM inventory_number_ranges WHERE key = 'vorgang'")
    op.drop_column("inventory_hardware", "ninja_missing_since")
    op.drop_column("inventory_hardware", "ninja_seen_at")
    op.drop_column("inventory_hardware", "ninja_facts")
    op.drop_constraint("uq_inventory_hardware_ninja_id", "inventory_hardware", type_="unique")
    op.drop_column("inventory_hardware", "ninja_id")
