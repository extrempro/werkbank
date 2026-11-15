"""Tabellen des Moduls IT-Budget (Konten und Plan je Geschäftsjahr)."""

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
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class BudgetAccount(Base):
    """Ein Konto des IT-Budgets. Konten werden nicht gelöscht, nur stillgelegt."""

    __tablename__ = "budget_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Kontonummer aus der Buchhaltung, frei wählbar
    number: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    # „laufend“ (laufende Kosten) oder „investition“
    kind: Mapped[str] = mapped_column(String(16))
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetPlan(Base):
    """Geplanter Betrag (brutto, in Cent) eines Kontos in einem Geschäftsjahr."""

    __tablename__ = "budget_plans"

    account_id: Mapped[int] = mapped_column(
        ForeignKey("budget_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    # Kalenderjahr, in dem das Geschäftsjahr beginnt
    fiscal_year: Mapped[int] = mapped_column(Integer, primary_key=True)
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class BudgetPartner(Base):
    """Ein Vertragspartner oder Rechnungssteller (Firma, keine Person)."""

    __tablename__ = "budget_partners"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    is_contract_partner: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    is_invoicer: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # Die eigene Kundennummer bei diesem Partner
    customer_number: Mapped[str] = mapped_column(String(60), default="", server_default="")
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetContract(Base):
    """Ein Vertrag, dessen Kosten auf ein Konto des Budgets laufen."""

    __tablename__ = "budget_contracts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    partner_id: Mapped[int] = mapped_column(ForeignKey("budget_partners.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("budget_accounts.id"), index=True)
    # Rechnungssteller, wenn er vom Vertragspartner abweicht (z. B. ein Distributor)
    invoicer_id: Mapped[int | None] = mapped_column(ForeignKey("budget_partners.id"))
    # Auftragsverarbeitungsvertrag: vorhanden, fehlt oder nicht_erforderlich
    dpa_status: Mapped[str] = mapped_column(
        String(20), default="nicht_erforderlich", server_default="nicht_erforderlich"
    )
    # Vertragsnummer beim Partner
    number: Mapped[str] = mapped_column(String(60), default="", server_default="")
    starts_on: Mapped[date] = mapped_column(Date)
    # Ende der Laufzeit; None: unbefristet
    ends_on: Mapped[date | None] = mapped_column(Date)
    # Verlängert sich nach dem Ende um so viele Monate, wenn nicht gekündigt wird
    renewal_months: Mapped[int | None] = mapped_column(Integer)
    # Kündigungsfrist in Monaten vor dem Ende der Laufzeit
    notice_months: Mapped[int | None] = mapped_column(Integer)
    # Gekündigt zu diesem Tag; danach fallen keine Kosten mehr an
    cancelled_to: Mapped[date | None] = mapped_column(Date)
    # Betrag je Zahlung, brutto in Cent
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    # monatlich, vierteljaehrlich, halbjaehrlich, jaehrlich oder einmalig
    interval: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
