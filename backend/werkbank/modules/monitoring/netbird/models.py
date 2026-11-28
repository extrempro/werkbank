"""Tabellen für NetBird. Die Werkbank liest NetBird nur; gespeichert werden der jüngste Stand
und Tageswerte für die Verläufe (90 Tage)."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Integer, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class NbState(Base):
    """Jüngster Stand (immer genau eine Zeile, id 1)."""

    __tablename__ = "mon_nb_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)


class NbRun(Base):
    """Ein Abruf: gelungen oder mit Fehler."""

    __tablename__ = "mon_nb_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(String(500))


class NbDaily(Base):
    """Höchstzahl gleichzeitig verbundener Peers je Tag (Ortszeit)."""

    __tablename__ = "mon_nb_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    max_connected: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)


class NbPeerDay(Base):
    """Ein Peer war an diesem Tag (Ortszeit) mindestens einmal verbunden."""

    __tablename__ = "mon_nb_peer_days"

    peer_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True, index=True)


class NbEvent(Base):
    """Ein Eintrag aus dem Ereignisprotokoll von NetBird (90 Tage)."""

    __tablename__ = "mon_nb_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    code: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(20), index=True)
    activity: Mapped[str] = mapped_column(String(255))
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    initiator: Mapped[str] = mapped_column(String(255))
    initiator_id: Mapped[str] = mapped_column(String(255))
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB)


class NbPolicySeen(Base):
    """Beobachteter Stand einer Richtlinie: wann zuletzt geändert, seit wann deaktiviert."""

    __tablename__ = "mon_nb_policies_seen"

    policy_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64))
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NbHint(Base):
    """Offener Hinweis; verschwindet, sobald er nicht mehr zutrifft (für die Glocke)."""

    __tablename__ = "mon_nb_hints"

    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    level: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(300))
    link: Mapped[str] = mapped_column(String(300))
    since: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class NbCheck(Base):
    """Ein HTTPS-Abruf eines Dienstes am Reverse Proxy (für die Verfügbarkeit über 30 Tage)."""

    __tablename__ = "mon_nb_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[str] = mapped_column(String(64), index=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ok: Mapped[bool] = mapped_column(Boolean)
    status_code: Mapped[int | None] = mapped_column(SmallInteger)
    ms: Mapped[int | None] = mapped_column(Integer)
