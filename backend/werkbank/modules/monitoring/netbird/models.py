"""Tabellen für NetBird. Die Werkbank liest NetBird nur; gespeichert werden der jüngste Stand
und Tageswerte für die Verläufe (90 Tage)."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Integer, String
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
