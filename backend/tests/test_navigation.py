"""Angeheftete und zuletzt besuchte Seiten: nur eigene Einträge, nur erlaubte Seiten."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from tests.test_evergreen_api import HEADERS, ORIGIN, client_for
from werkbank.config import Settings
from werkbank.core.models import NavEntry
from werkbank.core.navigation import PAGES, PINS_MAX, RECENT_MAX, allowed
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.main import create_app
from werkbank.modules.inventory.models import InventoryCase

BASE = "/api/navigation"


def user(*roles: str) -> CurrentUser:
    now = now_utc()
    return CurrentUser(
        user_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        display_name="Ina",
        email=None,
        roles=tuple(roles),
        authenticated_at=now,
        expires_at=now,
    )


def test_allowed_follows_roles() -> None:
    nobody = user()
    assert allowed(nobody, "/")
    assert allowed(nobody, "/suche")
    assert not allowed(nobody, "/budget")
    assert not allowed(nobody, "/verwaltung")
    assert not allowed(nobody, "/unbekannt")
    assert not allowed(nobody, "https://example.com/")

    budget = user("Budget.Reader")
    assert allowed(budget, "/budget/rechnungen")
    assert not allowed(budget, "/budget/import")
    assert allowed(user("Budget.Manager"), "/budget/import")

    tools = user("Tools.User")
    assert allowed(tools, "/it-tools/kategorie/netzwerk")
    assert not allowed(tools, "/it-tools/kategorie/gibtsnicht")
    assert not allowed(user("Config.Reader"), "/it-tools/kategorie/netzwerk")

    assert allowed(user("Werkbank.Admin"), "/monitoring/dns")
    assert allowed(user("Monitoring.Reader"), "/monitoring/dns")
    assert allowed(user("Bestand.Reader"), "/bestand/verleih")
    assert not allowed(user("Bestand.Reader"), "/m365/lizenzen")
    # Nur Pfade, keine Detailseiten oder Abfragen
    assert all(path.startswith("/") and "?" not in path for path in PAGES)


def test_navigation_requires_login() -> None:
    anonymous = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    assert anonymous.get(BASE).status_code == 401


@pytest.mark.db
def test_pins_are_validated_and_own(db_session: Session) -> None:
    db_session.execute(delete(NavEntry))
    db_session.commit()
    ada = client_for(["Budget.Reader"], "nav-ada", "Ada")
    assert ada.get(BASE).json() == {"pinned": [], "recent": []}

    saved = ada.put(f"{BASE}/pins", json={"paths": ["/budget/rechnungen", "/"]}, headers=HEADERS)
    assert saved.status_code == 200, saved.text
    assert saved.json()["pinned"] == ["/budget/rechnungen", "/"]

    # Seiten ohne Recht, fremde Adressen und unbekannte Pfade lassen sich nicht anheften.
    for path in ("/budget/import", "/verwaltung", "https://example.com/", "/budget/rechnungen/7"):
        refused = ada.put(f"{BASE}/pins", json={"paths": [path]}, headers=HEADERS)
        assert refused.status_code == 422, path
    too_many = ada.put(f"{BASE}/pins", json={"paths": ["/"] * (PINS_MAX + 1)}, headers=HEADERS)
    assert too_many.status_code == 422
    assert ada.get(BASE).json()["pinned"] == ["/budget/rechnungen", "/"]

    # Andere Personen sehen nichts davon.
    bea = client_for(["Budget.Reader"], "nav-bea", "Bea")
    assert bea.get(BASE).json() == {"pinned": [], "recent": []}

    # Ohne Rolle verschwindet die Seite bei der Ausgabe, bleibt aber gespeichert.
    ada_without = client_for(["Config.Reader"], "nav-ada", "Ada")
    assert ada_without.get(BASE).json()["pinned"] == ["/"]
    ada_again = client_for(["Budget.Reader"], "nav-ada", "Ada")
    assert ada_again.get(BASE).json()["pinned"] == ["/budget/rechnungen", "/"]


@pytest.mark.db
def test_recent_keeps_last_ten(db_session: Session) -> None:
    db_session.execute(delete(NavEntry))
    db_session.commit()
    ina = client_for(["Tools.User"], "nav-ina", "Ina")
    paths = ["/", "/suche", "/it-tools", "/it-tools/verlauf"] + [
        f"/it-tools/kategorie/{c}"
        for c in ("netzwerk", "system", "encoding", "formatter", "text", "rechner", "planung")
    ]
    for path in paths:
        response = ina.post(f"{BASE}/recent", json={"path": path}, headers=HEADERS)
        assert response.status_code == 200, response.text
    recent = ina.get(BASE).json()["recent"]
    assert len(recent) == RECENT_MAX
    assert recent[0] == paths[-1]
    assert "/" not in recent

    # Ein erneuter Besuch rückt nach vorn, ohne doppelt zu zählen.
    ina.post(f"{BASE}/recent", json={"path": "/suche"}, headers=HEADERS)
    recent = ina.get(BASE).json()["recent"]
    assert recent[0] == "/suche" and recent.count("/suche") == 1

    # Fremde Seiten werden nicht gemerkt.
    ina.post(f"{BASE}/recent", json={"path": "/verwaltung"}, headers=HEADERS)
    assert "/verwaltung" not in ina.get(BASE).json()["recent"]

    cleared = ina.delete(f"{BASE}/recent", headers=HEADERS)
    assert cleared.status_code == 200
    assert cleared.json()["recent"] == []


@pytest.mark.db
def test_open_cases_task_for_inventory_editors(db_session: Session) -> None:
    db_session.add(InventoryCase(number="V-NAV-1", kind="neu", status="neu", title="Gerät"))
    db_session.commit()
    editor = client_for(["Bestand.Editor"], "nav-bestand-editor")
    tasks = editor.get("/api/tasks").json()["tasks"]
    assert any(task["link"] == "/bestand/vorgaenge" for task in tasks)

    reader = client_for(["Bestand.Reader"], "nav-bestand-leser")
    tasks = reader.get("/api/tasks").json()["tasks"]
    assert not any(task["link"] == "/bestand/vorgaenge" for task in tasks)
    db_session.execute(delete(InventoryCase).where(InventoryCase.number == "V-NAV-1"))
    db_session.commit()
