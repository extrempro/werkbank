"""Tabellen der Gerätezuordnung (spec.md, Kapitel 7c)."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class AssociationStatus(StrEnum):
    PENDING = "freigabe"
    PREASSOCIATED = "vorab"
    ASSOCIATED = "zugeordnet"
    ENROLLED = "registriert"
    STALE = "nicht_abgeschlossen"


OPEN_STATES = (AssociationStatus.PREASSOCIATED, AssociationStatus.ASSOCIATED)


class DeviceAssociation(Base):
    """Ein gescanntes Gerät: wartet auf Freigabe oder ist bei Microsoft vorab zugeordnet.

    `device_link_enc` hält die umgewandelten Gerätedaten verschlüsselt, nur solange die Freigabe
    aussteht; nach Import oder Verwerfen sofort gelöscht, sonst nach 24 Stunden.
    """

    __tablename__ = "dev_associations"

    id: Mapped[int] = mapped_column(primary_key=True)
    serial_number: Mapped[str] = mapped_column(String(128), index=True)
    manufacturer: Mapped[str] = mapped_column(String(256))
    model: Mapped[str] = mapped_column(String(256))
    link_id: Mapped[str] = mapped_column(String(36))
    qr_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(24), index=True)
    device_link_enc: Mapped[str | None] = mapped_column(Text)
    link_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    policy_id: Mapped[str | None] = mapped_column(String(64))
    policy_name: Mapped[str | None] = mapped_column(String(256))
    # Eintrag bei Microsoft (tenantAssociatedDevices) und sein Rohstatus
    graph_id: Mapped[str | None] = mapped_column(String(64), index=True)
    association_state: Mapped[str | None] = mapped_column(String(64))
    request_id: Mapped[str | None] = mapped_column(String(64))
    last_error: Mapped[str | None] = mapped_column(String(500))
    scanned_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_admin: Mapped[str | None] = mapped_column(String(320))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    associated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Angaben aus Intune (managedDevices)
    managed_device_id: Mapped[str | None] = mapped_column(String(64))
    device_name: Mapped[str | None] = mapped_column(String(256))
    compliance: Mapped[str | None] = mapped_column(String(64))
    user_principal_name: Mapped[str | None] = mapped_column(String(320))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeviceAdminSession(Base):
    """Zweite Anmeldung mit dem Admin-Konto, an die Werkbank-Sitzung gebunden.

    Nur das Zugriffstoken (verschlüsselt, ohne Refresh-Token), bis es abläuft oder die Person
    „Trennen“ wählt. Endet die Werkbank-Sitzung, verschwindet es mit ihr.
    """

    __tablename__ = "dev_admin_sessions"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    token_enc: Mapped[str] = mapped_column(Text)
    admin_upn: Mapped[str] = mapped_column(String(320))
    admin_name: Mapped[str] = mapped_column(String(256))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
