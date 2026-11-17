"""Import der bisherigen Budget-Excel-Dateien: je Datei ein Vorgang, je Zeile eine Entscheidung.

Ablauf: Datei hochladen (Entwurf mit den erkannten Zeilen und Konten), prüfen und starten
(fehlende Konten und je Konto ein Posten „Allgemein <Jahr>“ werden angelegt), dann jede Zeile
übernehmen (gebuchte Rechnung mit einer Position) oder überspringen. Zeilen mit „Jährlich“ lassen
sich danach als Budgetposten für das folgende Geschäftsjahr anlegen. Nur `Budget.Manager`.
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
    BudgetInvoice,
    BudgetInvoiceLine,
    BudgetItem,
    BudgetPartner,
)
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
    # Posten „Allgemein <Jahr>“, sobald der Vorgang gestartet ist
    item_id: int | None
    item_name: str
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
    # Vorschläge: Partner (entschieden, gefunden, aehnlich, neu) und Budgetposten
    partner_match: str
    partner_id: int | None
    partner_name: str | None
    item_id: int | None


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
    invoice_date: date
    number: str = Field(min_length=1, max_length=80)
    internal_number: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=200)
    item_id: int = Field(ge=1)
    gross_cents: int = Field(ge=0, le=AMOUNT_MAX)
    tax_rate_bp: int = 1900
    yearly: bool = False
    # Vorhandener Partner oder Name eines neuen (genau eins von beiden)
    partner_id: int | None = Field(default=None, ge=1)
    new_partner: str | None = Field(default=None, max_length=160)

    @field_validator("number", "internal_number", "description")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("new_partner")
    @classmethod
    def plain_partner(cls, value: str | None) -> str | None:
        return _single_line(value) if value is not None else None

    @field_validator("tax_rate_bp")
    @classmethod
    def known_rate(cls, value: int) -> int:
        if value not in TAX_RATES:
            raise ValueError("Steuersatz 19 %, 7 % oder 0 %")
        return value

    @field_validator("invoice_date")
    @classmethod
    def in_range(cls, value: date) -> date:
        if not YEAR_MIN <= value.year <= YEAR_MAX:
            raise ValueError("Das Datum liegt außerhalb des erlaubten Bereichs")
        return value


class PlanEntry(BaseModel):
    row_id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=160)
    amount_cents: int = Field(ge=0, le=AMOUNT_MAX)
    # True: bis auf Weiteres; False: nur im folgenden Geschäftsjahr
    ongoing: bool = True

    @field_validator("name")
    @classmethod
    def plain(cls, value: str) -> str:
        value = _single_line(value)
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


class PlanIn(BaseModel):
    entries: list[PlanEntry] = Field(min_length=1, max_length=500)


class PlanOut(BaseModel):
    created: int
    existing: list[str]
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


def _item_name(year: int, start_month: int) -> str:
    return f"Allgemein {fiscal_year_name(year, start_month)}"


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


def _item_for(
    db: Session,
    row: BudgetImport,
    account_number: str | None,
    accounts: dict[str, BudgetAccount],
    start_month: int,
) -> BudgetItem | None:
    """Posten „Allgemein <Jahr>“ des Kontos einer Zeile, sofern es ihn gibt."""
    if account_number is None:
        return None
    account = accounts.get(account_key(account_number))
    if account is None:
        return None
    item: BudgetItem | None = db.scalars(
        select(BudgetItem).where(
            BudgetItem.account_id == account.id,
            func.lower(BudgetItem.name) == _item_name(row.year, start_month).lower(),
        )
    ).first()
    return item


def detail_out(db: Session, row: BudgetImport) -> ImportOut:
    settings = load_settings(db)
    rows = _rows(db, row.id)
    partners = list(db.scalars(select(BudgetPartner).order_by(BudgetPartner.name)).all())
    accounts = _accounts_by_key(db)
    items_cache: dict[str | None, BudgetItem | None] = {}

    def item_for(number: str | None) -> BudgetItem | None:
        if number not in items_cache:
            items_cache[number] = _item_for(db, row, number, accounts, settings.start_month)
        return items_cache[number]

    out_rows: list[RowOut] = []
    firms: dict[str, bool] = {}
    for entry in rows:
        match, partner = match_partner(entry.firm, partners, row.partners)
        if entry.firm:
            firms[entry.firm.casefold()] = match == "neu"
        item = item_for(entry.account_number)
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
            )
        )
    account_rows: list[AccountOut] = []
    for info in row.accounts:
        number = str(info.get("number", ""))
        existing = accounts.get(account_key(number))
        item = item_for(number) if existing else None
        account_rows.append(
            AccountOut(
                number=number,
                name=str(info.get("name", "")),
                budget_cents=info.get("budget_cents"),
                account_id=existing.id if existing else None,
                created=bool(info.get("created")),
                item_id=item.id if item else None,
                item_name=_item_name(row.year, settings.start_month),
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
        "Die Rechnung zählt im Geschäftsjahr ihres Datums."
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
    elif row.status != STATUS_DONE:
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
    """Bestätigt den Entwurf: legt fehlende Konten und je Konto den Posten „Allgemein <Jahr>“ an."""
    row = _import(db, import_id)
    if row.status != STATUS_DRAFT or row.created_by != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Import ist schon gestartet."
        )
    settings = load_settings(db)
    row.year = body.year
    row.tax_rate_bp = body.tax_rate_bp
    accounts = _accounts_by_key(db)
    item_name = _item_name(body.year, settings.start_month)
    created_accounts = 0
    created_items = 0
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
        item = db.scalars(
            select(BudgetItem).where(
                BudgetItem.account_id == account.id,
                func.lower(BudgetItem.name) == item_name.lower(),
            )
        ).first()
        if item is None:
            budget = info.get("budget_cents")
            item = BudgetItem(
                account_id=account.id,
                name=item_name,
                amount_cents=budget if isinstance(budget, int) and budget > 0 else 0,
                start_year=body.year,
                end_year=body.year,
                note=f"Aus dem Import {row.file_name}"[:500],
                tags=[],
                active=True,
            )
            db.add(item)
            db.flush()
            created_items += 1
        infos.append({**info, "account_id": account.id, "created": created, "item_id": item.id})
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
            "posten_angelegt": created_items,
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
    """Übernimmt eine Zeile als gebuchte Rechnung mit einer Position."""
    row = _import(db, import_id)
    entry = _row(db, row, row_id)
    if entry.status == ROW_TAKEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Die Zeile ist schon übernommen."
        )
    if (body.partner_id is None) == (not body.new_partner):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Bitte einen Partner wählen oder einen neuen anlegen.",
        )
    if db.get(BudgetItem, body.item_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Den Budgetposten gibt es nicht.",
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
    duplicate = (
        None
        if created_partner
        else db.scalars(
            select(BudgetInvoice).where(
                BudgetInvoice.invoicer_id == partner.id,
                func.lower(BudgetInvoice.number) == body.number.lower(),
            )
        ).first()
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Die Rechnung {body.number} von {partner.name} gibt es schon. "
            "Überspringe die Zeile oder ändere die Nummer.",
        )
    net = net_from_gross(body.gross_cents, body.tax_rate_bp)
    now = now_utc()
    invoice = BudgetInvoice(
        invoicer_id=partner.id,
        number=body.number,
        internal_number=body.internal_number,
        invoice_date=body.invoice_date,
        net_cents=net,
        gross_cents=body.gross_cents,
        status="gebucht",
        created_by=user.user_id,
        booked_by=user.user_id,
        booked_at=now,
    )
    invoice.lines = [
        BudgetInvoiceLine(
            position=0,
            item_id=body.item_id,
            net_cents=net,
            tax_rate_bp=body.tax_rate_bp,
            gross_cents=body.gross_cents,
            description=body.description,
            is_project=False,
            is_yearly=body.yearly,
            # Der Posten „Allgemein“ sammelt viele Rechnungen und bleibt offen.
            closes_item=False,
        )
    ]
    db.add(invoice)
    db.flush()
    entry.status = ROW_TAKEN
    entry.invoice_id = invoice.id
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
            "rechnung": invoice.id,
            "partner_id": partner.id,
            "partner_neu": created_partner,
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
    """Legt aus übernommenen Zeilen mit „Jährlich“ Budgetposten ab dem folgenden Jahr an."""
    row = _import(db, import_id)
    if row.status == STATUS_DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Import ist noch nicht gestartet."
        )
    year = row.year + 1
    created = 0
    existing: list[str] = []
    for plan in body.entries:
        entry = db.get(BudgetImportRow, plan.row_id)
        if (
            entry is None
            or entry.import_id != row.id
            or entry.status != ROW_TAKEN
            or entry.invoice_id is None
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Nur übernommene Zeilen lassen sich in die Planung übernehmen.",
            )
        line = db.scalars(
            select(BudgetInvoiceLine).where(BudgetInvoiceLine.invoice_id == entry.invoice_id)
        ).first()
        source = db.get(BudgetItem, line.item_id) if line is not None else None
        if source is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Zu dieser Zeile gibt es keine Rechnung mehr.",
            )
        other = db.scalars(
            select(BudgetItem).where(
                BudgetItem.account_id == source.account_id,
                func.lower(BudgetItem.name) == plan.name.lower(),
            )
        ).first()
        if other is not None:
            existing.append(plan.name)
            entry.planned_item_id = entry.planned_item_id or other.id
            continue
        item = BudgetItem(
            account_id=source.account_id,
            name=plan.name,
            amount_cents=plan.amount_cents,
            start_year=year,
            end_year=None if plan.ongoing else year,
            note=f"Aus dem Import {row.file_name}, Zeile {entry.row_number}"[:500],
            tags=[],
            active=True,
        )
        db.add(item)
        db.flush()
        entry.planned_item_id = item.id
        created += 1
    _audit(
        db,
        request,
        user,
        "planung",
        row.id,
        {"posten_angelegt": created, "schon_da": len(existing)},
    )
    db.commit()
    return PlanOut(created=created, existing=existing, detail=detail_out(db, row))


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
