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
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
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


class BudgetItem(Base):
    """Ein Budgetposten: wofür das Geld eines Kontos gedacht ist. Wird nur stillgelegt."""

    __tablename__ = "budget_items"
    __table_args__ = (UniqueConstraint("account_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("budget_accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    # Üblicher Partner dieses Postens; beim Erfassen einer Rechnung vorausgewählt
    partner_id: Mapped[int | None] = mapped_column(ForeignKey("budget_partners.id"), index=True)
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    # Frei vergebene Schlagworte, über die sich Posten suchen und auswerten lassen
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetStatistic(Base):
    """Eine gespeicherte Auswertung nach Tags. Für alle Rollen des Budgets sichtbar."""

    __tablename__ = "budget_statistics"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    # „any“: einer der Tags reicht; „all“: alle Tags müssen am Posten stehen
    mode: Mapped[str] = mapped_column(String(8))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetYear(Base):
    """Stand der Planung eines Geschäftsjahrs. Ohne Zeile gilt das Jahr als Entwurf."""

    __tablename__ = "budget_years"

    fiscal_year: Mapped[int] = mapped_column(Integer, primary_key=True)
    # entwurf oder freigegeben
    status: Mapped[str] = mapped_column(String(16))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    released_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class BudgetPlan(Base):
    """Geplanter Betrag (brutto, in Cent) eines Budgetpostens in einem Geschäftsjahr."""

    __tablename__ = "budget_plans"

    item_id: Mapped[int] = mapped_column(
        ForeignKey("budget_items.id", ondelete="CASCADE"), primary_key=True
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
    # Budgetposten, auf den die Kosten laufen; über ihn ergibt sich das Konto
    item_id: Mapped[int] = mapped_column(ForeignKey("budget_items.id"), index=True)
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
    # Betrag je Zahlung netto in Cent und Steuersatz in Hundertstel Prozent (1900 = 19 %)
    net_cents: Mapped[int] = mapped_column(BigInteger)
    tax_rate_bp: Mapped[int] = mapped_column(Integer, default=1900, server_default="1900")
    # Betrag je Zahlung brutto in Cent, aus Netto und Steuersatz gerechnet; zählt fürs Budget
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    # monatlich, vierteljaehrlich, halbjaehrlich, jaehrlich oder einmalig
    interval: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetInvoice(Base):
    """Eine Rechnung. Erst gebucht zählt sie zum Ist ihres Budgetpostens."""

    __tablename__ = "budget_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoicer_id: Mapped[int] = mapped_column(ForeignKey("budget_partners.id"), index=True)
    # Rechnungsnummer des Rechnungsstellers und die eigene interne Nummer
    number: Mapped[str] = mapped_column(String(80))
    internal_number: Mapped[str] = mapped_column(String(60), default="", server_default="")
    # Rechnungsdatum; es entscheidet über das Geschäftsjahr
    invoice_date: Mapped[date] = mapped_column(Date, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("budget_items.id"), index=True)
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("budget_contracts.id"), index=True)
    net_cents: Mapped[int] = mapped_column(BigInteger)
    tax_rate_bp: Mapped[int] = mapped_column(Integer)
    # Brutto: aus Netto und Steuersatz gerechnet oder um wenige Cent von Hand angepasst
    gross_cents: Mapped[int] = mapped_column(BigInteger)
    description: Mapped[str] = mapped_column(String(200), default="", server_default="")
    is_project: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    is_yearly: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # zu_pruefen oder gebucht
    status: Mapped[str] = mapped_column(String(16), index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    booked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    booked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # PDF-Beleg: Dateiname zur Anzeige, zufälliger Name der Datei in der Ablage, Größe in Bytes
    doc_name: Mapped[str | None] = mapped_column(String(200))
    doc_key: Mapped[str | None] = mapped_column(String(64))
    doc_size: Mapped[int | None] = mapped_column(Integer)
