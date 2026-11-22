"""Tabellen der Quelle Zabbix. Gespeichert wird nur, was Übersicht, Verknüpfung und Berichte
brauchen; Zabbix bleibt die Quelle (keine Werte von Items, keine Rohverläufe)."""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class ZbxHost(Base):
    """Ein Host aus Zabbix mit Zustand, Schnittstellen, Gruppen und Seriennummer."""

    __tablename__ = "mon_zbx_hosts"

    hostid: Mapped[str] = mapped_column(String(20), primary_key=True)
    host: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    monitored: Mapped[bool] = mapped_column(Boolean, default=True)
    # True erreichbar, False nicht erreichbar, None unbekannt
    reachable: Mapped[bool | None] = mapped_column(Boolean)
    in_maintenance: Mapped[bool] = mapped_column(Boolean, default=False)
    maintenanceid: Mapped[str | None] = mapped_column(String(20))
    # [{type, address, port, main, available}]
    interfaces: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    # [{id, name}]
    groups: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    templates: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    serial: Mapped[str] = mapped_column(String(80), default="", index=True)
    model: Mapped[str] = mapped_column(String(80), default="")
    kind: Mapped[str] = mapped_column(String(80), default="")
    # Standort des IT-Bestands aus der Hostgruppe; None: ohne Standort
    site_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_sites.id", ondelete="SET NULL"), index=True
    )
    # Zuletzt, als eine Schnittstelle erreichbar war (eigene Beobachtung der Werkbank)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbxProblem(Base):
    """Ein offenes Problem. Ohne Quittierungs-Kommentare und ohne Benutzer aus Zabbix."""

    __tablename__ = "mon_zbx_problems"

    eventid: Mapped[str] = mapped_column(String(20), primary_key=True)
    triggerid: Mapped[str] = mapped_column(String(20))
    hostid: Mapped[str | None] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(255))
    # 0 nicht klassifiziert … 5 Katastrophe
    severity: Mapped[int] = mapped_column(Integer)
    since: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    suppressed: Mapped[bool] = mapped_column(Boolean, default=False)
    # [[tag, wert], …]
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list)


class ZbxMaintenance(Base):
    """Eine Wartung mit Zeitraum und betroffenen Hosts und Gruppen."""

    __tablename__ = "mon_zbx_maintenances"

    maintenanceid: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    with_data: Mapped[bool] = mapped_column(Boolean, default=True)
    active_since: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    active_till: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    hostids: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    groupids: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    # [[beginn, ende], …] als Unix-Zeit
    once: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    recurring: Mapped[list[Any]] = mapped_column(JSONB, default=list)


class ZbxGroupSite(Base):
    """Zuordnung einer Hostgruppe zu einem Standort des IT-Bestands (Reihenfolge zählt)."""

    __tablename__ = "mon_zbx_group_sites"

    groupid: Mapped[str] = mapped_column(String(20), primary_key=True)
    group_name: Mapped[str] = mapped_column(String(255))
    site_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_sites.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)


class ZbxRun(Base):
    """Ein Lauf einer Abfrage (30 Tage)."""

    __tablename__ = "mon_zbx_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # schnell (1 Min.), wartungen (15 Min.), stammdaten (stündlich)
    task: Mapped[str] = mapped_column(String(20), index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[str | None] = mapped_column(String(500))
    # z. B. {"hosts": 120, "probleme": 4}
    counts: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class ZbxStatus(Base):
    """Zustand der Verbindung (eine Zeile): Version, Dienstkonto, Hinweise."""

    __tablename__ = "mon_zbx_status"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str | None] = mapped_column(String(40))
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # {"rolle", "methoden", "modus", "hinweise", "token_ablauf"}
    account: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
