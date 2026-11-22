"""Schlichte Excel-Dateien (xlsx) ohne Zusatzpaket: Tabellenblätter mit Text, Zahl, Betrag, Datum.

Texte stehen als Inline-Text in den Zellen, nie als Formel. Damit kann ein Name oder eine
Bezeichnung aus der Werkbank in Excel keine Formel auslösen.
"""

import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date
from xml.sax.saxutils import escape

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Zeichen, die in XML 1.0 nicht vorkommen dürfen
_INVALID = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")
# Excel erlaubt in Blattnamen höchstens 31 Zeichen und keines von diesen
_SHEET_FORBIDDEN = re.compile(r"[\[\]:*?/\\]")
# Excel zählt Tage ab dem 30.12.1899
_EPOCH = date(1899, 12, 30)


@dataclass(frozen=True)
class Money:
    """Ein Betrag in Cent; in Excel als Zahl in Euro mit zwei Nachkommastellen."""

    cents: int


Cell = str | int | float | Money | date | None


@dataclass(frozen=True)
class Sheet:
    name: str
    # Erste Zeile: Überschriften (fett)
    rows: list[list[Cell]]


def _column(index: int) -> str:
    """Spaltenname zu einer Spalte ab 0: A, B, …, Z, AA, …"""
    name = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


def _text(value: str) -> str:
    return escape(_INVALID.sub("", value))


def _cell(ref: str, value: Cell, header: bool) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        value = "ja" if value else ""
    if isinstance(value, str):
        style = ' s="1"' if header else ""
        text = _text(value)
        return f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{text}</t></is></c>'
    if isinstance(value, Money):
        return f'<c r="{ref}" s="2"><v>{value.cents / 100:.2f}</v></c>'
    if isinstance(value, date):
        return f'<c r="{ref}" s="3"><v>{(value - _EPOCH).days}</v></c>'
    return f'<c r="{ref}"><v>{value}</v></c>'


def _sheet_xml(sheet: Sheet) -> str:
    rows = []
    for number, row in enumerate(sheet.rows, start=1):
        cells = "".join(
            _cell(f"{_column(index)}{number}", value, number == 1)
            for index, value in enumerate(row)
        )
        rows.append(f'<row r="{number}">{cells}</row>')
    widths = max((len(row) for row in sheet.rows), default=0)
    cols = (
        f'<cols><col min="1" max="{widths}" width="18" customWidth="1"/></cols>' if widths else ""
    )
    pane = (
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" '
        'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"{pane}{cols}<sheetData>{''.join(rows)}</sheetData></worksheet>"
    )


def _sheet_name(name: str, taken: set[str]) -> str:
    clean = _SHEET_FORBIDDEN.sub("-", _INVALID.sub("", name)).strip("'")[:31] or "Blatt"
    candidate, number = clean, 2
    while candidate.lower() in taken:
        suffix = f" ({number})"
        candidate = clean[: 31 - len(suffix)] + suffix
        number += 1
    taken.add(candidate.lower())
    return candidate


STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;€&quot;"/>'
    '<numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>'
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill>'
    '<fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    "</cellXfs>"
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    "</styleSheet>"
)


def workbook(sheets: list[Sheet]) -> bytes:
    """Die Excel-Datei mit diesen Tabellenblättern als Bytes."""
    taken: set[str] = set()
    names = [_sheet_name(sheet.name, taken) for sheet in sheets]
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    types = "".join(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/'
        'vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, len(sheets) + 1)
    )
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" '
            'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            f"{types}</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<workbook xmlns="{main}" xmlns:r="{rel}"><sheets>'
            + "".join(
                f'<sheet name="{escape(name, {chr(34): "&quot;"})}" sheetId="{index}" '
                f'r:id="rId{index}"/>'
                for index, name in enumerate(names, start=1)
            )
            + "</sheets></workbook>"
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(
                f'<Relationship Id="rId{index}" Type="{rel}/worksheet" '
                f'Target="worksheets/sheet{index}.xml"/>'
                for index in range(1, len(sheets) + 1)
            )
            + f'<Relationship Id="rId{len(sheets) + 1}" Type="{rel}/styles" '
            'Target="styles.xml"/></Relationships>'
        ),
        "xl/styles.xml": STYLES,
    }
    for index, sheet in enumerate(sheets, start=1):
        files[f"xl/worksheets/sheet{index}.xml"] = _sheet_xml(sheet)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in files.items():
            archive.writestr(name, text)
    return buffer.getvalue()
