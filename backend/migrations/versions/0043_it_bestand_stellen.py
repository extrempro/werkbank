"""IT-Bestand: Stellen, Arbeitsplätze, Ausstattungsvorlagen, Abteilungen, Nummernkreise

Revision ID: 0043
Revises: 0042
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "inventory_departments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True),
    )
    op.create_table(
        "inventory_number_ranges",
        sa.Column("key", sa.String(length=16), primary_key=True),
        sa.Column("prefix", sa.String(length=10), nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default="1"),
    )
    op.bulk_insert(
        sa.table(
            "inventory_number_ranges",
            sa.column("key", sa.String()),
            sa.column("prefix", sa.String()),
            sa.column("next_value", sa.Integer()),
        ),
        [
            {"key": "stelle", "prefix": "ST-", "next_value": 1},
            {"key": "arbeitsplatz", "prefix": "AP-", "next_value": 1},
        ],
    )
    op.create_table(
        "inventory_positions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.String(length=20), nullable=False, unique=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey("inventory_departments.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("person_oid", sa.String(length=36), nullable=True),
        sa.Column("person_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("person_upn", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("note", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )
    op.create_index(
        "ix_inventory_positions_department_id", "inventory_positions", ["department_id"]
    )
    op.create_index("ix_inventory_positions_person_oid", "inventory_positions", ["person_oid"])
    op.create_table(
        "inventory_kits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True),
    )
    op.create_table(
        "inventory_kit_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kit_id",
            sa.Integer(),
            sa.ForeignKey("inventory_kits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("ix_inventory_kit_rows_kit_id", "inventory_kit_rows", ["kit_id"])
    op.create_table(
        "inventory_kit_row_kinds",
        sa.Column(
            "row_id",
            sa.Integer(),
            sa.ForeignKey("inventory_kit_rows.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "kind_id",
            sa.Integer(),
            sa.ForeignKey("inventory_kinds.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )
    op.create_index("ix_inventory_kit_row_kinds_kind_id", "inventory_kit_row_kinds", ["kind_id"])
    op.create_table(
        "inventory_workplaces",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.String(length=20), nullable=False, unique=True),
        sa.Column("name", sa.String(length=80), nullable=False, server_default=""),
        sa.Column(
            "room_id",
            sa.Integer(),
            sa.ForeignKey("inventory_rooms.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "kit_id",
            sa.Integer(),
            sa.ForeignKey("inventory_kits.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("note", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )
    op.create_index("ix_inventory_workplaces_room_id", "inventory_workplaces", ["room_id"])
    op.create_index("ix_inventory_workplaces_kit_id", "inventory_workplaces", ["kit_id"])
    op.create_table(
        "inventory_workplace_positions",
        sa.Column(
            "workplace_id",
            sa.Integer(),
            sa.ForeignKey("inventory_workplaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "position_id",
            sa.Integer(),
            sa.ForeignKey("inventory_positions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_inventory_workplace_positions_position_id",
        "inventory_workplace_positions",
        ["position_id"],
    )

    # Hardware an einer Stelle oder einem Arbeitsplatz
    op.add_column(
        "inventory_hardware",
        sa.Column(
            "position_id",
            sa.Integer(),
            sa.ForeignKey(
                "inventory_positions.id",
                ondelete="RESTRICT",
                name="fk_inventory_hardware_position_id_inventory_positions",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "inventory_hardware",
        sa.Column(
            "workplace_id",
            sa.Integer(),
            sa.ForeignKey(
                "inventory_workplaces.id",
                ondelete="RESTRICT",
                name="fk_inventory_hardware_workplace_id_inventory_workplaces",
            ),
            nullable=True,
        ),
    )
    op.create_index("ix_inventory_hardware_position_id", "inventory_hardware", ["position_id"])
    op.create_index("ix_inventory_hardware_workplace_id", "inventory_hardware", ["workplace_id"])
    op.create_check_constraint(
        "ck_inventory_hardware_one_holder",
        "inventory_hardware",
        "position_id IS NULL OR workplace_id IS NULL",
    )

    # Verlauf auch für Stellen und Arbeitsplätze
    op.alter_column("inventory_events", "hardware_id", existing_type=sa.Integer(), nullable=True)
    op.add_column(
        "inventory_events",
        sa.Column(
            "position_id",
            sa.Integer(),
            sa.ForeignKey(
                "inventory_positions.id",
                ondelete="CASCADE",
                name="fk_inventory_events_position_id_inventory_positions",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "inventory_events",
        sa.Column(
            "workplace_id",
            sa.Integer(),
            sa.ForeignKey(
                "inventory_workplaces.id",
                ondelete="CASCADE",
                name="fk_inventory_events_workplace_id_inventory_workplaces",
            ),
            nullable=True,
        ),
    )
    op.create_index("ix_inventory_events_position_id", "inventory_events", ["position_id"])
    op.create_index("ix_inventory_events_workplace_id", "inventory_events", ["workplace_id"])
    op.create_check_constraint(
        "ck_inventory_events_one_target",
        "inventory_events",
        "(hardware_id IS NOT NULL)::int + (position_id IS NOT NULL)::int"
        " + (workplace_id IS NOT NULL)::int = 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_inventory_events_one_target", "inventory_events", type_="check")
    op.execute("DELETE FROM inventory_events WHERE hardware_id IS NULL")
    op.drop_index("ix_inventory_events_workplace_id", table_name="inventory_events")
    op.drop_index("ix_inventory_events_position_id", table_name="inventory_events")
    op.drop_column("inventory_events", "workplace_id")
    op.drop_column("inventory_events", "position_id")
    op.alter_column("inventory_events", "hardware_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("ck_inventory_hardware_one_holder", "inventory_hardware", type_="check")
    op.drop_index("ix_inventory_hardware_workplace_id", table_name="inventory_hardware")
    op.drop_index("ix_inventory_hardware_position_id", table_name="inventory_hardware")
    op.drop_column("inventory_hardware", "workplace_id")
    op.drop_column("inventory_hardware", "position_id")
    op.drop_table("inventory_workplace_positions")
    op.drop_table("inventory_workplaces")
    op.drop_table("inventory_kit_row_kinds")
    op.drop_table("inventory_kit_rows")
    op.drop_table("inventory_kits")
    op.drop_table("inventory_positions")
    op.drop_table("inventory_number_ranges")
    op.drop_table("inventory_departments")
