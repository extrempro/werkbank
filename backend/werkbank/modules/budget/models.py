"""Tabellen des Moduls IT-Budget (Konten und Plan je Geschäftsjahr)."""

import uuid
from datetime import date, datetime
from typing import Any

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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from werkbank.db import Base

# Budgetposten verweisen auf Projekte; die Tabelle muss mit registriert sein.
from werkbank.modules.projects import models as _projects_models  # noqa: F401


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
    """Ein Budgetposten: ein Vorhaben mit erwarteten Kosten je Geschäftsjahr und Laufzeit.

    Der Status je Geschäftsjahr (offen, Rechnung liegt vor, abgeschlossen) ergibt sich aus den
    Rechnungspositionen und wird nicht gespeichert.
    """

    __tablename__ = "budget_items"
    __table_args__ = (
        UniqueConstraint("account_id", "name"),
        UniqueConstraint("number_year", "number_seq"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Feste Nummer BP-<Jahr>-<laufende Nummer>: das Jahr ist das erste Geschäftsjahr beim
    # Anlegen, die laufende Nummer zählt je Jahr hoch. Sie ändert sich danach nie.
    number_year: Mapped[int] = mapped_column(Integer)
    number_seq: Mapped[int] = mapped_column(Integer)
    account_id: Mapped[int] = mapped_column(ForeignKey("budget_accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    # Erwartete Kosten je Geschäftsjahr (brutto, in Cent); gelten in jedem Jahr der Laufzeit
    amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"))
    # Dasselbe netto und der Steuersatz in Hundertstel Prozent (1900 = 19 %); fürs Budget zählt
    # das Brutto. Ältere Posten wurden mit 19 % aus dem Brutto zurückgerechnet.
    net_cents: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"))
    tax_rate_bp: Mapped[int] = mapped_column(Integer, default=1900, server_default=text("1900"))
    # Laufzeit in Geschäftsjahren (Kalenderjahr des Beginns). Ohne Ende: bis auf Weiteres.
    start_year: Mapped[int] = mapped_column(Integer, index=True)
    end_year: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    # Frei vergebene Schlagworte, über die sich Posten suchen und auswerten lassen
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # IT-Projekt, zu dem der Posten gehört (höchstens eins); seine Kosten zählen dort mit
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    # Partner (Firma) des Postens; Pflicht beim Anlegen und Ändern. Ältere Posten haben noch
    # keinen, bis sie bearbeitet werden. Rechnungen haben ihren eigenen Rechnungssteller.
    partner_id: Mapped[int | None] = mapped_column(ForeignKey("budget_partners.id"), index=True)
    partner: Mapped["BudgetPartner | None"] = relationship(lazy="selectin")  # noqa: UP037
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetItemClosure(Base):
    """Ein Budgetposten, der in einem Geschäftsjahr von Hand abgeschlossen ist („abhaken“).

    Daneben schließt auch eine gebuchte Rechnungsposition mit „Schließt den Budgetposten ab“
    den Posten; das steht an der Position, nicht hier.
    """

    __tablename__ = "budget_item_closures"

    item_id: Mapped[int] = mapped_column(
        ForeignKey("budget_items.id", ondelete="CASCADE"), primary_key=True
    )
    # Geschäftsjahr (Kalenderjahr des Beginns)
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    closed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetTag(Base):
    """Ein Tag aus der Liste, die der Budgetverwalter pflegt. Posten wählen nur aus dieser Liste."""

    __tablename__ = "budget_tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(30), unique=True)
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
    """Ein Vertrag mit Partner, Kosten und Fristen. Er ist Budgetposten nur zugeordnet;
    ins Budget gehen seine Kosten allein über die Rechnungspositionen."""

    __tablename__ = "budget_contracts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    partner_id: Mapped[int] = mapped_column(ForeignKey("budget_partners.id"), index=True)
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


class BudgetContractItem(Base):
    """Zuordnung eines Vertrags zu einem Budgetposten: Ein Vertrag kann mehrere Posten haben,
    ein Posten höchstens einen Vertrag."""

    __tablename__ = "budget_contract_items"

    contract_id: Mapped[int] = mapped_column(
        ForeignKey("budget_contracts.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[int] = mapped_column(
        ForeignKey("budget_items.id"), primary_key=True, unique=True
    )


class BudgetInvoice(Base):
    """Eine Rechnung mit ihren Positionen. Erst gebucht zählt sie zum Ist der Budgetposten."""

    __tablename__ = "budget_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoicer_id: Mapped[int] = mapped_column(ForeignKey("budget_partners.id"), index=True)
    # Rechnungsnummer des Rechnungsstellers und die eigene interne Nummer
    number: Mapped[str] = mapped_column(String(80))
    internal_number: Mapped[str] = mapped_column(String(60), default="", server_default="")
    # Rechnungsdatum; es entscheidet über das Geschäftsjahr
    invoice_date: Mapped[date] = mapped_column(Date, index=True)
    # Summen der Positionen
    net_cents: Mapped[int] = mapped_column(BigInteger)
    gross_cents: Mapped[int] = mapped_column(BigInteger)
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

    # SQLAlchemy liest die Annotation sofort, die Klasse steht weiter unten: Anführungszeichen
    lines: Mapped[list["BudgetInvoiceLine"]] = relationship(  # noqa: UP037
        order_by="BudgetInvoiceLine.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )


class BudgetInvoiceLine(Base):
    """Eine Position einer Rechnung: ein Betrag für genau einen Budgetposten.
    Den Vertrag gibt der Budgetposten vor."""

    __tablename__ = "budget_invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("budget_invoices.id", ondelete="CASCADE"), index=True
    )
    # Reihenfolge auf der Rechnung, ab 0
    position: Mapped[int] = mapped_column(Integer)
    item_id: Mapped[int] = mapped_column(ForeignKey("budget_items.id"), index=True)
    net_cents: Mapped[int] = mapped_column(BigInteger)
    tax_rate_bp: Mapped[int] = mapped_column(Integer)
    # Brutto: aus Netto und Steuersatz gerechnet oder um wenige Cent von Hand angepasst
    gross_cents: Mapped[int] = mapped_column(BigInteger)
    description: Mapped[str] = mapped_column(String(200), default="", server_default="")
    is_project: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    is_yearly: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # Schließt den Budgetposten für das Geschäftsjahr der Rechnung ab, sobald sie gebucht ist.
    # Abschlags- und Vertragsrechnungen lassen ihn offen.
    closes_item: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class BudgetImport(Base):
    """Ein Import aus einer Excel-Datei: ein Vorgang, dessen Zeilen einzeln abgearbeitet werden.

    entwurf: hochgeladen, noch nicht bestätigt; offen: Zeilen werden abgearbeitet;
    abgeschlossen: keine offene Zeile mehr. Die Datei selbst wird nicht gespeichert.
    """

    __tablename__ = "budget_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String(200))
    # Geschäftsjahr (Kalenderjahr des Beginns) und Vorgabe für den Steuersatz der Zeilen
    year: Mapped[int] = mapped_column(Integer)
    tax_rate_bp: Mapped[int] = mapped_column(Integer, default=1900, server_default="1900")
    status: Mapped[str] = mapped_column(String(16), index=True)
    # Konten aus der Datei: [{number, name, budget_cents, account_id, created, item_id}]
    accounts: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    # Entscheidung je Firma (kleingeschrieben) → Partner-ID; gilt für alle Zeilen der Firma
    partners: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BudgetImportRow(Base):
    """Eine Zeile eines Imports. offen, uebernommen (mit Rechnung) oder uebersprungen."""

    __tablename__ = "budget_import_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_id: Mapped[int] = mapped_column(
        ForeignKey("budget_imports.id", ondelete="CASCADE"), index=True
    )
    # Zeile in der Excel-Datei
    row_number: Mapped[int] = mapped_column(Integer)
    invoice_date: Mapped[date | None] = mapped_column(Date)
    number: Mapped[str] = mapped_column(String(80), default="", server_default="")
    internal_number: Mapped[str] = mapped_column(String(60), default="", server_default="")
    firm: Mapped[str] = mapped_column(String(160), default="", server_default="")
    description: Mapped[str] = mapped_column(String(200), default="", server_default="")
    gross_cents: Mapped[int] = mapped_column(BigInteger)
    account_number: Mapped[str | None] = mapped_column(String(20))
    yearly: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    hints: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    status: Mapped[str] = mapped_column(String(16), default="offen", server_default="offen")
    invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_invoices.id", ondelete="SET NULL")
    )
    # Budgetposten, den das Übernehmen der Zeile angelegt hat
    item_id: Mapped[int | None] = mapped_column(ForeignKey("budget_items.id", ondelete="SET NULL"))
    # Posten, der für die Planung ins folgende Geschäftsjahr verlängert wurde
    planned_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_items.id", ondelete="SET NULL")
    )
    done_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
