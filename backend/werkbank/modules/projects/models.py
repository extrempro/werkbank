"""Tabellen des Bereichs IT-Projekte.

Die Kosten eines Projekts stehen nicht hier: Sie kommen aus den Budgetposten des IT-Budgets,
bei denen das Projekt ausgewählt ist (`budget_items.project_id`).
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class Project(Base):
    """Ein IT-Projekt mit Laufzeit und veranschlagtem Budget."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    description: Mapped[str] = mapped_column(String(500), default="", server_default="")
    # geplant, aktiv, pausiert oder abgeschlossen
    status: Mapped[str] = mapped_column(String(16), default="aktiv", server_default="aktiv")
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    # Veranschlagtes Budget für die ganze Laufzeit (brutto, in Cent); None: nicht hinterlegt
    budget_cents: Mapped[int | None] = mapped_column(BigInteger)
    budget_approved_on: Mapped[date | None] = mapped_column(Date)
    budget_note: Mapped[str] = mapped_column(String(200), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProjectPerson(Base):
    """Ein Ansprechpartner, intern oder extern, als Freitext (keine Abfrage aus Entra)."""

    __tablename__ = "project_people"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(160))
    # Rolle im Projekt, z. B. Projektleitung
    role: Mapped[str] = mapped_column(String(120), default="", server_default="")
    # intern oder extern
    kind: Mapped[str] = mapped_column(String(8))
    organisation: Mapped[str] = mapped_column(String(160), default="", server_default="")
    # Mail-Adresse oder Telefonnummer, nur als Text
    contact: Mapped[str] = mapped_column(String(200), default="", server_default="")


class ProjectLink(Base):
    """Ein wichtiger Link des Projekts (z. B. die Ablage). Nur https-Adressen."""

    __tablename__ = "project_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(500))


class ProjectTask(Base):
    """Ein Punkt der groben Aufgabenliste. Die eigentlichen Aufgaben laufen in anderen Tools."""

    __tablename__ = "project_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(String(300))
    # Zuständig, als Freitext
    owner: Mapped[str] = mapped_column(String(120), default="", server_default="")
    due_on: Mapped[date | None] = mapped_column(Date)
    done: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sql_text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProjectMeeting(Base):
    """Ein Jour-Fixe-Eintrag mit Datum und Protokoll in Markdown."""

    __tablename__ = "project_meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    held_on: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(160))
    # Protokoll als Markdown; die Oberfläche stellt es nur als Text dar, nie als HTML
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProjectMeetingFile(Base):
    """Ein PDF-Anhang eines Jour-Fixe-Eintrags. Die Datei liegt unter zufälligem Namen."""

    __tablename__ = "project_meeting_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("project_meetings.id", ondelete="CASCADE"), index=True
    )
    # Dateiname zur Anzeige, Schlüssel der Datei in der Ablage, Größe in Bytes
    name: Mapped[str] = mapped_column(String(200))
    key: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
