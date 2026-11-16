"""Tabellen des Moduls Tenant (Lizenzen, Benutzerzahlen, Zugangsdaten, Dienststatus)."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class TenantLicense(Base):
    """Eine Lizenz (SKU) des Tenants mit dem Stand des letzten Abrufs."""

    __tablename__ = "tenant_licenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Kennung der Lizenz bei Microsoft (GUID), gleich in allen Tenants
    sku_id: Mapped[str] = mapped_column(String(64), unique=True)
    # Technischer Name, z. B. „SPE_E3“
    part_number: Mapped[str] = mapped_column(String(128))
    applies_to: Mapped[str | None] = mapped_column(String(32))
    capability_status: Mapped[str | None] = mapped_column(String(32))
    # Gekaufte, nutzbare Einheiten
    total: Mapped[int] = mapped_column(Integer, default=0)
    # Einheiten in Kulanzfrist, gesperrt oder ausgesetzt (z. B. nach Ablauf des Abos)
    warning: Mapped[int] = mapped_column(Integer, default=0)
    suspended: Mapped[int] = mapped_column(Integer, default=0)
    locked_out: Mapped[int] = mapped_column(Integer, default=0)
    consumed: Mapped[int] = mapped_column(Integer, default=0)
    # Nächster Stichtag eines Abos dieser Lizenz (Verlängerung oder Ablauf)
    next_lifecycle: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trial: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # False: Die Lizenz fehlte im letzten Abruf.
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TenantLicenseSample(Base):
    """Stand einer Lizenz an einem Tag (ein Eintrag je Tag, der letzte Abruf des Tages gilt)."""

    __tablename__ = "tenant_license_samples"

    license_id: Mapped[int] = mapped_column(
        ForeignKey("tenant_licenses.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    total: Mapped[int] = mapped_column(Integer)
    consumed: Mapped[int] = mapped_column(Integer)


class TenantUserSample(Base):
    """Benutzerzahlen des Tenants an einem Tag. Nur Summen, keine Personen."""

    __tablename__ = "tenant_user_samples"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    # Alle Konten, davon Gäste, davon deaktiviert
    total: Mapped[int] = mapped_column(Integer)
    guests: Mapped[int] = mapped_column(Integer)
    disabled: Mapped[int] = mapped_column(Integer)
    guests_disabled: Mapped[int] = mapped_column(Integer)
    # Konten mit mindestens einer Lizenz; None, wenn Microsoft die Zahl nicht liefert
    licensed: Mapped[int | None] = mapped_column(Integer)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TenantCredential(Base):
    """Zertifikat oder Secret einer Anwendung im Tenant, mit Ablaufdatum.

    Gespeichert werden nur Bezeichnung und Daten, nie der geheime Wert (Microsoft liefert ihn
    ohnehin nicht).
    """

    __tablename__ = "tenant_credentials"
    __table_args__ = (UniqueConstraint("owner_kind", "owner_id", "kind", "key_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # „app“: App-Registrierung; „sso“: Unternehmensanwendung mit Signaturzertifikat
    owner_kind: Mapped[str] = mapped_column(String(8))
    # Objekt-ID der Anwendung in Entra
    owner_id: Mapped[str] = mapped_column(String(64))
    app_id: Mapped[str | None] = mapped_column(String(64))
    owner_name: Mapped[str] = mapped_column(String(256))
    # „secret“ oder „zertifikat“
    kind: Mapped[str] = mapped_column(String(16))
    key_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(256))
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    # False: Der Eintrag fehlte im letzten Abruf (entfernt oder Anwendung gelöscht).
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TenantServiceHealth(Base):
    """Zustand eines Dienstes von Microsoft 365 beim letzten Abruf."""

    __tablename__ = "tenant_service_health"

    # Kennung bei Microsoft, z. B. „Exchange“, „microsoftteams“, „SharePoint“, „OrgLiveID“
    service_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    service_name: Mapped[str] = mapped_column(String(128))
    # Status laut Microsoft, z. B. „serviceOperational“, „serviceDegradation“
    status: Mapped[str] = mapped_column(String(48))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TenantServiceIssue(Base):
    """Störung oder Hinweis zu einem der beobachteten Dienste, mit Verlauf der Mitteilungen.

    Die Mitteilungen von Microsoft stehen als Text ohne HTML in `posts`. Aufbewahrung drei Jahre.
    """

    __tablename__ = "tenant_service_issues"

    # Kennung bei Microsoft, z. B. „EX123456“
    issue_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    service_id: Mapped[str] = mapped_column(String(64), index=True)
    service_name: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(500))
    # „incident“ (Störung) oder „advisory“ (Hinweis)
    classification: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(48))
    feature_group: Mapped[str | None] = mapped_column(String(128))
    feature: Mapped[str | None] = mapped_column(String(128))
    impact: Mapped[str | None] = mapped_column(String(2000))
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Mitteilungen: [{"at": ISO-Zeit, "type": "regular" | "quick" | …, "text": "…"}]
    posts: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
