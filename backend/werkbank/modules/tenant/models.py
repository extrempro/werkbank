"""Tabellen des Moduls Tenant (Lizenzen und Benutzerzahlen mit Verlauf)."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, func, text
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
