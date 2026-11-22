"""Tabellen der Quelle Zabbix. Gespeichert wird nur, was Übersicht, Verknüpfung und Berichte
brauchen; Zabbix bleibt die Quelle (keine Werte von Items, keine Rohverläufe)."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, String, func
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
    # Ab diesem Tag sammelt die Werkbank Daten für die Berichte (nicht rückwirkend)
    reports_since: Mapped[date | None] = mapped_column(Date)


class ZbxUnmonitored(Base):
    """Gerät im IT-Bestand, das bewusst nicht in Zabbix überwacht wird."""

    __tablename__ = "mon_zbx_unmonitored"

    hardware_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="CASCADE"), primary_key=True
    )
    reason: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbxHostLink(Base):
    """Von Hand zugeordnetes Gerät für einen Host ohne Seriennummer im Zabbix-Inventar.

    Gilt nur, solange Zabbix keine Seriennummer liefert."""

    __tablename__ = "mon_zbx_host_links"

    hostid: Mapped[str] = mapped_column(String(20), primary_key=True)
    hardware_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbxMaintLog(Base):
    """Zeitraum, in dem ein Host laut Zabbix in Wartung war (eigene Beobachtung, 40 Tage)."""

    __tablename__ = "mon_zbx_maint_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    hostid: Mapped[str] = mapped_column(String(20), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ZbxReportDay(Base):
    """Ein Tag, für den die Berichtsdaten erzeugt sind."""

    __tablename__ = "mon_zbx_report_days"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ZbxDowntime(Base):
    """Überwachte Zeit, Wartung und Ausfall eines Hosts an einem Tag in Sekunden (3 Jahre).

    Name, Standort und Gruppen sind der Stand des Tages, damit Berichte stabil bleiben."""

    __tablename__ = "mon_zbx_downtime"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    hostid: Mapped[str] = mapped_column(String(20), primary_key=True)
    host: Mapped[str] = mapped_column(String(255))
    site: Mapped[str | None] = mapped_column(String(255))
    groups: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    monitored_s: Mapped[int] = mapped_column(Integer, default=0)
    maintenance_s: Mapped[int] = mapped_column(Integer, default=0)
    downtime_s: Mapped[int] = mapped_column(Integer, default=0)


class ZbxTriggerStat(Base):
    """Probleme je Monat, Trigger und Host: Anzahl und Dauer (3 Jahre)."""

    __tablename__ = "mon_zbx_trigger_stats"

    month: Mapped[date] = mapped_column(Date, primary_key=True)
    triggerid: Mapped[str] = mapped_column(String(20), primary_key=True)
    hostid: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    host: Mapped[str] = mapped_column(String(255))
    count: Mapped[int] = mapped_column(Integer, default=0)
    duration_s: Mapped[int] = mapped_column(BigInteger, default=0)


class ZbxOutage(Base):
    """Ein Ausfall: Problem eines Triggers mit Tag scope: availability ab Schweregrad Hoch."""

    __tablename__ = "mon_zbx_outages"

    eventid: Mapped[str] = mapped_column(String(20), primary_key=True)
    hostid: Mapped[str] = mapped_column(String(20))
    host: Mapped[str] = mapped_column(String(255))
    site: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
