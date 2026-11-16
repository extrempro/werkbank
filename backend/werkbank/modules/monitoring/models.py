"""Tabellen des Bereichs IT-Monitoring."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class MonDnsRun(Base):
    """Ein Lauf des DNS-Abgleichs mit NetBox (Zahlen bleiben 90 Tage für den Verlauf)."""

    __tablename__ = "mon_dns_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # „ok“ oder „fehlgeschlagen“ (NetBox nicht lesbar o. Ä.; einzelne DNS-Fehler zählen als Zeile)
    status: Mapped[str] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(Text)
    zones: Mapped[int] = mapped_column(Integer, default=0)
    records: Mapped[int] = mapped_column(Integer, default=0)
    queries: Mapped[int] = mapped_column(Integer, default=0)
    # Zahl der Zeilen je Status, z. B. {"ok": 120, "abweichend": 2}
    counts: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Extern verwaltete Subdomains und Hinweise des Laufs
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class MonDnsRow(Base):
    """Ergebnis eines Namens und Typs in einem Lauf. Nur die letzten Läufe behalten Zeilen."""

    __tablename__ = "mon_dns_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("mon_dns_runs.id", ondelete="CASCADE"), index=True
    )
    # Name|Typ, z. B. „www.example.com|A“
    key: Mapped[str] = mapped_column(String(300))
    fqdn: Mapped[str] = mapped_column(String(260))
    type: Mapped[str] = mapped_column(String(12))
    zone: Mapped[str] = mapped_column(String(260))
    status: Mapped[str] = mapped_column(String(20))
    # netbox, inactive, public, missing, extra, notes (Listen von Texten), netbox_url
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
