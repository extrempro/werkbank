"""Liest das erste sichtbare Blatt einer Excel-Datei (.xlsx) ohne Zusatzpaket.

Nur was der Import braucht: Werte der Zellen (Text, Zahl, Datum, Wahrheitswert) und ob eine
Zelle eine Formel hat. Schutz gegen präparierte Dateien: Größe und Zahl der Einträge im Archiv
sind begrenzt, XML mit DOCTYPE oder ENTITY wird abgelehnt, Zeilen und Spalten sind begrenzt.
"""

import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from xml.etree import ElementTree

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
# Grenzen gegen präparierte Dateien
ENTRIES_MAX = 500
ENTRY_MAX_BYTES = 30 * 1024 * 1024
TOTAL_MAX_BYTES = 60 * 1024 * 1024
ROWS_MAX = 5000
COLUMNS_MAX = 100
# Eingebaute Zahlenformate, die ein Datum darstellen
DATE_FORMATS = {14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47}
EXCEL_EPOCH = date(1899, 12, 30)


class XlsxError(ValueError):
    """Die Datei ist keine lesbare Excel-Datei."""


@dataclass(frozen=True)
class Cell:
    """Wert einer Zelle: str, float, date oder bool; formula: die Zelle hat eine Formel."""

    value: str | float | date | bool | None
    formula: bool = False

    @property
    def empty(self) -> bool:
        return self.value is None or (isinstance(self.value, str) and not self.value.strip())


Sheet = dict[tuple[int, int], Cell]


def column_index(letters: str) -> int:
    """„A“ → 1, „AB“ → 28."""
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - 64)
    return index


REF = re.compile(r"^([A-Z]{1,3})(\d{1,7})$")


def _read(archive: zipfile.ZipFile, name: str) -> bytes | None:
    try:
        info = archive.getinfo(name)
    except KeyError:
        return None
    if info.file_size > ENTRY_MAX_BYTES:
        raise XlsxError("Die Datei ist zu groß.")
    with archive.open(info) as handle:
        data = handle.read(ENTRY_MAX_BYTES + 1)
    if len(data) > ENTRY_MAX_BYTES:
        raise XlsxError("Die Datei ist zu groß.")
    return data


def _xml(data: bytes) -> ElementTree.Element:
    head = data[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in data.upper():
        raise XlsxError("Die Datei enthält nicht erlaubte Angaben.")
    try:
        # DOCTYPE und ENTITY sind oben abgelehnt; expat löst keine externen Entitäten auf.
        return ElementTree.fromstring(data)  # noqa: S314
    except ElementTree.ParseError as error:
        raise XlsxError("Die Datei ist keine lesbare Excel-Datei.") from error


def _text(element: ElementTree.Element) -> str:
    """Text eines <si> oder <is>: einfacher Text oder Abschnitte mit Formatierung."""
    plain = element.find("m:t", NS)
    if plain is not None:
        return plain.text or ""
    return "".join(run.text or "" for run in element.iterfind("m:r/m:t", NS))


def _is_date_format(code: str) -> bool:
    cleaned = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", code).lower()
    return bool(re.search(r"[dmy]", cleaned))


def _date_styles(styles: bytes | None) -> set[int]:
    """Indizes der Zellformate, die ein Datum darstellen."""
    if styles is None:
        return set()
    root = _xml(styles)
    custom: set[int] = set()
    for fmt in root.iterfind("m:numFmts/m:numFmt", NS):
        number = int(fmt.get("numFmtId", "0"))
        if _is_date_format(fmt.get("formatCode", "")):
            custom.add(number)
    result: set[int] = set()
    for index, xf in enumerate(root.iterfind("m:cellXfs/m:xf", NS)):
        number = int(xf.get("numFmtId", "0"))
        if number in DATE_FORMATS or number in custom:
            result.add(index)
    return result


def excel_date(serial: float) -> date | None:
    """Seriennummer eines Excel-Datums; None außerhalb eines vernünftigen Bereichs."""
    if not 1 <= serial < 2958466:
        return None
    return EXCEL_EPOCH + timedelta(days=int(serial))


def _first_sheet(archive: zipfile.ZipFile) -> str:
    workbook = _read(archive, "xl/workbook.xml")
    rels = _read(archive, "xl/_rels/workbook.xml.rels")
    if workbook is None or rels is None:
        raise XlsxError("Die Datei ist keine Excel-Datei (.xlsx).")
    targets = {rel.get("Id"): rel.get("Target", "") for rel in _xml(rels).iter(PKG_REL)}
    for sheet in _xml(workbook).iterfind("m:sheets/m:sheet", NS):
        if sheet.get("state") in ("hidden", "veryHidden"):
            continue
        target = targets.get(sheet.get(f"{{{REL_NS}}}id"), "")
        if target:
            target = target.lstrip("/")
            return target if target.startswith("xl/") else f"xl/{target}"
    raise XlsxError("Die Datei enthält kein Blatt.")


def read_first_sheet(data: bytes) -> Sheet:
    """Zellen des ersten sichtbaren Blatts als {(Zeile, Spalte): Cell}, beide ab 1."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise XlsxError("Die Datei ist keine Excel-Datei (.xlsx).") from error
    with archive:
        infos = archive.infolist()
        if len(infos) > ENTRIES_MAX or sum(info.file_size for info in infos) > TOTAL_MAX_BYTES:
            raise XlsxError("Die Datei ist zu groß.")
        sheet_name = _first_sheet(archive)
        shared_raw = _read(archive, "xl/sharedStrings.xml")
        shared = (
            [_text(item) for item in _xml(shared_raw).iterfind("m:si", NS)]
            if shared_raw is not None
            else []
        )
        dates = _date_styles(_read(archive, "xl/styles.xml"))
        sheet_raw = _read(archive, sheet_name)
        if sheet_raw is None:
            raise XlsxError("Die Datei enthält kein Blatt.")
        root = _xml(sheet_raw)
    cells: Sheet = {}
    for row in root.iterfind("m:sheetData/m:row", NS):
        for cell in row.iterfind("m:c", NS):
            match = REF.match(cell.get("r", ""))
            if not match:
                continue
            col, line = column_index(match[1]), int(match[2])
            if line > ROWS_MAX or col > COLUMNS_MAX:
                continue
            kind = cell.get("t", "n")
            formula = cell.find("m:f", NS) is not None
            raw = cell.find("m:v", NS)
            text = raw.text if raw is not None else None
            value: str | float | date | bool | None = None
            if kind == "s" and text is not None:
                index = int(text)
                value = shared[index] if 0 <= index < len(shared) else None
            elif kind == "inlineStr":
                inline = cell.find("m:is", NS)
                value = _text(inline) if inline is not None else None
            elif kind in ("str", "e"):
                value = text if kind == "str" else None
            elif kind == "b":
                value = text == "1"
            elif kind == "d" and text:
                try:
                    value = datetime.fromisoformat(text).date()
                except ValueError:
                    value = None
            elif text is not None:
                try:
                    number = float(text)
                except ValueError:
                    number = None
                if number is not None and int(cell.get("s", "0")) in dates:
                    value = excel_date(number)
                else:
                    value = number
            if value is not None or formula:
                cells[(line, col)] = Cell(value=value, formula=formula)
    return cells
