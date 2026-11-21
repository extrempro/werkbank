"""Erkennt in einem Blatt der bisherigen Budget-Excel-Dateien Rechnungszeilen und Konten.

Aufbau der Dateien: oben eine Überschrift mit dem Geschäftsjahr („… 2026 / 2027“), darunter eine
Zeile mit den Kontonummern über den Kontospalten und die Kopfzeile der Tabelle (Rech.Nr., Firma,
Kosten, Datum, RE, Bezeichnung, Projekte, je Konto eine Spalte, Jährlich). Jede Rechnung steht in
einer Zeile; der Betrag steht unter „Kosten“ (brutto) und noch einmal in der Spalte ihres Kontos.
Unter der Tabelle folgen eine Summenzeile und je Konto Nummer, Budget und Bezeichnung.
Die Spalten „Kostenstelle“ (die erste) und „Projekte“ werden nicht übernommen.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime

from werkbank.modules.budget.xlsx_read import Cell, Sheet, excel_date

# Höchstbetrag wie im Budget: 10 Milliarden Euro in Cent
AMOUNT_MAX = 1_000_000_000_000
YEAR_PATTERN = re.compile(r"(20\d{2})\s*/\s*(20\d{2})")
DAY_PATTERN = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")
YES = {"x", "ja", "j", "1", "true", "wahr", "jährlich", "jaehrlich", "yes"}


class SheetError(ValueError):
    """Im Blatt fehlt etwas, das der Import braucht."""


@dataclass
class ParsedRow:
    row_number: int
    invoice_date: date | None
    number: str
    internal_number: str
    firm: str
    description: str
    gross_cents: int
    account_number: str | None
    yearly: bool
    # Hinweise beim Lesen (ohne Geschäftsjahr; das prüft der Aufrufer)
    hints: list[str] = field(default_factory=list)


@dataclass
class ParsedAccount:
    number: str
    name: str
    budget_cents: int | None


@dataclass
class ParsedFile:
    title: str
    # Erstes Kalenderjahr des Geschäftsjahrs laut Überschrift; None: nicht erkannt
    year: int | None
    rows: list[ParsedRow]
    accounts: list[ParsedAccount]
    # Zeilen mit Inhalt, aber ohne Betrag (z. B. vorbereitete leere Zeilen)
    skipped: int


def text_of(cell: Cell | None) -> str:
    """Zellwert als Text in einer Zeile; ganze Zahlen ohne „,0“."""
    if cell is None or cell.value is None:
        return ""
    value = cell.value
    if isinstance(value, bool):
        return "ja" if value else ""
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    return " ".join(value.split())


def cents_of(cell: Cell | None) -> int | None:
    """Betrag in Cent aus einer Zahl oder einem Text wie „1.234,56 €“."""
    if cell is None or cell.value is None or isinstance(cell.value, (bool, date)):
        return None
    if isinstance(cell.value, float):
        cents = round(cell.value * 100)
    else:
        raw = cell.value.replace("€", "").replace(" ", "").strip()
        sign = -1 if raw.startswith("-") else 1
        raw = raw.lstrip("-")
        if not re.fullmatch(r"\d{1,3}(\.\d{3})*(,\d{1,2})?|\d+(,\d{1,2})?", raw):
            return None
        whole, _, fraction = raw.replace(".", "").partition(",")
        cents = sign * (int(whole) * 100 + int(fraction.ljust(2, "0")))
    return cents if abs(cents) <= AMOUNT_MAX else None


def date_of(cell: Cell | None) -> date | None:
    """Datum aus einer Datumszelle, einer Excel-Seriennummer oder einem Text „TT.MM.JJJJ“."""
    if cell is None or cell.value is None or isinstance(cell.value, bool):
        return None
    if isinstance(cell.value, date):
        return cell.value
    if isinstance(cell.value, float):
        return excel_date(cell.value)
    match = DAY_PATTERN.search(cell.value)
    if not match:
        return None
    try:
        return datetime(int(match[3]), int(match[2]), int(match[1])).date()
    except ValueError:
        return None


def account_key(number: str) -> str:
    """Vergleichsschlüssel einer Kontonummer: ohne führende Nullen und Leerzeichen."""
    return number.replace(" ", "").lstrip("0") or "0"


def _placeholder(value: str) -> bool:
    """Vorbereitete Nummern wie „re.“ ohne Ziffer gelten als leer."""
    return not any(char.isdigit() for char in value)


def _find_header(cells: Sheet) -> int:
    rows = sorted({row for row, _ in cells})
    for row in rows:
        texts = {text_of(cells.get((row, col))).casefold() for col in range(1, 40)}
        if "kosten" in texts and "firma" in texts:
            return row
    raise SheetError(
        "In der Datei fehlt die Kopfzeile der Tabelle mit den Spalten „Firma“ und „Kosten“."
    )


def parse_sheet(cells: Sheet) -> ParsedFile:
    header = _find_header(cells)
    last_col = max((col for _, col in cells), default=0)
    columns: dict[str, int] = {}
    account_columns: dict[int, tuple[str, str]] = {}
    for col in range(1, last_col + 1):
        name = text_of(cells.get((header, col))).casefold()
        if not name:
            continue
        if name.startswith("rech"):
            columns.setdefault("internal", col)
        elif name == "firma":
            columns.setdefault("firm", col)
        elif name == "kosten":
            columns.setdefault("gross", col)
        elif name in ("re", "re.", "re-nr.", "rechnungsnummer"):
            columns.setdefault("number", col)
        elif name.startswith("bezeichnung"):
            columns.setdefault("description", col)
        elif name.startswith("j") and name.replace("ä", "ae").startswith("jaehrlich"):
            columns.setdefault("yearly", col)
        elif "datum" in name or DAY_PATTERN.search(name):
            columns.setdefault("date", col)
        elif name.startswith("projekt"):
            continue
        else:
            number = text_of(cells.get((header - 1, col)))
            if number and col > 1 and re.fullmatch(r"[0-9 ]{1,20}", number):
                account_columns[col] = (number.strip(), text_of(cells.get((header, col))))
    if "gross" not in columns or "firm" not in columns:
        raise SheetError("In der Datei fehlen die Spalten „Firma“ oder „Kosten“.")

    title = ""
    year: int | None = None
    for (row, _col), title_cell in sorted(cells.items()):
        if row >= header:
            break
        match = YEAR_PATTERN.search(text_of(title_cell))
        if match and int(match[2]) == int(match[1]) + 1:
            title, year = text_of(title_cell), int(match[1])
            break
    if year is None and "date" in columns:
        match = DAY_PATTERN.search(text_of(cells.get((header, columns["date"]))))
        if match:
            year = int(match[3])

    def value_at(row: int, key: str) -> Cell | None:
        col = columns.get(key)
        return cells.get((row, col)) if col is not None else None

    rows: list[ParsedRow] = []
    skipped = 0
    end = max((row for row, _ in cells), default=header)
    row = header + 1
    while row <= end:
        first = " ".join(text_of(cells.get((row, col))) for col in range(1, 4)).casefold()
        if "summe" in first:
            break
        gross = cents_of(value_at(row, "gross"))
        firm = text_of(value_at(row, "firm"))
        description = text_of(value_at(row, "description"))
        if gross is None or gross == 0:
            if firm or description:
                skipped += 1
            row += 1
            continue
        internal = text_of(value_at(row, "internal"))
        internal = "" if _placeholder(internal) else internal
        number = text_of(value_at(row, "number"))
        number = "" if _placeholder(number) else number
        filled = [
            number_and_name[0]
            for col, number_and_name in account_columns.items()
            if (value := cells.get((row, col))) is not None
            and not value.empty
            and not (isinstance(value.value, float) and value.value == 0)
        ]
        yearly_text = text_of(value_at(row, "yearly")).casefold()
        parsed = ParsedRow(
            row_number=row,
            invoice_date=date_of(value_at(row, "date")),
            number=number[:80],
            internal_number=internal[:60],
            firm=firm[:160],
            description=description[:200],
            gross_cents=gross,
            account_number=filled[0] if len(filled) == 1 else None,
            yearly=bool(yearly_text) and (yearly_text in YES or yearly_text.isdigit()),
        )
        # Rechnungsnummer und -datum stehen nur noch in der Notiz des Postens (keine Rechnung).
        if not firm:
            parsed.hints.append("Keine Firma angegeben; bitte den Partner wählen.")
        if len(filled) > 1:
            parsed.hints.append("Der Betrag steht bei mehreren Konten; bitte das Konto wählen.")
        elif not filled:
            parsed.hints.append("Kein Konto erkannt; bitte das Konto wählen.")
        if gross < 0:
            parsed.hints.append(
                "Negativer Betrag (Gutschrift?): Bitte prüfen; übernommen wird nur ein Betrag ab 0."
            )
        rows.append(parsed)
        row += 1

    # Unter der Tabelle: je Konto Nummer (Spalte A), Budget (Spalte C) und Bezeichnung (Spalte D)
    block: list[ParsedAccount] = []
    for line in range(row + 1, end + 1):
        number_cell = cells.get((line, 1))
        name = text_of(cells.get((line, 4)))
        number = text_of(number_cell)
        if not name or not re.fullmatch(r"\d{1,20}", number):
            continue
        budget = cents_of(cells.get((line, 3)))
        block.append(
            ParsedAccount(
                number=number,
                name=name[:120],
                budget_cents=budget if budget and budget > 0 else None,
            )
        )
    accounts = list(block)
    known = {account_key(account.number) for account in accounts}
    for number, header_name in account_columns.values():
        if account_key(number) in known:
            continue
        if any(entry.account_number == number for entry in rows):
            known.add(account_key(number))
            accounts.append(
                ParsedAccount(
                    number=number, name=(header_name or f"Konto {number}")[:120], budget_cents=None
                )
            )
    return ParsedFile(title=title, year=year, rows=rows, accounts=accounts, skipped=skipped)
