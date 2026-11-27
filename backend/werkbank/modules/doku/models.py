"""Tabellen der Dokumentation (spec.md 8f).

Rechte: Ein Arbeitsbereich hat Mitglieder mit Lesen, Bearbeiten oder Verwalten. Eine Seite kann
eigene Rechte haben („Schloss“); sie gelten für die Seite und ihre Unterseiten, bis eine
Unterseite wieder eigene hat. Eigene Rechte überschreiben die des Arbeitsbereichs je Person,
„Kein Zugriff“ nimmt einer Person die Seite weg.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base

# Rollen im Arbeitsbereich und an einer Seite
ROLE_READ = "read"
ROLE_EDIT = "edit"
ROLE_MANAGE = "manage"
ROLE_NONE = "none"
SPACE_ROLES = (ROLE_READ, ROLE_EDIT, ROLE_MANAGE)
PAGE_ROLES = (ROLE_READ, ROLE_EDIT, ROLE_NONE)


class DokuSpace(Base):
    """Ein Arbeitsbereich, z. B. für eine Abteilung oder ein Thema."""

    __tablename__ = "doku_spaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(String(500), default="", server_default="")
    # Ein Emoji vor dem Namen (leer: keins)
    icon: Mapped[str] = mapped_column(String(32), default="", server_default="")
    # Archiviert: nur noch lesbar, im Seitenbaum unten unter „Archiv“
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sql_text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DokuSpaceMember(Base):
    """Eine Person im Arbeitsbereich (aus Entra ausgewählt) mit ihrer Rolle."""

    __tablename__ = "doku_space_members"

    space_id: Mapped[int] = mapped_column(
        ForeignKey("doku_spaces.id", ondelete="CASCADE"), primary_key=True
    )
    oid: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    role: Mapped[str] = mapped_column(String(16))


class DokuPage(Base):
    """Eine Seite im Arbeitsbereich; Inhalt als Dokument des Editors (JSON, nie HTML)."""

    __tablename__ = "doku_pages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[int] = mapped_column(
        ForeignKey("doku_spaces.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("doku_pages.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, server_default=sql_text("0"))
    title: Mapped[str] = mapped_column(String(200))
    # Ein Emoji vor dem Titel (leer: keins)
    icon: Mapped[str] = mapped_column(String(32), default="", server_default="")
    content: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # Stand des gemeinsamen Dokuments (Yjs) für die Live-Bearbeitung; leer: aus `content` aufbauen
    ystate: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    # Reiner Text des Inhalts für die Suche
    text: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Zählt jede Speicherung; schützt vor dem Überschreiben fremder Änderungen
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default=sql_text("1"))
    own_rights: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_text("false")
    )
    locked_by_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Seit der letzten Version wird bearbeitet (für die automatische Version), und von wem
    editing_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    editors: Mapped[str] = mapped_column(String(500), default="", server_default="")
    created_by_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Papierkorb: gelöscht mit allen Unterseiten (gleicher Zeitpunkt); `deleted_root` ist die
    # Seite, die gelöscht wurde
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    deleted_by_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    deleted_root: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_text("false")
    )


class DokuPageRight(Base):
    """Eigenes Recht einer Person an einer Seite (nur wirksam mit `own_rights`)."""

    __tablename__ = "doku_page_rights"

    page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("doku_pages.id", ondelete="CASCADE"), primary_key=True
    )
    oid: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    role: Mapped[str] = mapped_column(String(16))
    changed_by_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DokuVersion(Base):
    """Ein gespeicherter Stand einer Seite: automatisch oder benannt."""

    __tablename__ = "doku_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("doku_pages.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # Benannte Versionen bleiben immer; leer: automatisch
    name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    # Wer seit der vorigen Version bearbeitet hat; Hinweis z. B. bei Wiederherstellung
    authors: Mapped[str] = mapped_column(String(500), default="", server_default="")
    note: Mapped[str] = mapped_column(String(300), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DokuThread(Base):
    """Kommentare zu einer Textstelle (D3). Die Stelle steht als Position im gemeinsamen
    Dokument (Yjs, relativ), dazu der markierte Text zur Anzeige, falls die Stelle wegfällt."""

    __tablename__ = "doku_threads"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("doku_pages.id", ondelete="CASCADE"), index=True
    )
    # {"from": base64, "to": base64}: Anfang und Ende als relative Position in Yjs
    anchor: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    quote: Mapped[str] = mapped_column(String(300), default="", server_default="")
    created_by_oid: Mapped[str] = mapped_column(String(64), default="", server_default="")
    created_by_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_name: Mapped[str] = mapped_column(String(256), default="", server_default="")


class DokuComment(Base):
    """Ein Beitrag in einem Kommentar-Faden; Erwähnungen als Objekt-IDs."""

    __tablename__ = "doku_comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    thread_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("doku_threads.id", ondelete="CASCADE"), index=True
    )
    author_oid: Mapped[str] = mapped_column(String(64), default="", server_default="")
    author_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    text: Mapped[str] = mapped_column(Text)
    mentions: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=sql_text("'[]'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
