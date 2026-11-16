"""Tabellen des Moduls M365-Konfiguration (spec.md, Kapitel 9)."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
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
    # Quelle -> Fehlertext der Quelle, wenn sie nicht vollständig gelesen wurde
    source_errors: Mapped[dict[str, Any]] = mapped_column(
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


class Criticality(StrEnum):
    LOW = "niedrig"
    MEDIUM = "mittel"
    HIGH = "hoch"


class CfgSettingMeta(Base):
    """Gepflegte Angaben zu einer Einstellung (spec.md 7.5). Höchstens eine Zeile je Einstellung."""

    __tablename__ = "cfg_setting_meta"

    setting_id: Mapped[int] = mapped_column(
        ForeignKey("cfg_settings.id", ondelete="CASCADE"), primary_key=True
    )
    description: Mapped[str | None] = mapped_column(Text)
    reasoning: Mapped[str | None] = mapped_column(Text)
    criticality: Mapped[str | None] = mapped_column(String(16))
    owner: Mapped[str | None] = mapped_column(String(256))
    learn_url: Mapped[str | None] = mapped_column(String(500))
    # Soll-Wert: target_value zählt nur, wenn target_set wahr ist (auch JSON null ist ein Wert)
    target_set: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    target_value: Mapped[Any] = mapped_column(JSONB, default=None, server_default=text("'null'"))
    target_source: Mapped[str | None] = mapped_column(String(64))


class CfgSettingMetaHistory(Base):
    """Verlauf der gepflegten Angaben: je geändertem Feld eine Zeile."""

    __tablename__ = "cfg_setting_meta_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    setting_id: Mapped[int] = mapped_column(
        ForeignKey("cfg_settings.id", ondelete="CASCADE"), index=True
    )
    field: Mapped[str] = mapped_column(String(32))
    old_value: Mapped[Any | None] = mapped_column(JSONB(none_as_null=True))
    new_value: Mapped[Any | None] = mapped_column(JSONB(none_as_null=True))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AiTextState(StrEnum):
    UNREVIEWED = "ungeprueft"
    APPROVED = "geprueft"
    DISMISSED = "verworfen"
    # Das Modell kannte die Einstellung nicht; es gibt keinen Text und keinen neuen Versuch.
    UNKNOWN = "unbekannt"


class CfgAiText(Base):
    """KI-Text für eine Art von Einstellung (spec.md 6.9).

    Ein Text gilt für alle Einstellungen mit demselben Dienst, Bereich und derselben Eigenschaft,
    weil an den Anbieter nur diese drei Angaben gehen (nie Werte oder Namen aus dem Tenant).
    """

    __tablename__ = "cfg_ai_texts"
    __table_args__ = (UniqueConstraint("workload", "area", "property"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workload: Mapped[str] = mapped_column(String(64))
    area: Mapped[str] = mapped_column(String(128))
    property: Mapped[str] = mapped_column(String(256))
    text: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(100))
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CfgRecommendation(Base):
    """Empfehlung aus Microsoft Secure Score („Control“) mit dem Stand im Tenant."""

    __tablename__ = "cfg_recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Kennung des Controls bei Microsoft, z. B. „AdminMFAV2“
    control_id: Mapped[str] = mapped_column(String(128), unique=True)
    title: Mapped[str] = mapped_column(String(500))
    category: Mapped[str | None] = mapped_column(String(64))
    service: Mapped[str | None] = mapped_column(String(128))
    action_type: Mapped[str | None] = mapped_column(String(32))
    user_impact: Mapped[str | None] = mapped_column(String(32))
    implementation_cost: Mapped[str | None] = mapped_column(String(32))
    rank: Mapped[int | None] = mapped_column(Integer)
    max_score: Mapped[float] = mapped_column(Float, default=0.0)
    # Erreichte Punkte; None, solange Microsoft für dieses Control keinen Stand liefert
    score: Mapped[float | None] = mapped_column(Float)
    status_text: Mapped[str | None] = mapped_column(Text)
    remediation: Mapped[str | None] = mapped_column(Text)
    action_url: Mapped[str | None] = mapped_column(String(500))
    deprecated: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # False: Das Control fehlte im letzten Abruf.
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CfgRecommendationLink(Base):
    """Von Hand gepflegte Zuordnung: Diese Empfehlung betrifft diese Einstellung."""

    __tablename__ = "cfg_recommendation_links"

    recommendation_id: Mapped[int] = mapped_column(
        ForeignKey("cfg_recommendations.id", ondelete="CASCADE"), primary_key=True
    )
    setting_id: Mapped[int] = mapped_column(
        ForeignKey("cfg_settings.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
