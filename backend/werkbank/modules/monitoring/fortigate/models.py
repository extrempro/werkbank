"""Tabellen für FortiGate. Die Werkbank liest die Firewalls nur; gespeichert wird die
Konfiguration je Gerät (nur wenn sie sich geändert hat) und der letzte Laufzeitstand."""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class FgDevice(Base):
    """Eine FortiGate (bei HA: der Cluster mit seiner Cluster-Adresse)."""

    __tablename__ = "mon_fg_devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    # https-Adresse der Verwaltung, z. B. https://fw-edge.example.com
    url: Mapped[str] = mapped_column(String(300))
    # API-Token des Nur-Lese-Benutzers, verschlüsselt (core/app_settings.encrypt_secret)
    token_encrypted: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Letzter Laufzeitstand: Version, HA, Treffer je Policy (nur der jüngste, kein Verlauf)
    runtime: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    runtime_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FgSnapshot(Base):
    """Konfiguration eines Geräts zu einem Zeitpunkt. Ein neuer Eintrag nur bei Änderung."""

    __tablename__ = "mon_fg_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("mon_fg_devices.id", ondelete="CASCADE"), index=True
    )
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    # Zuletzt gesehen, solange sich nichts ändert
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # SHA-256 der Konfiguration (normalisiert), um Änderungen zu erkennen
    digest: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)


class FgRun(Base):
    """Ein Abruf eines Geräts: gelungen oder mit Fehler."""

    __tablename__ = "mon_fg_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("mon_fg_devices.id", ondelete="CASCADE"), index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(String(500))
    # Neuer Stand der Konfiguration? (sonst nur geprüft)
    changed: Mapped[bool] = mapped_column(Boolean, default=False)
    snapshot_id: Mapped[int | None] = mapped_column(
        ForeignKey("mon_fg_snapshots.id", ondelete="SET NULL")
    )
