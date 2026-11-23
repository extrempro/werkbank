"""IT-Budget: Import aus Excel (Datei lesen, Zeilen erkennen, Vorgang abarbeiten)."""

import io
import zipfile
from collections.abc import Collection, Iterator
from datetime import date
from typing import Any
from xml.sax.saxutils import escape

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_budget import BASE as BUDGET
from tests.test_budget import HEADERS
from tests.test_m365_api import client_for
from werkbank.core.models import AppSetting
from werkbank.modules.budget.contracts import net_from_gross
from werkbank.modules.budget.excel_import import SheetError, cents_of, parse_sheet
from werkbank.modules.budget.imports import firm_key, match_partner
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetImport,
    BudgetInvoice,
    BudgetItem,
    BudgetPartner,
)
from werkbank.modules.budget.settings import SETTINGS_KEY
from werkbank.modules.budget.xlsx_read import Cell, XlsxError, read_first_sheet

BASE = "/api/budget/imports"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EXCEL_EPOCH = date(1899, 12, 30)


def col_name(index: int) -> str:
    name = ""
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


def make_xlsx(
    cells: dict[tuple[int, int], Any], formulas: Collection[tuple[int, int]] = ()
) -> bytes:
    """Kleine Excel-Datei: Text als Inline-Text, Zahlen, Datum mit Zahlenformat 14."""
    rows: dict[int, list[str]] = {}
    for (row, col), value in sorted(cells.items()):
        ref = f"{col_name(col)}{row}"
        formula = "<f>A1</f>" if (row, col) in formulas else ""
        if isinstance(value, date):
            xml = f'<c r="{ref}" s="1">{formula}<v>{(value - EXCEL_EPOCH).days}</v></c>'
        elif isinstance(value, (int, float)):
            xml = f'<c r="{ref}">{formula}<v>{value}</v></c>'
        else:
            xml = f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
        rows.setdefault(row, []).append(xml)
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        + "".join(f'<row r="{row}">{"".join(parts)}</row>' for row, parts in rows.items())
        + "</sheetData></worksheet>"
    )
    files = {
        "xl/workbook.xml": (
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>'
            "</Relationships>"
        ),
        "xl/styles.xml": (
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'
        ),
        "xl/worksheets/sheet1.xml": sheet,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def budget_file() -> dict[tuple[int, int], Any]:
    """Aufbau wie die bisherigen Dateien: Überschrift, Kontonummern, Kopfzeile, Zeilen, Block."""
    cells: dict[tuple[int, int], Any] = {
        (1, 7): "IT Budget und Projekte Geschäftsjahr 2026 / 2027",
        (2, 9): "6050",
        (2, 10): "6002",
        (3, 1): "100",
        (3, 2): "Rech.Nr.:",
        (3, 3): "Firma",
        (3, 4): "Kosten",
        (3, 5): "01.01.2026 bis 31.12.2026",
        (3, 6): "RE",
        (3, 7): "Bezeichnung / Dienstleistung",
        (3, 8): "Projekte",
        (3, 9): "Hardware",
        (3, 10): "Software",
        (3, 11): "Jährlich",
    }
    lines = [
        (
            "re.26.001",
            "Beispiel Hardware GmbH",
            1190.0,
            date(2026, 2, 3),
            "RE-1",
            "Notebooks",
            9,
            "",
        ),
        ("re.26.002", "Beispiel Soft AG", 238.0, date(2026, 3, 4), "", "Lizenz", 10, "x"),
        (
            "re.26.003",
            "Beispiel Hardware GmbH",
            595.0,
            date(2025, 12, 1),
            "RE-2",
            "Monitore",
            9,
            "",
        ),
        ("re.26.004", "Muster Netz KG", 100.0, date(2026, 4, 5), "RE-9", "Kabel", None, ""),
    ]
    for offset, (intern, firm, gross, day, number, text, col, yearly) in enumerate(lines):
        row = 5 + offset
        cells[(row, 1)] = 100
        cells[(row, 2)] = intern
        cells[(row, 3)] = firm
        cells[(row, 4)] = gross
        cells[(row, 5)] = day
        if number:
            cells[(row, 6)] = number
        cells[(row, 7)] = text
        if col is not None:
            cells[(row, col)] = gross
        if yearly:
            cells[(row, 11)] = yearly
    # Vorbereitete Zeile ohne Betrag und die Summenzeile
    cells[(9, 1)] = 100
    cells[(9, 2)] = "re."
    cells[(12, 1)] = "Kosten-Quersumme"
    cells[(12, 4)] = 2123.0
    cells[(14, 1)] = 6050
    cells[(14, 3)] = 15000
    cells[(14, 4)] = "Hardware"
    cells[(15, 1)] = 6002
    cells[(15, 3)] = 2000
    cells[(15, 4)] = "Software"
    cells[(16, 3)] = 17000
    cells[(16, 4)] = "Budget IT"
    return cells


def as_sheet(cells: dict[tuple[int, int], Any]) -> dict[tuple[int, int], Cell]:
    return {
        key: Cell(float(value) if isinstance(value, int) and not isinstance(value, bool) else value)
        for key, value in cells.items()
    }


# --- ohne Datenbank -------------------------------------------------------------------


def test_reads_cells_dates_and_formulas() -> None:
    data = make_xlsx({(1, 1): "Titel & mehr", (2, 2): 12.5, (3, 3): date(2026, 8, 1)}, {(2, 2)})
    cells = read_first_sheet(data)
    assert cells[(1, 1)].value == "Titel & mehr"
    assert cells[(2, 2)] == Cell(12.5, formula=True)
    assert cells[(3, 3)].value == date(2026, 8, 1)


def test_rejects_broken_and_dangerous_files() -> None:
    with pytest.raises(XlsxError):
        read_first_sheet(b"keine excel-datei")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("xl/workbook.xml", '<!DOCTYPE x [<!ENTITY a "b">]><workbook/>')
        archive.writestr("xl/_rels/workbook.xml.rels", "<Relationships/>")
    with pytest.raises(XlsxError):
        read_first_sheet(buffer.getvalue())


def test_parses_rows_accounts_and_hints() -> None:
    parsed = parse_sheet(as_sheet(budget_file()))
    assert parsed.year == 2026
    assert parsed.skipped == 0
    assert [row.row_number for row in parsed.rows] == [5, 6, 7, 8]
    first, second, third, fourth = parsed.rows
    assert (first.firm, first.gross_cents, first.account_number, first.number) == (
        "Beispiel Hardware GmbH",
        119_000,
        "6050",
        "RE-1",
    )
    assert first.internal_number == "re.26.001"
    assert first.invoice_date == date(2026, 2, 3)
    assert first.hints == []
    # Ohne RE-Nummer: kein Hinweis mehr (es entsteht keine Rechnung); Jährlich erkannt
    assert second.yearly is True
    assert second.number == ""
    assert second.hints == []
    assert third.account_number == "6050"
    # Ohne Betrag in einer Kontospalte: Konto wählen
    assert fourth.account_number is None
    assert any("Konto" in hint for hint in fourth.hints)
    assert [(a.number, a.name, a.budget_cents) for a in parsed.accounts] == [
        ("6050", "Hardware", 1_500_000),
        ("6002", "Software", 200_000),
    ]


def test_parser_needs_the_header_and_reads_amounts() -> None:
    with pytest.raises(SheetError):
        parse_sheet(as_sheet({(1, 1): "irgendwas"}))
    assert cents_of(Cell("1.234,56 €")) == 123_456
    assert cents_of(Cell("-12,5")) == -1250
    assert cents_of(Cell("viel")) is None
    assert cents_of(Cell(19.99)) == 1999


def test_firm_matching_and_net() -> None:
    assert firm_key("Beispiel Software GmbH") == firm_key("beispiel software")
    assert firm_key("A & B KG") == "a und b"
    partners = [
        BudgetPartner(id=1, name="Beispiel Software GmbH"),
        BudgetPartner(id=2, name="Muster Netz KG"),
    ]
    assert match_partner("Beispiel Software GmbH", partners, {})[0] == "gefunden"
    match, partner = match_partner("Beispiel Software", partners, {})
    assert (match, partner.id if partner else None) == ("aehnlich", 1)
    assert match_partner("Ganz Andere AG", partners, {}) == ("neu", None)
    assert match_partner("Ganz Andere AG", partners, {"ganz andere ag": 2})[0] == "entschieden"
    assert net_from_gross(119_000, 1900) == 100_000
    assert net_from_gross(107, 700) == 100
    assert net_from_gross(500, 0) == 500


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        for model in (BudgetImport, BudgetInvoice, BudgetItem, BudgetPartner, BudgetAccount):
            db_session.execute(delete(model))
        db_session.execute(delete(AppSetting).where(AppSetting.key == SETTINGS_KEY))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def upload(client: Any, data: bytes, name: str = "Budget%202026.xlsx") -> Any:
    return client.post(
        BASE, content=data, headers={**HEADERS, "Content-Type": XLSX, "X-Dateiname": name}
    )


def with_accounts(detail: dict[str, Any]) -> list[dict[str, Any]]:
    """Zeilen mit der Kennung ihres Kontos (die Oberfläche wählt es aus der Liste)."""
    ids = {account["number"]: account["account_id"] for account in detail["accounts"]}
    return [
        {**row, "account_id": ids.get(row["account_number"] or "")} for row in detail["rows_detail"]
    ]


def take_body(row: dict[str, Any], **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "description": row["description"],
        "account_id": row.get("account_id"),
        "gross_cents": row["gross_cents"],
        "yearly": row["yearly"],
    }
    if row["partner_id"]:
        body["partner_id"] = row["partner_id"]
    else:
        body["new_partner"] = row["firm"]
    body.update(extra)
    return body


@pytest.mark.db
def test_import_flow(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "import-verwalter")
    editor = client_for(["Budget.Editor"], "import-it")
    data = make_xlsx(budget_file())
    assert upload(editor, data).status_code == 403
    assert editor.get(BASE).status_code == 403
    bad = manager.post(BASE, content=b"x", headers={**HEADERS, "Content-Type": "text/plain"})
    assert bad.status_code == 415
    assert upload(manager, b"keine excel-datei").status_code == 422

    # Bestehendes Konto und Partner: werden wiedererkannt
    manager.post(
        f"{BUDGET}/accounts",
        json={"number": "6002", "name": "Software", "kind": "laufend"},
        headers=HEADERS,
    )
    manager.post(f"{BUDGET}/partners", json={"name": "Beispiel Software GmbH"}, headers=HEADERS)

    draft = upload(manager, data)
    assert draft.status_code == 201, draft.text
    detail = draft.json()
    assert (detail["status"], detail["year"], detail["file_name"]) == (
        "entwurf",
        2026,
        "Budget 2026.xlsx",
    )
    assert [(a["number"], a["account_id"] is not None) for a in detail["accounts"]] == [
        ("6050", False),
        ("6002", True),
    ]
    rows = detail["rows_detail"]
    assert len(rows) == 4
    # Datum außerhalb des Geschäftsjahrs (Vorgabe: Kalenderjahr) bekommt einen Hinweis
    assert any("außerhalb" in hint for hint in rows[2]["hints"])
    # Entwürfe sehen nur, wer sie hochgeladen hat
    other = client_for(["Budget.Manager"], "import-verwalter-2")
    assert other.get(f"{BASE}/{detail['id']}").status_code == 404
    assert other.get(BASE).json() == []
    take = f"{BASE}/{detail['id']}/rows/{rows[0]['id']}/take"
    draft_take = take_body(rows[0], account_id=1)
    assert manager.post(take, json=draft_take, headers=HEADERS).status_code == 409

    started = manager.post(
        f"{BASE}/{detail['id']}/start",
        json={"year": 2026, "tax_rate_bp": 1900, "kinds": {"6050": "investition"}},
        headers=HEADERS,
    ).json()
    assert started["status"] == "offen"
    hardware = db.scalars(select(BudgetAccount).where(BudgetAccount.number == "6050")).one()
    assert (hardware.name, hardware.kind) == ("Hardware", "investition")
    # Budgetposten entstehen erst beim Übernehmen, kein „Allgemein“ mehr
    assert db.scalars(select(BudgetItem).where(BudgetItem.account_id == hardware.id)).all() == []
    rows = with_accounts(started)
    assert all(row["account_id"] for row in rows[:3]) and rows[3]["account_id"] is None
    assert all(row["item_id"] is None for row in rows)
    assert rows[1]["partner_match"] == "aehnlich"
    assert rows[0]["partner_match"] == "neu"
    assert (
        manager.post(
            f"{BASE}/{detail['id']}/start", json={"year": 2026}, headers=HEADERS
        ).status_code
        == 409
    )

    # Zeile 1: neuer Partner, eigener Budgetposten, keine Rechnung
    invoices_before = len(db.scalars(select(BudgetInvoice)).all())
    first = manager.post(take, json=take_body(rows[0]), headers=HEADERS)
    assert first.status_code == 200, first.text
    after = with_accounts(first.json())
    assert after[0]["status"] == "uebernommen" and after[0]["invoice_id"] is None
    assert len(db.scalars(select(BudgetInvoice)).all()) == invoices_before
    # Name aus der Bezeichnung, erwartete Kosten = Betrag, Partner am Posten, Rechnung in der Notiz
    item = db.get(BudgetItem, after[0]["item_id"])
    assert item is not None and item.partner is not None
    assert (item.account_id, item.name, item.amount_cents) == (hardware.id, "Notebooks", 119_000)
    assert (item.start_year, item.end_year, after[0]["item_name"]) == (2026, 2026, "Notebooks")
    assert item.partner.name == "Beispiel Hardware GmbH"
    assert "Rechnung RE-1 vom 03.02.2026" in item.note
    # Die Entscheidung gilt für weitere Zeilen derselben Firma
    assert after[2]["partner_match"] == "entschieden"
    # Partner fehlt oder beides angegeben, Betrag negativ
    for body in (
        take_body(after[1], partner_id=None, new_partner=None),
        take_body(after[1], partner_id=after[1]["partner_id"], new_partner="X"),
        take_body(after[1], gross_cents=-1),
    ):
        response = manager.post(
            f"{BASE}/{detail['id']}/rows/{after[1]['id']}/take", json=body, headers=HEADERS
        )
        assert response.status_code == 422, body

    # Zeile 2 (jährlich) mit dem ähnlichen Partner übernehmen, Zeile 3 überspringen und zurück
    second = with_accounts(
        manager.post(
            f"{BASE}/{detail['id']}/rows/{after[1]['id']}/take",
            json=take_body(after[1]),
            headers=HEADERS,
        ).json()
    )
    assert (
        db.scalars(select(BudgetPartner).where(BudgetPartner.name == "Beispiel Soft AG")).first()
        is None
    )
    skip = manager.post(f"{BASE}/{detail['id']}/rows/{second[2]['id']}/skip", headers=HEADERS)
    assert skip.json()["rows_detail"][2]["status"] == "uebersprungen"
    reopened = manager.post(f"{BASE}/{detail['id']}/rows/{second[2]['id']}/reopen", headers=HEADERS)
    assert reopened.json()["rows_detail"][2]["status"] == "offen"
    assert (
        manager.post(
            f"{BASE}/{detail['id']}/rows/{second[0]['id']}/reopen", headers=HEADERS
        ).status_code
        == 409
    )

    # Offene Vorgänge stehen als Aufgabe auf der Startseite
    tasks = manager.get("/api/tasks").json()["tasks"]
    assert any(task["link"] == "/budget/import" for task in tasks)

    # Zeile 3 mit derselben Bezeichnung wie Zeile 1: Name bekommt eine Nummer
    third = manager.post(
        f"{BASE}/{detail['id']}/rows/{second[2]['id']}/take",
        json=take_body(second[2], description="Notebooks"),
        headers=HEADERS,
    )
    assert third.status_code == 200, third.text
    assert third.json()["rows_detail"][2]["item_name"] == "Notebooks (2)"
    # Zeile 4 ohne Konto in der Datei: ohne gewähltes Konto geht es nicht
    no_account = manager.post(
        f"{BASE}/{detail['id']}/rows/{second[3]['id']}/take",
        json=take_body(second[3], account_id=999_999),
        headers=HEADERS,
    )
    assert no_account.status_code == 422
    manager.post(f"{BASE}/{detail['id']}/rows/{second[3]['id']}/skip", headers=HEADERS)
    summary = manager.get(BASE).json()[0]
    assert (summary["status"], summary["taken"], summary["skipped"], summary["open"]) == (
        "abgeschlossen",
        3,
        1,
        0,
    )

    # Planung aus der Zeile mit „Jährlich“: der Posten der Zeile läuft weiter
    plan = manager.post(
        f"{BASE}/{detail['id']}/plan",
        json={"entries": [{"row_id": second[1]["id"], "amount_cents": 25_000, "ongoing": False}]},
        headers=HEADERS,
    )
    assert plan.status_code == 200, plan.text
    assert plan.json()["extended"] == 1
    planned = db.scalars(select(BudgetItem).where(BudgetItem.name == "Lizenz")).one()
    db.refresh(planned)
    assert (planned.start_year, planned.end_year, planned.amount_cents) == (2026, 2027, 25_000)
    assert plan.json()["detail"]["rows_detail"][1]["planned_item_id"] == planned.id
    again = manager.post(
        f"{BASE}/{detail['id']}/plan",
        json={"entries": [{"row_id": second[1]["id"], "amount_cents": 23_800}]},
        headers=HEADERS,
    ).json()
    db.refresh(planned)
    assert again["extended"] == 1 and (planned.end_year, planned.amount_cents) == (None, 23_800)
    assert db.scalars(select(BudgetItem).where(BudgetItem.name.like("Lizenz%"))).all() == [planned]
    not_taken = manager.post(
        f"{BASE}/{detail['id']}/plan",
        json={"entries": [{"row_id": second[3]["id"], "amount_cents": 1}]},
        headers=HEADERS,
    )
    assert not_taken.status_code == 422

    # Löschen des Vorgangs lässt Konten, Partner und Posten stehen
    assert manager.delete(f"{BASE}/{detail['id']}", headers=HEADERS).json() == {"deleted": True}
    db.expire_all()
    assert db.get(BudgetItem, after[0]["item_id"]) is not None
    assert manager.get(BASE).json() == []


@pytest.mark.db
def test_cancel_import_and_delete_rows(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "import-abbruch")
    detail = upload(manager, make_xlsx(budget_file())).json()
    url = f"{BASE}/{detail['id']}"
    draft_rows = detail["rows_detail"]
    # Im Entwurf: weder abbrechen noch Zeilen löschen (der Entwurf wird verworfen)
    assert manager.post(f"{url}/cancel", headers=HEADERS).status_code == 409
    row_url = f"{url}/rows/{draft_rows[0]['id']}"
    assert manager.delete(row_url, headers=HEADERS).status_code == 409
    started = manager.post(f"{url}/start", json={"year": 2026}, headers=HEADERS).json()
    rows = with_accounts(started)
    taken = manager.post(
        f"{url}/rows/{rows[0]['id']}/take", json=take_body(rows[0]), headers=HEADERS
    )
    assert taken.status_code == 200, taken.text
    manager.post(f"{url}/rows/{rows[1]['id']}/skip", headers=HEADERS)

    # Einzeln löschen: offene Zeile ja, übernommene nicht
    one = manager.delete(f"{url}/rows/{rows[2]['id']}", headers=HEADERS)
    assert one.status_code == 200, one.text
    assert [entry["row_number"] for entry in one.json()["rows_detail"]] == [
        rows[0]["row_number"],
        rows[1]["row_number"],
        rows[3]["row_number"],
    ]
    assert manager.delete(f"{url}/rows/{rows[0]['id']}", headers=HEADERS).status_code == 409
    # Nur Budgetverwalter
    editor = client_for(["Budget.Editor"], "import-abbruch-it")
    assert editor.post(f"{url}/cancel", headers=HEADERS).status_code == 403

    # Abbrechen: offene und übersprungene Zeilen weg, übernommene bleiben, keine Aufgabe mehr
    cancelled = manager.post(f"{url}/cancel", headers=HEADERS)
    assert cancelled.status_code == 200, cancelled.text
    data = cancelled.json()
    assert data["status"] == "abgebrochen" and data["finished_at"] is not None
    assert [(entry["status"], entry["item_id"] is not None) for entry in data["rows_detail"]] == [
        ("uebernommen", True)
    ]
    assert (data["open"], data["taken"], data["skipped"]) == (0, 1, 0)
    assert db.get(BudgetItem, data["rows_detail"][0]["item_id"]) is not None
    tasks = manager.get("/api/tasks").json()["tasks"]
    assert not any(task["link"] == "/budget/import" for task in tasks)
    assert manager.post(f"{url}/cancel", headers=HEADERS).status_code == 409
    assert manager.post(f"{url}/rows/{rows[3]['id']}/skip", headers=HEADERS).status_code == 404
    assert manager.get(BASE).json()[0]["status"] == "abgebrochen"
