"""Tabellen des Bereichs IT-Bestand.

Hardware wird nie gelöscht, sondern ausgemustert: Inventurnummer, Seriennummer und Verlauf
bleiben so für Inventur und Nachweise erhalten.
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
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
    # Nutzungsdauer in Jahren: danach ist ein Gerät zur Erneuerung fällig (Statistik)
    lifetime_years: Mapped[int | None] = mapped_column(Integer)


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
    # Technische Daten aus Lenovo PSREF (nur Lenovo-Rechner mit MTM), gespeichert je Modell
    psref_name: Mapped[str] = mapped_column(String(160), default="", server_default="")
    psref_url: Mapped[str] = mapped_column(String(300), default="", server_default="")
    # Liste aus {"name", "value"}
    psref_specs: Mapped[list[dict[str, str]] | None] = mapped_column(JSONB)
    # ok, nicht_gefunden oder fehler; leer: noch nie abgefragt
    psref_status: Mapped[str] = mapped_column(String(16), default="", server_default="")
    # Grund des letzten Fehlers (leer, wenn der letzte Abruf geklappt hat)
    psref_error: Mapped[str] = mapped_column(String(300), default="", server_default="")
    psref_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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
    __table_args__ = (CheckConstraint("rotation IN (0, 90, 180, 270)", name="rotation_quarter"),)

    floor_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_floors.id", ondelete="CASCADE"), primary_key=True
    )
    content_type: Mapped[str] = mapped_column(String(32))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    etag: Mapped[str] = mapped_column(String(32))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    # Drehung beim Anzeigen im Uhrzeigersinn (0, 90, 180, 270). Das Bild bleibt unverändert;
    # Räume und Plätze sind in Prozent des ungedrehten Bilds gespeichert.
    rotation: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
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
    # freiwillig: Nutzung oder Beschreibung, z. B. „Besprechung“ oder „Technik“
    description: Mapped[str] = mapped_column(String(120), default="", server_default="")
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
        CheckConstraint("position_id IS NULL OR workplace_id IS NULL", name="one_holder"),
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
    # Raum, in dem das Gerät steht (z. B. Lager oder Besprechungsraum)
    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_rooms.id", ondelete="RESTRICT"), index=True
    )
    # Zugeordnet zu einer Stelle oder einem Arbeitsplatz (höchstens eins von beiden)
    position_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_positions.id", ondelete="RESTRICT"), index=True
    )
    workplace_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_workplaces.id", ondelete="RESTRICT"), index=True
    )
    # Gerät in NinjaOne (ID) mit den zuletzt gelesenen Kenndaten
    ninja_id: Mapped[int | None] = mapped_column(Integer, unique=True)
    ninja_facts: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # zuletzt im Abgleich gesehen; seit wann es in NinjaOne fehlt
    ninja_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ninja_missing_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Monitor: Rechner, an dem er laut Custom Field in NinjaOne zuletzt hing
    connected_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="SET NULL"), index=True
    )
    # Anschaffungsdatum (von Hand); Grundlage für das Alter in der Statistik
    purchased_on: Mapped[date | None] = mapped_column(Date)
    # Herkunft: von Hand erfasst („manuell“) oder aus NinjaOne („ninja“)
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
    """Ein Eintrag im Verlauf eines Geräts, einer Stelle, eines Arbeitsplatzes oder Vorgangs.

    Der Text entsteht in der Werkbank selbst (Notizen schreiben Bearbeiter). Genau eins der
    vier Ziele ist gesetzt.
    """

    __tablename__ = "inventory_events"
    __table_args__ = (
        CheckConstraint(
            "(hardware_id IS NOT NULL)::int + (position_id IS NOT NULL)::int"
            " + (workplace_id IS NOT NULL)::int + (case_id IS NOT NULL)::int = 1",
            name="one_target",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hardware_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="CASCADE"), index=True
    )
    position_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_positions.id", ondelete="CASCADE"), index=True
    )
    workplace_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_workplaces.id", ondelete="CASCADE"), index=True
    )
    case_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_cases.id", ondelete="CASCADE"), index=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # None: von der Werkbank selbst (z. B. ein Abgleich)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    text: Mapped[str] = mapped_column(String(400))


class InventoryWorkplacePurpose(Base):
    """Zweck eines Pool-Arbeitsplatzes, z. B. Desk-Sharing oder Schulung (Stammdaten)."""

    __tablename__ = "inventory_workplace_purposes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class InventoryDepartment(Base):
    """Eine Abteilung, der Stellen angehören (Stammdaten)."""

    __tablename__ = "inventory_departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class InventoryNumberRange(Base):
    """Nummernkreis: Präfix und nächste Zahl, z. B. für Stellen „ST-“ und 12 → „ST-012“."""

    __tablename__ = "inventory_number_ranges"

    # stelle, arbeitsplatz, vorgang oder verleih
    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    prefix: Mapped[str] = mapped_column(String(10))
    next_value: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class InventoryPosition(Base):
    """Eine Stelle. Die Besetzung pflegt die Werkbank; die Person stammt aus Entra.

    Hardware und Arbeitsplätze hängen an der Stelle, nicht an der Person.
    """

    __tablename__ = "inventory_positions"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_departments.id", ondelete="RESTRICT"), index=True
    )
    # Person aus Entra (Objekt-ID, Name und Anmeldename zum Zeitpunkt der Auswahl)
    person_oid: Mapped[str | None] = mapped_column(String(36), index=True)
    person_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    person_upn: Mapped[str] = mapped_column(String(200), default="", server_default="")
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class InventoryKit(Base):
    """Vorlage für die Ausstattung eines Arbeitsplatzes (Stammdaten)."""

    __tablename__ = "inventory_kits"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class InventoryKitRow(Base):
    """Eine Zeile einer Vorlage: Bezeichnung, passende Arten und Anzahl."""

    __tablename__ = "inventory_kit_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    kit_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_kits.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    label: Mapped[str] = mapped_column(String(80))
    count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class InventoryKitRowKind(Base):
    """Eine Hardware-Art, die zu einer Zeile der Vorlage passt."""

    __tablename__ = "inventory_kit_row_kinds"

    row_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_kit_rows.id", ondelete="CASCADE"), primary_key=True
    )
    kind_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_kinds.id", ondelete="RESTRICT"), primary_key=True, index=True
    )


class InventoryWorkplace(Base):
    """Ein Arbeitsplatz in einem Raum: einzeln (eine Stelle) oder geteilt (mehrere)."""

    __tablename__ = "inventory_workplaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True)
    # früher freiwillige Bezeichnung; wird nicht mehr gepflegt oder angezeigt
    name: Mapped[str] = mapped_column(String(80), default="", server_default="")
    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_rooms.id", ondelete="RESTRICT"), index=True
    )
    # Platz im Raum in Prozent der Raumbreite und -höhe (0 bis 100); leer = nicht gesetzt
    spot_x: Mapped[float | None] = mapped_column(Float)
    spot_y: Mapped[float | None] = mapped_column(Float)
    shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sql_text("false"))
    # Pool-Arbeitsplatz: gehört absichtlich keiner Stelle; mit Zweck, Abteilung freiwillig
    pool: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sql_text("false"))
    purpose_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_workplace_purposes.id", ondelete="RESTRICT"), index=True
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_departments.id", ondelete="RESTRICT"), index=True
    )
    kit_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_kits.id", ondelete="RESTRICT"), index=True
    )
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class InventoryWorkplacePosition(Base):
    """Welche Stellen einen Arbeitsplatz nutzen."""

    __tablename__ = "inventory_workplace_positions"

    workplace_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_workplaces.id", ondelete="CASCADE"), primary_key=True
    )
    position_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_positions.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class InventoryCase(Base):
    """Ein Vorgang im Eingang des IT-Bestands, z. B. ein neues Gerät in NinjaOne.

    Status: neu, arbeit (in Bearbeitung) oder fertig. Die Kenndaten zum Zeitpunkt des Anlegens
    stehen in `facts`, damit der Vorgang auch später noch lesbar ist.
    """

    __tablename__ = "inventory_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True)
    # neu (neues Gerät in NinjaOne) oder weg (nicht mehr in NinjaOne)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    status: Mapped[str] = mapped_column(String(16), default="neu", server_default="neu", index=True)
    title: Mapped[str] = mapped_column(String(200))
    ninja_id: Mapped[int | None] = mapped_column(Integer, index=True)
    hardware_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="SET NULL"), index=True
    )
    # Hinweis „möglicherweise dasselbe Gerät“ (gleicher Hostname)
    hint_hardware_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="SET NULL")
    )
    facts: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    decision: Mapped[str] = mapped_column(String(32), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InventoryNinjaIgnore(Base):
    """Geräte aus NinjaOne, die nicht in den Bestand sollen (z. B. Testgeräte)."""

    __tablename__ = "inventory_ninja_ignored"

    ninja_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hostname: Mapped[str] = mapped_column(String(80), default="", server_default="")
    serial: Mapped[str] = mapped_column(String(80), default="", server_default="")
    ignored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ignored_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class InventorySyncRun(Base):
    """Ein Lauf des Abgleichs mit NinjaOne mit seinen Zahlen."""

    __tablename__ = "inventory_sync_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # ok oder fehlgeschlagen
    status: Mapped[str] = mapped_column(String(16))
    devices: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    new_cases: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    missing_cases: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    error: Mapped[str] = mapped_column(Text, default="", server_default="")


class InventoryMonitorIgnore(Base):
    """Monitore aus dem Custom Field, die nicht in den Bestand sollen (nach Seriennummer)."""

    __tablename__ = "inventory_monitor_ignored"

    # Seriennummer in Kleinbuchstaben
    serial: Mapped[str] = mapped_column(String(80), primary_key=True)
    model: Mapped[str] = mapped_column(String(120), default="", server_default="")
    ignored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ignored_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class InventoryLoan(Base):
    """Ein Verleih: ein oder mehrere Geräte an eine Person aus Entra, mit Rückgabedatum.

    Die Person bekommt Nachrichten nur mit Verleihnummer und Datum (Mail und Teams).
    """

    __tablename__ = "inventory_loans"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True)
    person_oid: Mapped[str] = mapped_column(String(36), index=True)
    person_name: Mapped[str] = mapped_column(String(200))
    person_upn: Mapped[str] = mapped_column(String(200), default="", server_default="")
    # Zieladresse für Mail und Teams, vom Server aus Entra gelesen
    person_mail: Mapped[str] = mapped_column(String(200), default="", server_default="")
    issued_on: Mapped[date] = mapped_column(Date)
    due_on: Mapped[date] = mapped_column(Date, index=True)
    # gesetzt, wenn alle Geräte zurück sind
    returned_on: Mapped[date | None] = mapped_column(Date, index=True)
    note: Mapped[str] = mapped_column(String(300), default="", server_default="")
    reminded_on: Mapped[date | None] = mapped_column(Date)
    overdue_notified_on: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InventoryLoanItem(Base):
    """Ein Gerät in einem Verleih; ``returned_on`` gesetzt heißt: zurück."""

    __tablename__ = "inventory_loan_items"
    __table_args__ = (
        UniqueConstraint("loan_id", "hardware_id", name="uq_inventory_loan_items_loan_hardware"),
        # Ein Gerät ist höchstens einmal gleichzeitig verliehen
        Index(
            "uq_inventory_loan_items_open",
            "hardware_id",
            unique=True,
            postgresql_where=sql_text("returned_on IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    loan_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_loans.id", ondelete="CASCADE"), index=True
    )
    hardware_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="CASCADE"), index=True
    )
    returned_on: Mapped[date | None] = mapped_column(Date)
    returned_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class InventoryLoanMessage(Base):
    """Nachricht an die ausleihende Person (Ausgabe, Erinnerung, überfällig, Rückgabe).

    Der Auftrag ``bestand.verleih`` verschickt sie; der Text entsteht erst beim Versand und
    enthält nur Verleihnummer und Datum.
    """

    __tablename__ = "inventory_loan_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    loan_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_loans.id", ondelete="CASCADE"), index=True
    )
    # ausgabe, erinnerung, ueberfaellig, rueckgabe
    kind: Mapped[str] = mapped_column(String(16))
    # mail oder teams
    channel: Mapped[str] = mapped_column(String(8))
    # offen, gesendet, fehler (aufgegeben), aus (Kanal nicht eingerichtet)
    status: Mapped[str] = mapped_column(String(10), default="offen", server_default="offen")
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    error: Mapped[str] = mapped_column(String(200), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InventoryPersonState(Base):
    """Zuletzt gesehener Stand einer Person aus Entra (Abgleich jede Stunde).

    ``inactive_since`` ist gesetzt, solange das Konto deaktiviert oder gelöscht ist; Vorgänge
    „Person nicht mehr aktiv“ entstehen einmal je Zeitraum und Stelle bzw. Verleih.
    """

    __tablename__ = "inventory_person_states"

    oid: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    upn: Mapped[str] = mapped_column(String(200), default="", server_default="")
    # aktiv, deaktiviert oder geloescht
    state: Mapped[str] = mapped_column(String(12), default="aktiv", server_default="aktiv")
    inactive_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
