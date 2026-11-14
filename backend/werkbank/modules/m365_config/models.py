"""Tabellen des Moduls M365-Konfiguration (spec.md, Kapitel 9)."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class SnapshotStatus(StrEnum):
    RUNNING = "laeuft"
    OK = "ok"
    PARTIAL = "teilweise"
    FAILED = "fehler"


class ChangeKind(StrEnum):
    NEW = "neu"
    CHANGED = "geaendert"
    REMOVED = "entfernt"


class ChangeStatus(StrEnum):
    OPEN = "offen"
    INTENDED = "gewollt"
    UNINTENDED = "ungewollt"


class CfgSnapshot(Base):
    """Ein Abruf der Einstellungen aus dem Tenant."""

    __tablename__ = "cfg_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default=SnapshotStatus.RUNNING)
    # Quelle -> True (vollständig gelesen) oder False (Fehler)
    source_status: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    change_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # Anzahl gelesener Objekte (zählt gegen das Monatskontingent der Quelle)
    resource_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class CfgSetting(Base):
    """Eine einzelne Einstellung, adressiert über ihren Pfad."""

    __tablename__ = "cfg_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    path: Mapped[str] = mapped_column(String(1024), unique=True)
    workload: Mapped[str] = mapped_column(String(64), index=True)
    area: Mapped[str] = mapped_column(String(128))
    object_id: Mapped[str] = mapped_column(String(256))
    object_name: Mapped[str | None] = mapped_column(String(512))
    property: Mapped[str] = mapped_column(String(256))
    source: Mapped[str] = mapped_column(String(128), index=True)
    # False: Die Einstellung fehlte im letzten vollständigen Abruf ihrer Quelle.
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class CfgSettingVersion(Base):
    """Wert einer Einstellung in einem Zeitraum. Eine neue Zeile nur bei geändertem Wert."""

    __tablename__ = "cfg_setting_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    setting_id: Mapped[int] = mapped_column(
        ForeignKey("cfg_settings.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[Any] = mapped_column(JSONB)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("cfg_snapshots.id"))


class CfgChange(Base):
    """Erkannte Änderung an einer Einstellung, die bewertet werden soll."""

    __tablename__ = "cfg_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    setting_id: Mapped[int] = mapped_column(
        ForeignKey("cfg_settings.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    # SQL NULL bedeutet: kein Wert (bei "neu" kein alter, bei "entfernt" kein neuer)
    old_value: Mapped[Any | None] = mapped_column(JSONB(none_as_null=True))
    new_value: Mapped[Any | None] = mapped_column(JSONB(none_as_null=True))
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("cfg_snapshots.id"), index=True)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    changed_by: Mapped[str | None] = mapped_column(String(320))
    audit_ref: Mapped[str | None] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16), default=ChangeStatus.OPEN, index=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comment: Mapped[str | None] = mapped_column(Text)
