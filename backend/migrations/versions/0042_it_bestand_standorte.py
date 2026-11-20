"""IT-Bestand: Standorte mit Etagen, Grundrissen und Räumen; Raum am Gerät

Revision ID: 0042
Revises: 0041
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_cities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True),
    )
    op.create_table(
        "inventory_sites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "city_id",
            sa.Integer(),
            sa.ForeignKey("inventory_cities.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.UniqueConstraint("city_id", "name", name="uq_inventory_sites_city_name"),
    )
    op.create_index("ix_inventory_sites_city_id", "inventory_sites", ["city_id"])
    op.create_table(
        "inventory_sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "site_id",
            sa.Integer(),
            sa.ForeignKey("inventory_sites.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.UniqueConstraint("site_id", "name", name="uq_inventory_sections_site_name"),
    )
    op.create_index("ix_inventory_sections_site_id", "inventory_sections", ["site_id"])
    op.create_table(
        "inventory_floors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "section_id",
            sa.Integer(),
            sa.ForeignKey("inventory_sections.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.UniqueConstraint("section_id", "name", name="uq_inventory_floors_section_name"),
    )
    op.create_index("ix_inventory_floors_section_id", "inventory_floors", ["section_id"])
    op.create_table(
        "inventory_floor_plans",
        sa.Column(
            "floor_id",
            sa.Integer(),
            sa.ForeignKey("inventory_floors.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("etag", sa.String(length=32), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_table(
        "inventory_rooms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "floor_id",
            sa.Integer(),
            sa.ForeignKey("inventory_floors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.UniqueConstraint("floor_id", "name", name="uq_inventory_rooms_floor_name"),
    )
    op.create_index("ix_inventory_rooms_floor_id", "inventory_rooms", ["floor_id"])
    op.add_column(
        "inventory_hardware",
        sa.Column(
            "room_id",
            sa.Integer(),
            sa.ForeignKey(
                "inventory_rooms.id",
                ondelete="RESTRICT",
                name="fk_inventory_hardware_room_id_inventory_rooms",
            ),
            nullable=True,
        ),
    )
    op.create_index("ix_inventory_hardware_room_id", "inventory_hardware", ["room_id"])


def downgrade() -> None:
    op.drop_index("ix_inventory_hardware_room_id", table_name="inventory_hardware")
    op.drop_constraint(
        "fk_inventory_hardware_room_id_inventory_rooms", "inventory_hardware", type_="foreignkey"
    )
    op.drop_column("inventory_hardware", "room_id")
    op.drop_index("ix_inventory_rooms_floor_id", table_name="inventory_rooms")
    op.drop_table("inventory_rooms")
    op.drop_table("inventory_floor_plans")
    op.drop_index("ix_inventory_floors_section_id", table_name="inventory_floors")
    op.drop_table("inventory_floors")
    op.drop_index("ix_inventory_sections_site_id", table_name="inventory_sections")
    op.drop_table("inventory_sections")
    op.drop_index("ix_inventory_sites_city_id", table_name="inventory_sites")
    op.drop_table("inventory_sites")
    op.drop_table("inventory_cities")
