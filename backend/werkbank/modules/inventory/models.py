"""Tabellen des Bereichs IT-Bestand.

Hardware wird nie gelöscht, sondern ausgemustert: Inventurnummer, Seriennummer und Verlauf
bleiben so für Inventur und Nachweise erhalten.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class InventoryKind(Base):
    """Eine Hardware-Art, z. B. Notebook oder Monitor (Stammdaten)."""

    __tablename__ = "inventory_kinds"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    # Geräte dieser Art haben einen Datenträger: Beim Ausmustern muss das Löschen
    # oder Vernichten bestätigt werden.
    has_storage: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_text("false")
    )


class InventoryMaker(Base):
    """Ein Hersteller (Stammdaten)."""

    __tablename__ = "inventory_makers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class InventoryModel(Base):
    """Ein Modell eines Herstellers (Stammdaten)."""

    __tablename__ = "inventory_models"
    __table_args__ = (UniqueConstraint("maker_id", "name", name="uq_inventory_models_maker_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    maker_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_makers.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))


class InventoryRetireReason(Base):
    """Ein Grund fürs Ausmustern (Stammdaten)."""

    __tablename__ = "inventory_retire_reasons"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class InventoryCity(Base):
    """Eine Stadt, oberste Ebene der Standorte."""

    __tablename__ = "inventory_cities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class InventorySite(Base):
    """Ein Standort in einer Stadt, z. B. ein Gebäudekomplex."""

    __tablename__ = "inventory_sites"
    __table_args__ = (UniqueConstraint("city_id", "name", name="uq_inventory_sites_city_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    city_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_cities.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))


class InventorySection(Base):
    """Ein Gebäudeabschnitt eines Standorts."""

    __tablename__ = "inventory_sections"
    __table_args__ = (UniqueConstraint("site_id", "name", name="uq_inventory_sections_site_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_sites.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))


class InventoryFloor(Base):
    """Eine Etage eines Gebäudeabschnitts; optional mit Grundriss."""

    __tablename__ = "inventory_floors"
    __table_args__ = (
        UniqueConstraint("section_id", "name", name="uq_inventory_floors_section_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    section_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_sections.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    # Reihenfolge innerhalb des Abschnitts, z. B. -1 Keller, 0 Erdgeschoss
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class InventoryFloorPlan(Base):
    """Der Grundriss einer Etage als Bild (PNG, JPEG oder WebP; nie SVG)."""

    __tablename__ = "inventory_floor_plans"

    floor_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_floors.id", ondelete="CASCADE"), primary_key=True
    )
    content_type: Mapped[str] = mapped_column(String(32))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    etag: Mapped[str] = mapped_column(String(32))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class InventoryRoom(Base):
    """Ein Raum auf einer Etage. Lage als Rechteck in Prozent des Grundrisses."""

    __tablename__ = "inventory_rooms"
    __table_args__ = (UniqueConstraint("floor_id", "name", name="uq_inventory_rooms_floor_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_floors.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)


class InventoryHardware(Base):
    """Ein Gerät im Bestand."""

    __tablename__ = "inventory_hardware"
    __table_args__ = (
        # Inventurnummer eindeutig, sobald eine eingetragen ist
        Index(
            "uq_inventory_hardware_inventory_no",
            "inventory_no",
            unique=True,
            postgresql_where=sql_text("inventory_no IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_kinds.id", ondelete="RESTRICT"), index=True
    )
    model_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_models.id", ondelete="RESTRICT"), index=True
    )
    # Bezeichnung, z. B. „Notebook 14 Zoll“
    name: Mapped[str] = mapped_column(String(160))
    serial: Mapped[str] = mapped_column(String(80), default="", server_default="")
    inventory_no: Mapped[str | None] = mapped_column(String(40))
    hostname: Mapped[str] = mapped_column(String(80), default="", server_default="")
    # Raum, in dem das Gerät steht (z. B. Lager oder Besprechungsraum); später kommen
    # Stellen und Arbeitsplätze dazu
    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_rooms.id", ondelete="RESTRICT"), index=True
    )
    # Herkunft: von Hand erfasst („manuell“); später auch aus NinjaOne
    source: Mapped[str] = mapped_column(String(16), default="manuell", server_default="manuell")
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    # aktiv oder ausgemustert
    status: Mapped[str] = mapped_column(
        String(16), default="aktiv", server_default="aktiv", index=True
    )
    retired_on: Mapped[date | None] = mapped_column(Date)
    retire_reason_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_retire_reasons.id", ondelete="RESTRICT")
    )
    # entsorgt, abgegeben, leasing oder hersteller
    retire_whereabouts: Mapped[str | None] = mapped_column(String(16))
    # Datenträger gelöscht oder vernichtet (bestätigt beim Ausmustern)
    retire_wiped: Mapped[bool | None] = mapped_column(Boolean)
    retire_note: Mapped[str] = mapped_column(String(300), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class InventoryEvent(Base):
    """Ein Eintrag im Verlauf eines Geräts. Der Text entsteht in der Werkbank selbst."""

    __tablename__ = "inventory_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    hardware_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="CASCADE"), index=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # None: von der Werkbank selbst (z. B. ein Abgleich)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    text: Mapped[str] = mapped_column(String(400))
