"""Import der bisherigen Budget-Excel-Dateien: je Datei ein Vorgang, je Zeile eine Entscheidung.

Ablauf: Datei hochladen (Entwurf mit den erkannten Zeilen und Konten), prüfen und starten
(fehlende Konten werden angelegt), dann jede Zeile übernehmen oder überspringen. Übernehmen legt
je Zeile einen eigenen Budgetposten mit Partner an (Name aus der Bezeichnung, erwartete Kosten =
Betrag), keine Rechnung. Zeilen mit „Jährlich“ lassen sich danach in die
Planung übernehmen: Ihr Posten läuft dann im folgenden Geschäftsjahr weiter. Nur
`Budget.Manager`.
"""

import difflib
import re
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.models import User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.budget.documents import clean_name
from werkbank.modules.budget.excel_import import SheetError, account_key, parse_sheet
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetImport,
    BudgetImportRow,
    BudgetItem,
    BudgetPartner,
)
from werkbank.modules.budget.numbers import assign_item_number
from werkbank.modules.budget.settings import (
    YEAR_MAX,
    YEAR_MIN,
    fiscal_year_name,
    fiscal_year_of,
    load_settings,
)
from werkbank.modules.budget.xlsx_read import XlsxError, read_first_sheet

router = APIRouter(prefix="/api/budget/imports")

MODULE = "budget"
XLSX_TYPES = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
)
FILE_MAX_BYTES = 10 * 1024 * 1024
ROWS_MAX = 2000
STATUS_DRAFT = "entwurf"
STATUS_OPEN = "offen"
STATUS_DONE = "abgeschlossen"
# Abgebrochen: offene und übersprungene Zeilen sind gelöscht, übernommene bleiben als Nachweis
STATUS_CANCELLED = "abgebrochen"
ROW_OPEN = "offen"
ROW_TAKEN = "uebernommen"
ROW_SKIPPED = "uebersprungen"
TAX_RATES = (1900, 700, 0)
AMOUNT_MAX = 1_000_000_000_000
# Rechtsformen, die beim Vergleich von Firmennamen nicht zählen
LEGAL_FORMS = re.compile(
    r"\b(gmbh|ag|kg|ohg|gbr|ug|mbh|co|e\.?\s?k|e\.?\s?v|se|inc|ltd|llc|haftungsbeschränkt)\b\.?"
)
SIMILAR = 0.86

Manager = Annotated[CurrentUser, Depends(require_roles(Role.BUDGET_MANAGER))]
ImportId = Annotated[int, Path(ge=1)]
RowId = Annotated[int, Path(ge=1)]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _single_line(value: str) -> str:
    value = value.strip()
    if any(ord(char) < 32 for char in value):
        raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
    return value


def firm_key(name: str) -> str:
    """Vergleichsform eines Firmennamens: klein, ohne Rechtsform, Satzzeichen und Leerraum."""
    lowered = LEGAL_FORMS.sub(" ", name.casefold().replace("&", " und "))
    return " ".join(re.sub(r"[^\w]+", " ", lowered).split())


def net_from_gross(gross_cents: int, tax_rate_bp: int) -> int:
    """Netto aus Brutto, kaufmännisch gerundet."""
    divisor = 10_000 + tax_rate_bp
    return (gross_cents * 10_000 * 2 + divisor) // (2 * divisor)


def match_partner(
    firm: str, partners: list[BudgetPartner], decided: dict[str, Any]
) -> tuple[str, BudgetPartner | None]:
    """Vorschlag für den Rechnungssteller einer Zeile.

    entschieden: für diese Firma wurde schon gewählt; gefunden: gleicher Name;
    aehnlich: sehr ähnlicher Name; neu: kein passender Partner.
    """
    by_id = {partner.id: partner for partner in partners}
    chosen = decided.get(firm.casefold())
    if isinstance(chosen, int) and chosen in by_id:
        return "entschieden", by_id[chosen]
    for partner in partners:
        if partner.name.casefold() == firm.casefold():
            return "gefunden", partner
    key = firm_key(firm)
    if not key:
        return "neu", None
    best: tuple[float, BudgetPartner | None] = (0.0, None)
    for partner in partners:
        other = firm_key(partner.name)
        if other == key:
            return "aehnlich", partner
        ratio = difflib.SequenceMatcher(None, key, other).ratio()
        if ratio > best[0]:
            best = (ratio, partner)
    if best[1] is not None and best[0] >= SIMILAR:
        return "aehnlich", best[1]
    return "neu", None


# --- Schemas ------------------------------------------------------------------------------


class AccountOut(BaseModel):
    number: str
    name: str
    budget_cents: int | None
    # Konto in der Werkbank; None: wird beim Start angelegt
    account_id: int | None
    created: bool
    rows: int


class RowOut(BaseModel):
    id: int
    row_number: int
    invoice_date: date | None
    number: str
    internal_number: str
    firm: str
    description: str
    gross_cents: int
    account_number: str | None
    yearly: bool
    hints: list[str]
    status: str
    invoice_id: int | None
    planned_item_id: int | None
    # Vorschlag für den Partner (entschieden, gefunden, aehnlich, neu)
    partner_match: str
    partner_id: int | None
    partner_name: str | None
    # Budgetposten, den das Übernehmen angelegt hat
    item_id: int | None
    item_name: str | None


class ImportSummary(BaseModel):
    id: int
    file_name: str
    year: int
    year_name: str
    status: str
    rows: int
    open: int
    taken: int
    skipped: int
    created_at: datetime
    created_by: str | None
    finished_at: datetime | None


class ImportOut(ImportSummary):
    tax_rate_bp: int
    skipped_rows: int
    hints: int
    firms: int
    new_firms: int
    year_label: str
    accounts: list[AccountOut]
    rows_detail: list[RowOut]


class StartIn(BaseModel):
    year: int = Field(ge=YEAR_MIN, le=YEAR_MAX)
    tax_rate_bp: int = Field(default=1900)
    # Art je neu anzulegendem Konto (Kontonummer → laufend oder investition)
    kinds: dict[str, Literal["laufend", "investition"]] = Field(default_factory=dict)

    @field_validator("tax_rate_bp")
    @classmethod
    def known_rate(cls, value: int) -> int:
        if value not in TAX_RATES:
            raise ValueError("Steuersatz 19 %, 7 % oder 0 %")
        return value


class TakeIn(BaseModel):
    # Bezeichnung: wird der Name des Budgetpostens
    description: str = Field(default="", max_length=200)
    # Konto des neuen Budgetpostens
    account_id: int = Field(ge=1)
    # Erwartete Kosten (brutto, Betrag aus der Datei)
    gross_cents: int = Field(ge=0, le=AMOUNT_MAX)
    yearly: bool = False
    # Partner des Postens: vorhandener oder Name eines neuen (genau eins von beiden)
    partner_id: int | None = Field(default=None, ge=1)
    new_partner: str | None = Field(default=None, max_length=160)

    @field_validator("description")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("new_partner")
    @classmethod
    def plain_partner(cls, value: str | None) -> str | None:
        return _single_line(value) if value is not None else None


class PlanEntry(BaseModel):
    row_id: int = Field(ge=1)
    # Erwartete Kosten je Geschäftsjahr, gelten für die ganze Laufzeit des Postens
    amount_cents: int = Field(ge=0, le=AMOUNT_MAX)
    # True: bis auf Weiteres; False: nur noch im folgenden Geschäftsjahr
    ongoing: bool = True


class PlanIn(BaseModel):
    entries: list[PlanEntry] = Field(min_length=1, max_length=500)


class PlanOut(BaseModel):
    extended: int
    detail: ImportOut


# --- Hilfen -------------------------------------------------------------------------------


def _import(db: Session, import_id: int) -> BudgetImport:
    row: BudgetImport | None = db.get(BudgetImport, import_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return row


def _rows(db: Session, import_id: int) -> list[BudgetImportRow]:
    return list(
        db.scalars(
            select(BudgetImportRow)
            .where(BudgetImportRow.import_id == import_id)
            .order_by(BudgetImportRow.row_number, BudgetImportRow.id)
        ).all()
    )


def _counts(rows: list[BudgetImportRow]) -> tuple[int, int, int]:
    states = [row.status for row in rows]
    return states.count(ROW_OPEN), states.count(ROW_TAKEN), states.count(ROW_SKIPPED)


def _accounts_by_key(db: Session) -> dict[str, BudgetAccount]:
    return {account_key(row.number): row for row in db.scalars(select(BudgetAccount)).all()}


def _creator_names(db: Session, rows: list[BudgetImport]) -> dict[Any, str]:
    ids = {row.created_by for row in rows if row.created_by is not None}
    if not ids:
        return {}
    return {user.id: user.display_name for user in db.scalars(select(User).where(User.id.in_(ids)))}


def _summary(
    row: BudgetImport, rows: list[BudgetImportRow], names: dict[Any, str], start_month: int
) -> dict[str, Any]:
    open_rows, taken, skipped = _counts(rows)
    return {
        "id": row.id,
        "file_name": row.file_name,
        "year": row.year,
        "year_name": fiscal_year_name(row.year, start_month),
        "status": row.status,
        "rows": len(rows),
        "open": open_rows,
        "taken": taken,
        "skipped": skipped,
        "created_at": row.created_at,
        "created_by": names.get(row.created_by),
        "finished_at": row.finished_at,
    }


def _unique_item_name(db: Session, account_id: int, name: str) -> str:
    """Name des Postens im Konto eindeutig machen: „Mobilfunk“, „Mobilfunk (2)“, …"""
    base = name[:150]
    taken = {
        value.lower()
        for value in db.scalars(select(BudgetItem.name).where(BudgetItem.account_id == account_id))
    }
    if base.lower() not in taken:
        return base
    number = 2
    while f"{base} ({number})".lower() in taken:
        number += 1
    return f"{base} ({number})"


def _row_items(db: Session, rows: list[BudgetImportRow]) -> dict[int, BudgetItem]:
    """Budgetposten der übernommenen Zeilen, je Zeile."""
    item_ids = {entry.item_id for entry in rows if entry.item_id is not None}
    if not item_ids:
        return {}
    items = {
        item.id: item
        for item in db.scalars(select(BudgetItem).where(BudgetItem.id.in_(item_ids))).all()
    }
    return {
        entry.id: items[entry.item_id]
        for entry in rows
        if entry.item_id is not None and entry.item_id in items
    }


def detail_out(db: Session, row: BudgetImport) -> ImportOut:
    settings = load_settings(db)
    rows = _rows(db, row.id)
    partners = list(db.scalars(select(BudgetPartner).order_by(BudgetPartner.name)).all())
    accounts = _accounts_by_key(db)
    row_items = _row_items(db, rows)
    out_rows: list[RowOut] = []
    firms: dict[str, bool] = {}
    for entry in rows:
        match, partner = match_partner(entry.firm, partners, row.partners)
        if entry.firm:
            firms[entry.firm.casefold()] = match == "neu"
        item = row_items.get(entry.id)
        out_rows.append(
            RowOut(
                id=entry.id,
                row_number=entry.row_number,
                invoice_date=entry.invoice_date,
                number=entry.number,
                internal_number=entry.internal_number,
                firm=entry.firm,
                description=entry.description,
                gross_cents=entry.gross_cents,
                account_number=entry.account_number,
                yearly=entry.yearly,
                hints=list(entry.hints),
                status=entry.status,
                invoice_id=entry.invoice_id,
                planned_item_id=entry.planned_item_id,
                partner_match=match,
                partner_id=partner.id if partner else None,
                partner_name=partner.name if partner else None,
                item_id=item.id if item else None,
                item_name=item.name if item else None,
            )
        )
    account_rows: list[AccountOut] = []
    for info in row.accounts:
        number = str(info.get("number", ""))
        existing = accounts.get(account_key(number))
        account_rows.append(
            AccountOut(
                number=number,
                name=str(info.get("name", "")),
                budget_cents=info.get("budget_cents"),
                account_id=existing.id if existing else None,
                created=bool(info.get("created")),
                rows=sum(
                    1
                    for entry in rows
                    if entry.account_number
                    and account_key(entry.account_number) == account_key(number)
                ),
            )
        )
    names = _creator_names(db, [row])
    return ImportOut(
        **_summary(row, rows, names, settings.start_month),
        tax_rate_bp=row.tax_rate_bp,
        skipped_rows=row.skipped_rows,
        hints=sum(1 for entry in rows if entry.hints),
        firms=len(firms),
        new_firms=sum(1 for new in firms.values() if new),
        year_label=settings.year_label,
        accounts=account_rows,
        rows_detail=out_rows,
    )


def _year_hints(rows: list[BudgetImportRow], year: int, start_month: int) -> None:
    """Hinweis bei Rechnungsdaten außerhalb des Geschäftsjahrs (ersetzt einen alten)."""
    text = (
        f"Das Rechnungsdatum liegt außerhalb von {fiscal_year_name(year, start_month)}. "
        "Der Budgetposten wird trotzdem für dieses Geschäftsjahr angelegt."
    )
    for row in rows:
        hints = [hint for hint in row.hints if "außerhalb von" not in hint]
        if row.invoice_date is not None and fiscal_year_of(row.invoice_date, start_month) != year:
            hints.append(text)
        row.hints = hints


def _audit(
    db: Session,
    request: Request,
    user: CurrentUser,
    action: str,
    import_id: int,
    details: dict[str, object],
) -> None:
    write_audit(
        db,
        module=MODULE,
        action=f"budget.import_{action}",
        user_id=user.user_id,
        object_type="import",
        object_id=str(import_id),
        ip=client_ip(request),
        details=details,
    )


def _refresh_status(row: BudgetImport, rows: list[BudgetImportRow]) -> None:
    if row.status == STATUS_DRAFT:
        return
    if any(entry.status == ROW_OPEN for entry in rows):
        row.status = STATUS_OPEN
        row.finished_at = None
    elif row.status not in (STATUS_DONE, STATUS_CANCELLED):
        row.status = STATUS_DONE
        row.finished_at = now_utc()


# --- Endpunkte ----------------------------------------------------------------------------


@router.get("")
def list_imports(user: Manager, db: DbDep) -> list[ImportSummary]:
    """Alle gestarteten Vorgänge und die eigenen Entwürfe, neueste zuerst."""
    start_month = load_settings(db).start_month
    imports = list(
        db.scalars(
            select(BudgetImport)
            .where(
                (BudgetImport.status != STATUS_DRAFT) | (BudgetImport.created_by == user.user_id)
            )
            .order_by(BudgetImport.created_at.desc(), BudgetImport.id.desc())
        ).all()
    )
    names = _creator_names(db, imports)
    return [
        ImportSummary(**_summary(row, _rows(db, row.id), names, start_month)) for row in imports
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload(request: Request, user: Manager, db: DbDep) -> ImportOut:
    """Liest eine Excel-Datei und legt einen Entwurf an. Der Inhalt der Anfrage ist die Datei,
    der Dateiname steht im Kopf `X-Dateiname`. Die Datei selbst wird nicht gespeichert."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in XLSX_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Nur Excel-Dateien (.xlsx).",
        )
    too_large = HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=f"Die Datei ist größer als {FILE_MAX_BYTES // (1024 * 1024)} MB.",
    )
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > FILE_MAX_BYTES:
        raise too_large
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > FILE_MAX_BYTES:
            raise too_large
        chunks.append(chunk)
    try:
        parsed = parse_sheet(read_first_sheet(b"".join(chunks)))
    except (XlsxError, SheetError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
        ) from error
    if not parsed.rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="In der Datei steht keine Zeile mit einem Betrag.",
        )
    if len(parsed.rows) > ROWS_MAX:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Die Datei hat mehr als {ROWS_MAX} Zeilen.",
        )
    settings = load_settings(db)
    year = parsed.year or fiscal_year_of(now_utc().date(), settings.start_month)
    # Eigene Entwürfe ersetzen und alte Entwürfe aller wegräumen
    db.execute(
        delete(BudgetImport).where(
            BudgetImport.status == STATUS_DRAFT,
            (BudgetImport.created_by == user.user_id)
            | (BudgetImport.created_at < now_utc() - timedelta(days=1)),
        )
    )
    name = clean_name(request.headers.get("x-dateiname", "")).removesuffix(".pdf") or "Import.xlsx"
    if not name.lower().endswith(".xlsx"):
        name = f"{name}.xlsx"
    row = BudgetImport(
        file_name=name[:200],
        year=year,
        tax_rate_bp=1900,
        status=STATUS_DRAFT,
        accounts=[
            {"number": account.number, "name": account.name, "budget_cents": account.budget_cents}
            for account in parsed.accounts
        ],
        partners={},
        skipped_rows=parsed.skipped,
        created_by=user.user_id,
    )
    db.add(row)
    db.flush()
    rows = [
        BudgetImportRow(
            import_id=row.id,
            row_number=entry.row_number,
            invoice_date=entry.invoice_date,
            number=entry.number,
            internal_number=entry.internal_number,
            firm=entry.firm,
            description=entry.description,
            gross_cents=entry.gross_cents,
            account_number=entry.account_number,
            yearly=entry.yearly,
            hints=list(entry.hints),
            status=ROW_OPEN,
        )
        for entry in parsed.rows
    ]
    _year_hints(rows, year, settings.start_month)
    db.add_all(rows)
    _audit(db, request, user, "hochgeladen", row.id, {"datei": row.file_name, "zeilen": len(rows)})
    db.commit()
    return detail_out(db, row)


@router.get("/{import_id}")
def read_import(import_id: ImportId, user: Manager, db: DbDep) -> ImportOut:
    row = _import(db, import_id)
    if row.status == STATUS_DRAFT and row.created_by != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return detail_out(db, row)


@router.post("/{import_id}/start")
def start_import(
    request: Request, import_id: ImportId, body: StartIn, user: Manager, db: DbDep
) -> ImportOut:
    """Bestätigt den Entwurf: legt fehlende Konten an. Budgetposten entstehen erst je Zeile."""
    row = _import(db, import_id)
    if row.status != STATUS_DRAFT or row.created_by != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Import ist schon gestartet."
        )
    settings = load_settings(db)
    row.year = body.year
    row.tax_rate_bp = body.tax_rate_bp
    accounts = _accounts_by_key(db)
    created_accounts = 0
    infos: list[dict[str, Any]] = []
    for info in row.accounts:
        number = str(info.get("number", ""))
        account = accounts.get(account_key(number))
        created = False
        if account is None:
            account = BudgetAccount(
                number=number[:20],
                name=str(info.get("name") or f"Konto {number}")[:120],
                kind=body.kinds.get(number, "laufend"),
                note="",
                active=True,
            )
            db.add(account)
            db.flush()
            accounts[account_key(number)] = account
            created = True
            created_accounts += 1
        infos.append({**info, "account_id": account.id, "created": created})
    row.accounts = infos
    rows = _rows(db, row.id)
    _year_hints(rows, body.year, settings.start_month)
    row.status = STATUS_OPEN
    row.started_at = now_utc()
    _refresh_status(row, rows)
    _audit(
        db,
        request,
        user,
        "gestartet",
        row.id,
        {
            "datei": row.file_name,
            "jahr": body.year,
            "konten_angelegt": created_accounts,
            "zeilen": len(rows),
        },
    )
    db.commit()
    return detail_out(db, row)


def _row(db: Session, row: BudgetImport, row_id: int) -> BudgetImportRow:
    entry: BudgetImportRow | None = db.get(BudgetImportRow, row_id)
    if entry is None or entry.import_id != row.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if row.status == STATUS_DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Import ist noch nicht gestartet."
        )
    if row.status == STATUS_CANCELLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Import ist abgebrochen."
        )
    return entry


@router.post("/{import_id}/rows/{row_id}/take")
def take_row(
    request: Request,
    import_id: ImportId,
    row_id: RowId,
    body: TakeIn,
    user: Manager,
    db: DbDep,
) -> ImportOut:
    """Übernimmt eine Zeile als eigenen Budgetposten mit Partner, ohne Rechnung."""
    row = _import(db, import_id)
    entry = _row(db, row, row_id)
    if entry.status == ROW_TAKEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Die Zeile ist schon übernommen."
        )
    if (body.partner_id is None) == (not body.new_partner):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Bitte wähle einen Partner oder leg einen neuen an.",
        )
    account = db.get(BudgetAccount, body.account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Das Konto gibt es nicht.",
        )
    partner: BudgetPartner | None
    created_partner = False
    if body.partner_id is not None:
        partner = db.get(BudgetPartner, body.partner_id)
        if partner is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Den Partner gibt es nicht.",
            )
    else:
        name = (body.new_partner or "").strip()
        partner = db.scalars(
            select(BudgetPartner).where(func.lower(BudgetPartner.name) == name.lower())
        ).first()
        if partner is None:
            partner = BudgetPartner(
                name=name,
                is_contract_partner=False,
                is_invoicer=True,
                customer_number="",
                note=f"Angelegt beim Import {row.file_name}"[:500],
                active=True,
            )
            db.add(partner)
            db.flush()
            created_partner = True
    now = now_utc()
    # Je Zeile ein eigener Posten im Geschäftsjahr des Imports, ohne Rechnung;
    # erwartete Kosten = Betrag aus der Datei. Rechnungen werden später erfasst.
    number = entry.number or entry.internal_number
    source = " ".join(
        part
        for part in (
            f"Rechnung {number}" if number else "",
            f"vom {entry.invoice_date.strftime('%d.%m.%Y')}" if entry.invoice_date else "",
        )
        if part
    )
    item = BudgetItem(
        account_id=account.id,
        partner_id=partner.id,
        name=_unique_item_name(
            db, account.id, body.description or partner.name or f"Zeile {entry.row_number}"
        ),
        amount_cents=body.gross_cents,
        start_year=row.year,
        end_year=row.year,
        note=(
            f"Aus dem Import {row.file_name}, Zeile {entry.row_number}"
            + (f" ({source})" if source else "")
        )[:500],
        tags=[],
        active=True,
    )
    assign_item_number(db, item)
    db.add(item)
    db.flush()
    entry.status = ROW_TAKEN
    entry.item_id = item.id
    entry.yearly = body.yearly
    entry.done_by = user.user_id
    entry.done_at = now
    if entry.firm:
        row.partners = {**row.partners, entry.firm.casefold(): partner.id}
    _refresh_status(row, _rows(db, row.id))
    _audit(
        db,
        request,
        user,
        "zeile_uebernommen",
        row.id,
        {
            "zeile": entry.row_number,
            "partner_id": partner.id,
            "partner_neu": created_partner,
            "posten": item.id,
            "gross_cents": body.gross_cents,
        },
    )
    db.commit()
    return detail_out(db, row)


@router.post("/{import_id}/rows/{row_id}/skip")
def skip_row(
    request: Request, import_id: ImportId, row_id: RowId, user: Manager, db: DbDep
) -> ImportOut:
    row = _import(db, import_id)
    entry = _row(db, row, row_id)
    if entry.status == ROW_TAKEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Die Zeile ist schon übernommen."
        )
    entry.status = ROW_SKIPPED
    entry.done_by = user.user_id
    entry.done_at = now_utc()
    _refresh_status(row, _rows(db, row.id))
    _audit(db, request, user, "zeile_uebersprungen", row.id, {"zeile": entry.row_number})
    db.commit()
    return detail_out(db, row)


@router.post("/{import_id}/rows/{row_id}/reopen")
def reopen_row(
    request: Request, import_id: ImportId, row_id: RowId, user: Manager, db: DbDep
) -> ImportOut:
    """Setzt eine übersprungene Zeile zurück auf offen. Übernommene bleiben übernommen;
    ihre Rechnung ändert oder löscht man unter Rechnungen."""
    row = _import(db, import_id)
    entry = _row(db, row, row_id)
    if entry.status != ROW_SKIPPED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Nur übersprungene Zeilen lassen sich zurücksetzen.",
        )
    entry.status = ROW_OPEN
    entry.done_by = None
    entry.done_at = None
    _refresh_status(row, _rows(db, row.id))
    _audit(db, request, user, "zeile_zurueckgesetzt", row.id, {"zeile": entry.row_number})
    db.commit()
    return detail_out(db, row)


@router.post("/{import_id}/plan")
def plan_rows(
    request: Request, import_id: ImportId, body: PlanIn, user: Manager, db: DbDep
) -> PlanOut:
    """Übernimmt Zeilen mit „Jährlich“ in die Planung: Ihr Posten läuft im folgenden
    Geschäftsjahr weiter (bis auf Weiteres oder nur dieses eine Jahr)."""
    row = _import(db, import_id)
    if row.status == STATUS_DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Import ist noch nicht gestartet."
        )
    year = row.year + 1
    extended = 0
    for plan in body.entries:
        entry = db.get(BudgetImportRow, plan.row_id)
        if entry is None or entry.import_id != row.id or entry.status != ROW_TAKEN:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Nur übernommene Zeilen lassen sich in die Planung übernehmen.",
            )
        item = _row_items(db, [entry]).get(entry.id)
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Zu dieser Zeile gibt es keinen Budgetposten mehr.",
            )
        item.end_year = None if plan.ongoing else max(year, item.end_year or year)
        item.amount_cents = plan.amount_cents
        entry.planned_item_id = item.id
        extended += 1
    _audit(db, request, user, "planung", row.id, {"posten_verlaengert": extended})
    db.commit()
    return PlanOut(extended=extended, detail=detail_out(db, row))


@router.delete("/{import_id}/rows/{row_id}")
def delete_row(
    request: Request, import_id: ImportId, row_id: RowId, user: Manager, db: DbDep
) -> ImportOut:
    """Löscht eine offene oder übersprungene Zeile. Übernommene bleiben als Nachweis."""
    row = _import(db, import_id)
    entry = _row(db, row, row_id)
    if entry.status == ROW_TAKEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Übernommene Zeilen bleiben stehen; ihren Budgetposten änderst du dort.",
        )
    number = entry.row_number
    db.delete(entry)
    db.flush()
    _refresh_status(row, _rows(db, row.id))
    _audit(db, request, user, "zeile_geloescht", row.id, {"zeile": number})
    db.commit()
    return detail_out(db, row)


@router.post("/{import_id}/cancel")
def cancel_import(request: Request, import_id: ImportId, user: Manager, db: DbDep) -> ImportOut:
    """Bricht den Import ab: offene und übersprungene Zeilen werden gelöscht, übernommene Zeilen
    und ihre Budgetposten bleiben. Der Vorgang steht danach als „abgebrochen“ in der Liste."""
    row = _import(db, import_id)
    if row.status == STATUS_DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ein Entwurf wird verworfen, nicht abgebrochen.",
        )
    if row.status == STATUS_CANCELLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Import ist schon abgebrochen."
        )
    removed = 0
    for entry in _rows(db, row.id):
        if entry.status != ROW_TAKEN:
            db.delete(entry)
            removed += 1
    row.status = STATUS_CANCELLED
    row.finished_at = now_utc()
    _audit(db, request, user, "abgebrochen", row.id, {"zeilen_geloescht": removed})
    db.commit()
    return detail_out(db, row)


@router.delete("/{import_id}")
def delete_import(
    request: Request, import_id: ImportId, user: Manager, db: DbDep
) -> dict[str, bool]:
    """Löscht den Vorgang. Übernommene Rechnungen, Konten und Posten bleiben."""
    row = _import(db, import_id)
    if row.status == STATUS_DRAFT and row.created_by != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    name = row.file_name
    db.delete(row)
    _audit(db, request, user, "geloescht", import_id, {"datei": name})
    db.commit()
    return {"deleted": True}
