"""IT-Projekte: Rechte, Einstellungen, Budget aus dem IT-Budget, Aufgaben, Jour Fixe, Anhänge."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_budget import BASE as BUDGET
from tests.test_budget import HEADERS, PDF, post
from tests.test_m365_api import client_for
from werkbank.core.models import AppSetting, AuditLog
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetInvoice,
    BudgetItem,
    BudgetPartner,
)
from werkbank.modules.budget.plan import YearLines
from werkbank.modules.budget.settings import SETTINGS_KEY
from werkbank.modules.projects.api import item_costs, valid_link
from werkbank.modules.projects.models import Project

BASE = "/api/projects"


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        for model in (BudgetInvoice, BudgetItem, BudgetPartner, BudgetAccount, Project):
            db_session.execute(delete(model))
        db_session.execute(delete(AppSetting).where(AppSetting.key == SETTINGS_KEY))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def project_body(**extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "WLAN-Erneuerung",
        "description": "Neue Access Points an allen Standorten",
        "status": "aktiv",
        "starts_on": "2026-01-01",
        "ends_on": "2026-12-31",
        "budget_cents": 1_000_000,
        "budget_note": "Rahmen laut Freigabe",
        "people": [
            {"name": "Erika Beispiel", "role": "Projektleitung", "kind": "intern"},
            {
                "name": "Jana Muster",
                "role": "Technik",
                "kind": "extern",
                "organisation": "Beispiel GmbH",
                "contact": "jana@example.com",
            },
        ],
        "links": [{"label": "Ablage", "url": "https://ablage.example.com/projekt"}],
    }
    body.update(extra)
    return body


def item(start: int, end: int | None, amount: int = 1000, active: bool = True) -> BudgetItem:
    return BudgetItem(
        id=1,
        account_id=1,
        name="x",
        amount_cents=amount,
        start_year=start,
        end_year=end,
        active=active,
    )


# --- ohne Datenbank -------------------------------------------------------------------


def test_links_must_be_https() -> None:
    assert valid_link("https://ablage.example.com/a?b=c")
    for bad in (
        "http://example.com",
        "javascript:alert(1)",
        "https://",
        "https://nutzer:pw@example.com",
        "https://example.com/ a",
        "ablage.example.com",
        "",
    ):
        assert not valid_link(bad), bad


def test_item_costs_split_planned_and_actual() -> None:
    # Läuft 2025 bis 2027, je Jahr 1000 erwartet.
    lines = {
        # 2025: gebucht 1200 und abgeschlossen → nichts mehr geplant
        (1, 2025): YearLines(actual_cents=1200, invoiced=True, closed=True),
        # 2026: Abschlag 400 gebucht, noch offen → 600 geplant
        (1, 2026): YearLines(actual_cents=400, invoiced=True, closed=False),
        # 2027: nur eine Rechnung „zu prüfen“ → zählt noch als geplant
        (1, 2027): YearLines(actual_cents=0, invoiced=True, closed=False),
    }
    costs = item_costs(item(2025, 2027), lines, 2026)
    assert costs.years == {2025: (0, 1200), 2026: (600, 400), 2027: (1000, 0)}
    assert (costs.planned, costs.actual) == (1600, 1600)


def test_item_costs_without_end_run_to_current_year() -> None:
    costs = item_costs(item(2024, None), {}, 2026)
    assert sorted(costs.years) == [2024, 2025, 2026]
    assert costs.planned == 3000
    # Beginnt der Posten erst später, zählt sein erstes Jahr.
    assert sorted(item_costs(item(2028, None), {}, 2026).years) == [2028]
    # Stillgelegte Posten planen nichts mehr, ihr Ist bleibt.
    lines = {(1, 2025): YearLines(actual_cents=300, invoiced=True)}
    stopped = item_costs(item(2024, None, active=False), lines, 2026)
    assert (stopped.planned, stopped.actual) == (0, 300)


# --- mit Datenbank --------------------------------------------------------------------


@pytest.mark.db
def test_projects_need_their_roles(db: Session) -> None:
    stranger = client_for(["Budget.Editor"], "projekt-fremd")
    assert stranger.get(BASE).status_code == 403
    assert stranger.post(BASE, json=project_body(), headers=HEADERS).status_code == 403
    reader = client_for(["Projekte.Reader"], "projekt-leser")
    assert reader.get(BASE).json() == []
    assert reader.post(BASE, json=project_body(), headers=HEADERS).status_code == 403

    editor = client_for(["Projekte.Editor"], "projekt-bearbeiter")
    created = editor.post(BASE, json=project_body(), headers=HEADERS)
    assert created.status_code == 201, created.text
    project = created.json()
    assert [person["kind"] for person in project["people"]] == ["intern", "extern"]
    assert project["links"] == [{"label": "Ablage", "url": "https://ablage.example.com/projekt"}]
    assert project["budget"]["budget_cents"] == 1_000_000
    assert project["budget"]["remaining_cents"] == 1_000_000
    url = f"{BASE}/{project['id']}"
    assert reader.get(url).json()["name"] == "WLAN-Erneuerung"
    assert reader.put(url, json=project_body(), headers=HEADERS).status_code == 403
    assert reader.delete(url, headers=HEADERS).status_code == 403
    assert reader.get(f"{BASE}/999999").status_code == 404

    # Doppelte Namen, unsichere Links und falsche Daten werden abgelehnt.
    duplicate = editor.post(BASE, json=project_body(name="wlan-erneuerung"), headers=HEADERS)
    assert duplicate.status_code == 409
    for bad in (
        project_body(name="   "),
        project_body(name="a\nb"),
        project_body(status="erledigt"),
        project_body(starts_on="2026-05-01", ends_on="2026-04-01"),
        project_body(budget_cents=-1),
        project_body(links=[{"label": "Ablage", "url": "http://ablage.example.com"}]),
        project_body(links=[{"label": "Ablage", "url": "javascript:alert(1)"}]),
        project_body(people=[{"name": "X", "kind": "gast"}]),
        project_body(people=[{"name": ""}]),
    ):
        assert editor.post(BASE, json=bad, headers=HEADERS).status_code == 422, bad

    # Ändern ersetzt Personen und Links in der neuen Reihenfolge.
    changed = editor.put(
        url,
        json=project_body(
            name="WLAN neu",
            status="pausiert",
            budget_cents=None,
            people=[{"name": "Max Beispiel", "kind": "intern"}],
            links=[
                {"label": "Tickets", "url": "https://tickets.example.com"},
                {"label": "Ablage", "url": "https://ablage.example.com"},
            ],
        ),
        headers=HEADERS,
    ).json()
    assert (changed["name"], changed["status"]) == ("WLAN neu", "pausiert")
    assert [person["name"] for person in changed["people"]] == ["Max Beispiel"]
    assert [link["label"] for link in changed["links"]] == ["Tickets", "Ablage"]
    assert changed["budget"]["remaining_cents"] is None
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "projekte")).all())
    assert {"projekte.projekt_angelegt", "projekte.projekt_geaendert"} <= actions
    # Das Audit-Log enthält keine Namen von Personen.
    details = db.scalars(select(AuditLog.details).where(AuditLog.module == "projekte")).all()
    assert all("Erika" not in str(entry) for entry in details)


@pytest.mark.db
def test_budget_comes_from_the_items(db: Session) -> None:
    editor = client_for(["Projekte.Editor"], "projekt-budget")
    manager = client_for(["Budget.Manager"], "projekt-budgetverwalter")
    project = editor.post(BASE, json=project_body(), headers=HEADERS).json()
    closed = editor.post(
        BASE, json=project_body(name="Altes Projekt", status="abgeschlossen"), headers=HEADERS
    ).json()

    # Die Auswahl am Posten sehen auch Personen aus dem IT-Budget.
    choices = manager.get(f"{BASE}/choices").json()
    assert {entry["name"] for entry in choices} == {"WLAN-Erneuerung", "Altes Projekt"}
    assert (
        client_for(["Tenant.Reader"], "projekt-wahl-fremd").get(f"{BASE}/choices").status_code
        == 403
    )

    year = manager.get(f"{BUDGET}/settings").json()["current_year"]
    account = post(
        manager, "/accounts", {"number": "0720", "name": "Netzwerk", "kind": "investition"}
    ).json()
    points = post(
        manager,
        "/items",
        {
            "account_id": account["id"],
            "name": "Access Points",
            "amount_cents": 500_000,
            "start_year": year,
            "end_year": year,
            "project_id": project["id"],
        },
    )
    assert points.status_code == 201, points.text
    assert (points.json()["project_id"], points.json()["project_name"]) == (
        project["id"],
        "WLAN-Erneuerung",
    )
    install = post(
        manager,
        "/items",
        {
            "account_id": account["id"],
            "name": "Installation",
            "amount_cents": 200_000,
            "start_year": year,
            "end_year": year,
        },
    ).json()
    assert install["project_id"] is None
    # Einem abgeschlossenen Projekt lassen sich keine Posten zuordnen, auch keinem unbekannten.
    for project_id in (closed["id"], 999999):
        rejected = post(
            manager,
            "/items",
            {"account_id": account["id"], "name": f"Neu {project_id}", "project_id": project_id},
        )
        assert rejected.status_code == 422
    # Ändern ohne Angabe lässt die Zuordnung, mit Angabe setzt es sie.
    body = {"account_id": account["id"], "name": "Installation", "amount_cents": 200_000}
    unchanged = manager.put(f"{BUDGET}/items/{install['id']}", json=body, headers=HEADERS)
    assert unchanged.json()["project_id"] is None
    linked = manager.put(
        f"{BUDGET}/items/{install['id']}",
        json={**body, "project_id": project["id"]},
        headers=HEADERS,
    ).json()
    assert linked["project_name"] == "WLAN-Erneuerung"

    # Rechnung über 1000 netto (1190 brutto) auf die Access Points, gebucht, Posten bleibt offen.
    partner = post(manager, "/partners", {"name": "Beispiel Netz GmbH"}).json()
    invoice = post(
        manager,
        "/invoices",
        {
            "invoicer_id": partner["id"],
            "number": "RE-7",
            "invoice_date": f"{year}-02-01",
            "item_id": points.json()["id"],
            "net_cents": 1_000,
            "closes_item": False,
        },
    )
    assert invoice.status_code == 201, invoice.text

    reader = client_for(["Projekte.Reader"], "projekt-budget-leser")
    budget = reader.get(f"{BASE}/{project['id']}/budget").json()
    assert budget["sums"] == {
        "budget_cents": 1_000_000,
        "planned_cents": 500_000 - 1_190 + 200_000,
        "actual_cents": 1_190,
        "remaining_cents": 1_000_000 - 700_000,
        "items": 2,
    }
    assert [entry["name"] for entry in budget["items"]] == ["Access Points", "Installation"]
    assert [(entry["planned_cents"], entry["actual_cents"]) for entry in budget["years"]] == [
        (698_810, 1_190)
    ]
    summary = reader.get(BASE).json()
    assert [entry["budget"]["items"] for entry in summary] == [0, 2]

    # Löschen löst die Posten, sie selbst bleiben im IT-Budget.
    assert editor.delete(f"{BASE}/{project['id']}", headers=HEADERS).json() == {"deleted": True}
    items = manager.get(f"{BUDGET}/items").json()
    assert {entry["name"]: entry["project_id"] for entry in items} == {
        "Access Points": None,
        "Installation": None,
    }


@pytest.mark.db
def test_tasks(db: Session) -> None:
    editor = client_for(["Projekte.Editor"], "projekt-aufgaben")
    reader = client_for(["Projekte.Reader"], "projekt-aufgaben-leser")
    project = editor.post(BASE, json=project_body(), headers=HEADERS).json()
    url = f"{BASE}/{project['id']}/tasks"
    assert reader.post(url, json={"text": "x"}, headers=HEADERS).status_code == 403
    first = editor.post(url, json={"text": "Angebote vergleichen"}, headers=HEADERS).json()
    second = editor.post(
        url,
        json={"text": "Termin festlegen", "owner": "Erika", "due_on": "2026-03-01"},
        headers=HEADERS,
    ).json()
    assert editor.post(url, json={"text": "  "}, headers=HEADERS).status_code == 422
    # Offene mit Datum zuerst
    assert [task["id"] for task in reader.get(url).json()] == [second["id"], first["id"]]
    done = editor.put(
        f"{url}/{second['id']}", json={**second, "done": True}, headers=HEADERS
    ).json()
    assert done["done"] is True and done["done_at"] is not None
    assert [task["id"] for task in reader.get(url).json()] == [first["id"], second["id"]]
    overview = reader.get(f"{BASE}/{project['id']}").json()
    assert overview["open_tasks"] == 1
    assert [task["text"] for task in overview["tasks"]] == ["Angebote vergleichen"]
    # Aufgaben eines anderen Projekts lassen sich hier nicht ändern.
    other = editor.post(BASE, json=project_body(name="Anderes"), headers=HEADERS).json()
    assert (
        editor.delete(f"{BASE}/{other['id']}/tasks/{first['id']}", headers=HEADERS).status_code
        == 404
    )
    assert editor.delete(f"{url}/{first['id']}", headers=HEADERS).json() == {"deleted": True}
    assert len(reader.get(url).json()) == 1


@pytest.mark.db
def test_meetings_and_files(db: Session, tmp_path: Path) -> None:
    config = {"project_documents_dir": tmp_path, "project_document_max_mb": 1}
    editor = client_for(["Projekte.Editor"], "projekt-jf", **config)
    reader = client_for(["Projekte.Reader"], "projekt-jf-leser", **config)
    project = editor.post(BASE, json=project_body(), headers=HEADERS).json()
    url = f"{BASE}/{project['id']}/meetings"
    body = {
        "held_on": "2026-03-05",
        "title": "Jour Fixe",
        "body": "## Stand\r\n- Ausleuchtung fertig\n- [ ] Termin\t<script>",
    }
    assert reader.post(url, json=body, headers=HEADERS).status_code == 403
    for bad in (
        {**body, "title": ""},
        {**body, "body": "a\x00b"},
        {**body, "body": "x" * 50_001},
        {**body, "held_on": "1900-01-01"},
    ):
        assert editor.post(url, json=bad, headers=HEADERS).status_code == 422
    created = editor.post(url, json=body, headers=HEADERS)
    assert created.status_code == 201, created.text
    meeting = created.json()
    # Der Text bleibt, wie er ist (nur einheitliche Zeilenumbrüche); dargestellt wird er als Text.
    assert meeting["body"] == "## Stand\n- Ausleuchtung fertig\n- [ ] Termin\t<script>"
    later = editor.post(url, json={**body, "held_on": "2026-04-02"}, headers=HEADERS).json()
    assert [entry["id"] for entry in reader.get(url).json()] == [later["id"], meeting["id"]]
    assert reader.get(f"{BASE}/{project['id']}").json()["last_meeting"]["id"] == later["id"]

    files = f"{url}/{meeting['id']}/files"

    def upload(client: Any, data: bytes, **extra: str) -> Any:
        headers = {**HEADERS, "Content-Type": "application/pdf", "X-Dateiname": "Protokoll.pdf"}
        return client.post(files, content=data, headers={**headers, **extra})

    assert upload(reader, PDF).status_code == 403
    assert upload(editor, PDF, **{"Content-Type": "text/html"}).status_code == 415
    assert upload(editor, b"<html>").status_code == 422
    assert upload(editor, PDF + b"x" * (1024 * 1024)).status_code == 413
    saved = upload(editor, PDF)
    assert saved.status_code == 201, saved.text
    attached = saved.json()["files"]
    assert [(entry["name"], entry["size"]) for entry in attached] == [("Protokoll.pdf", len(PDF))]
    assert len(list(tmp_path.iterdir())) == 1
    assert reader.get(url).json()[1]["files"] == 1

    download = reader.get(f"{files}/{attached[0]['id']}")
    assert download.content == PDF
    assert download.headers["content-disposition"].startswith("attachment")
    assert download.headers["x-content-type-options"] == "nosniff"
    # Über ein anderes Projekt oder einen anderen Eintrag gibt es den Anhang nicht.
    assert reader.get(f"{url}/{later['id']}/files/{attached[0]['id']}").status_code == 404
    other = editor.post(BASE, json=project_body(name="Anderes"), headers=HEADERS).json()
    assert (
        reader.get(
            f"{BASE}/{other['id']}/meetings/{meeting['id']}/files/{attached[0]['id']}"
        ).status_code
        == 404
    )

    removed = editor.delete(f"{files}/{attached[0]['id']}", headers=HEADERS)
    assert removed.json()["files"] == []
    assert list(tmp_path.iterdir()) == []

    # Löschen des Eintrags und des Projekts räumt die Anhänge weg.
    upload(editor, PDF)
    assert editor.delete(f"{url}/{meeting['id']}", headers=HEADERS).json() == {"deleted": True}
    assert list(tmp_path.iterdir()) == []
    later_files = f"{url}/{later['id']}/files"
    editor.post(
        later_files,
        content=PDF,
        headers={**HEADERS, "Content-Type": "application/pdf", "X-Dateiname": "a.pdf"},
    )
    assert len(list(tmp_path.iterdir())) == 1
    assert editor.delete(f"{BASE}/{project['id']}", headers=HEADERS).status_code == 200
    assert list(tmp_path.iterdir()) == []
    assert reader.get(url).status_code == 404


@pytest.mark.db
def test_search_finds_projects(db: Session) -> None:
    editor = client_for(["Projekte.Editor"], "projekt-suche")
    editor.post(BASE, json=project_body(), headers=HEADERS)
    hits = editor.get("/api/search", params={"q": "access"}).json()["hits"]
    assert [(hit["module"], hit["title"]) for hit in hits] == [("IT-Projekte", "WLAN-Erneuerung")]
    stranger = client_for(["Budget.Reader"], "projekt-suche-fremd")
    assert stranger.get("/api/search", params={"q": "access"}).json()["hits"] == []
