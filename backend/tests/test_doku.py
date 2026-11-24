"""Dokumentation (Phase D1): Rollen, Arbeitsbereiche, Seiten, Inhalt, eigene Rechte, Sperren,
Versionen, Papierkorb, Verwaltung."""

import tempfile
from datetime import timedelta
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import set_setting
from werkbank.core.sessions import now_utc
from werkbank.main import create_app
from werkbank.modules.doku.content import ContentError, clean_content
from werkbank.modules.doku.models import (
    DokuPage,
    DokuPageRight,
    DokuSpace,
    DokuSpaceMember,
    DokuVersion,
)
from werkbank.modules.doku.service import cleanup, flush_versions
from werkbank.modules.inventory.people import Person, get_people_finder

ORIGIN = "https://testserver"
HEADERS = {"Origin": ORIGIN}
BASE = "/api/doku"
ADMIN = f"{BASE}/admin"
KEY_FILE = Path(tempfile.mkdtemp()) / "settings_key"
KEY_FILE.write_text("nur-fuer-tests-" + "x" * 40, encoding="utf-8")


def client_for(name: str, roles: list[str] | None = None) -> TestClient:
    settings = Settings(
        public_url=ORIGIN, environment="test", enable_test_login=True, settings_key_file=KEY_FILE
    )
    client = TestClient(
        create_app(settings), base_url=ORIGIN, follow_redirects=False, headers=HEADERS
    )
    response = client.post(
        "/auth/test-login",
        json={
            "oid": name.lower().replace(" ", "-"),
            "name": name,
            "roles": roles or ["Doku.Nutzer"],
        },
    )
    assert response.status_code == 303, response.text
    return client


def oid_of(name: str) -> str:
    return "test:" + name.lower().replace(" ", "-")


def member(name: str, role: str) -> dict[str, str]:
    return {"oid": oid_of(name), "name": name, "role": role}


def doc(*paragraphs: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paragraphs
        ],
    }


@pytest.fixture
def db(db_session: Session) -> Session:
    for table in (DokuVersion, DokuPageRight, DokuPage, DokuSpaceMember, DokuSpace):
        db_session.execute(delete(table))
    set_setting(db_session, "doku", {}, None)
    db_session.commit()
    return db_session


@pytest.fixture
def space(db: Session) -> int:
    admin = client_for("Ada Admin", ["Doku.Admin"])
    created = admin.post(
        f"{ADMIN}/spaces",
        json={
            "name": "IT",
            "description": "Abteilung IT",
            "members": [
                member("Ina Beispiel", "manage"),
                member("Max Muster", "edit"),
                member("Lea Leser", "read"),
            ],
        },
    )
    assert created.status_code == 201, created.text
    return int(created.json()["id"])


def new_page(client: TestClient, space_id: int, title: str, parent: str | None = None) -> Any:
    response = client.post(
        f"{BASE}/pages", json={"space_id": space_id, "parent_id": parent, "title": title}
    )
    assert response.status_code == 201, response.text
    return response.json()


def save(client: TestClient, page: Any, *paragraphs: str, title: str | None = None) -> Any:
    return client.put(
        f"{BASE}/pages/{page['id']}",
        json={
            "title": title or page["title"],
            "content": doc(*paragraphs),
            "revision": page["revision"],
        },
    )


# --- ohne Datenbank -------------------------------------------------------------------------


def test_content_whitelist() -> None:
    content, text = clean_content(
        {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 2, "id": "x"},
                    "content": [{"type": "text", "text": "Drucker"}],
                },
                {
                    "type": "callout",
                    "attrs": {"kind": "warnung"},
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Siehe Handbuch",
                                    "marks": [
                                        {
                                            "type": "link",
                                            "attrs": {
                                                "href": "https://example.com",
                                                "target": "_self",
                                            },
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "taskList",
                    "content": [
                        {
                            "type": "taskItem",
                            "attrs": {"checked": True},
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "Toner"}],
                                }
                            ],
                        }
                    ],
                },
            ],
        }
    )
    # Unbekannte Eigenschaft fällt weg, Link-Ziel ist fest
    assert content["content"][0]["attrs"] == {"level": 2}
    link = content["content"][1]["content"][0]["content"][0]["marks"][0]["attrs"]
    assert link["target"] == "_blank" and link["rel"] == "noopener noreferrer nofollow"
    assert text == "Drucker Siehe Handbuch Toner"
    with pytest.raises(ContentError):
        clean_content({"type": "doc", "content": [{"type": "iframe"}]})
    bad_link = {
        "type": "text",
        "text": "x",
        "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}],
    }
    with pytest.raises(ContentError):
        clean_content({"type": "doc", "content": [{"type": "paragraph", "content": [bad_link]}]})
    with pytest.raises(ContentError):
        clean_content({"type": "doc", "content": [{"type": "heading", "attrs": {"level": 7}}]})
    deep: dict[str, Any] = {"type": "paragraph"}
    for _ in range(50):
        deep = {"type": "blockquote", "content": [deep]}
    with pytest.raises(ContentError):
        clean_content({"type": "doc", "content": [deep]})


# --- mit Datenbank --------------------------------------------------------------------------


@pytest.mark.db
def test_roles_and_admin(db: Session, space: int) -> None:
    assert client_for("Ohne Rolle", ["Tools.User"]).get(f"{BASE}/me").status_code == 403
    assert client_for("Ina Beispiel").get(f"{ADMIN}/spaces").status_code == 403
    admin = client_for("Ada Admin", ["Doku.Admin"])
    listed = admin.get(f"{ADMIN}/spaces").json()
    assert [(s["name"], s["people"], s["pages"]) for s in listed] == [("IT", 3, 0)]
    # Doku.Admin ist nicht automatisch Mitglied und sieht keine Inhalte
    assert admin.get(f"{BASE}/me").json() == {"is_admin": True, "spaces": []}
    assert admin.post(f"{ADMIN}/spaces", json={"name": "it"}).status_code == 409
    me = client_for("Ina Beispiel").get(f"{BASE}/me").json()
    assert me["spaces"][0]["role"] == "manage" and me["is_admin"] is False
    assert client_for("Nora Niemand").get(f"{BASE}/tree").json() == []


@pytest.mark.db
def test_pages_save_search_and_conflict(db: Session, space: int) -> None:
    max_ = client_for("Max Muster")
    lea = client_for("Lea Leser")
    page = new_page(max_, space, "Drucker einrichten")
    child = new_page(max_, space, "Treiber", page["id"])
    assert child["path"] == [{"id": page["id"], "title": "Drucker einrichten"}]
    # Lesen darf nicht anlegen oder speichern
    assert lea.post(f"{BASE}/pages", json={"space_id": space, "title": "X"}).status_code == 403
    assert save(lea, page, "Hallo").status_code == 403
    saved = save(max_, page, "Toner wechseln im Lager", title="Drucker einrichten")
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    # Veralteter Stand: 409
    assert save(max_, page, "anderer Text").status_code == 409
    bad = max_.put(
        f"{BASE}/pages/{page['id']}",
        json={
            "title": "x",
            "content": {"type": "doc", "content": [{"type": "script"}]},
            "revision": 2,
        },
    )
    assert bad.status_code == 422
    hits = lea.get(f"{BASE}/search", params={"q": "toner"}).json()
    assert [h["title"] for h in hits] == ["Drucker einrichten"]
    assert "Toner" in hits[0]["snippet"]
    tree = lea.get(f"{BASE}/tree").json()
    assert [(p["title"], p["parent_id"] is not None) for p in tree[0]["pages"]] == [
        ("Drucker einrichten", False),
        ("Treiber", True),
    ]
    assert client_for("Nora Niemand").get(f"{BASE}/pages/{page['id']}").status_code == 404
    # Nicht unter die eigene Unterseite schieben
    moved = max_.post(f"{BASE}/pages/{page['id']}/move", json={"parent_id": child["id"]})
    assert moved.status_code == 409
    up = max_.post(
        f"{BASE}/pages/{child['id']}/move", json={"parent_id": None, "before_id": page["id"]}
    )
    assert up.status_code == 200
    order = [p["title"] for p in max_.get(f"{BASE}/tree").json()[0]["pages"]]
    assert order == ["Treiber", "Drucker einrichten"]


@pytest.mark.db
def test_own_rights_lock_and_guests(db: Session, space: int) -> None:
    ina = client_for("Ina Beispiel")
    lea = client_for("Lea Leser")
    page = new_page(ina, space, "Gehälter")
    child = new_page(ina, space, "Details", page["id"])
    rights = ina.put(
        f"{BASE}/pages/{page['id']}/rights",
        json={
            "own_rights": True,
            "entries": [member("Lea Leser", "none"), member("Gast Person", "read")],
        },
    )
    assert rights.status_code == 200, rights.text
    # Kein Zugriff gilt auch für die Unterseite
    assert lea.get(f"{BASE}/pages/{page['id']}").status_code == 404
    assert lea.get(f"{BASE}/pages/{child['id']}").status_code == 404
    assert lea.get(f"{BASE}/tree").json()[0]["pages"] == []
    inherited = ina.get(f"{BASE}/pages/{child['id']}/rights").json()
    assert inherited["inherited_from"]["id"] == page["id"]
    assert ina.get(f"{BASE}/pages/{child['id']}").json()["rights_from"]["title"] == "Gehälter"
    # Gast ohne Mitgliedschaft sieht nur diese Seiten, darf nicht schreiben
    guest = client_for("Gast Person")
    titles = [p["title"] for p in guest.get(f"{BASE}/tree").json()[0]["pages"]]
    assert sorted(titles) == ["Details", "Gehälter"]
    assert save(guest, guest.get(f"{BASE}/pages/{page['id']}").json(), "x").status_code == 403
    admin = client_for("Ada Admin", ["Doku.Admin"])
    listed = admin.get(f"{ADMIN}/own-rights").json()
    assert listed[0]["summary"] == "1 lesen, 1 ohne Zugriff"
    assert admin.post(f"{ADMIN}/pages/{page['id']}/reset-rights").status_code == 200
    assert lea.get(f"{BASE}/pages/{child['id']}").status_code == 200

    # Sperren: niemand speichert, bis jemand entsperrt
    max_ = client_for("Max Muster")
    locked = max_.post(f"{BASE}/pages/{page['id']}/lock").json()
    assert locked["locked"] is True and locked["locked_by_name"] == "Max Muster"
    assert save(ina, locked, "neu").status_code == 409
    assert ina.delete(f"{BASE}/pages/{page['id']}").status_code == 409
    unlocked = ina.delete(f"{BASE}/pages/{page['id']}/lock").json()
    assert save(ina, unlocked, "neu").status_code == 200
    assert lea.post(f"{BASE}/pages/{page['id']}/lock").status_code == 403


@pytest.mark.db
def test_versions_named_restore_and_job(db: Session, space: int) -> None:
    max_ = client_for("Max Muster")
    page = new_page(max_, space, "Notizen")
    first = save(max_, page, "Stand eins").json()
    # Bearbeitung seit über 10 Minuten: der nächste Speicher-Vorgang legt eine Version an
    db.execute(
        update(DokuPage)
        .where(DokuPage.title == "Notizen")
        .values(editing_since=now_utc() - timedelta(minutes=11))
    )
    db.commit()
    second = save(max_, first, "Stand zwei").json()
    versions = max_.get(f"{BASE}/pages/{page['id']}/versions").json()
    assert len(versions) == 1 and versions[0]["authors"] == "Max Muster"
    named = max_.post(f"{BASE}/pages/{page['id']}/versions", json={"name": "Freigegeben"})
    assert named.status_code == 201
    old = versions[0]["id"]
    detail = max_.get(f"{BASE}/pages/{page['id']}/versions/{old}").json()
    assert detail["content"] == doc("Stand zwei")
    third = save(max_, second, "Stand drei").json()
    restored = max_.post(
        f"{BASE}/pages/{page['id']}/versions/{old}/restore", json={"reason": "Fehler"}
    )
    assert restored.status_code == 200
    assert restored.json()["content"] == doc("Stand zwei")
    assert restored.json()["revision"] > third["revision"]
    notes = [v["note"] for v in max_.get(f"{BASE}/pages/{page['id']}/versions").json()]
    assert notes[0].startswith("Wiederhergestellt: Stand vom") and notes[0].endswith(
        "Grund: Fehler"
    )
    assert "Stand vor dem Wiederherstellen" in notes
    lea = client_for("Lea Leser")
    assert lea.post(f"{BASE}/pages/{page['id']}/versions/{old}/restore", json={}).status_code == 403
    # Auftrag: liegt die letzte Bearbeitung länger zurück, entsteht die Version ohne Speichern
    save(max_, restored.json(), "Stand vier")
    db.execute(
        update(DokuPage)
        .where(DokuPage.title == "Notizen")
        .values(editing_since=now_utc() - timedelta(minutes=20))
    )
    db.commit()
    assert flush_versions(db) == 1
    assert flush_versions(db) == 0


@pytest.mark.db
def test_trash_restore_purge_and_cleanup(db: Session, space: int) -> None:
    max_ = client_for("Max Muster")
    admin = client_for("Ada Admin", ["Doku.Admin"])
    page = new_page(max_, space, "Alt")
    new_page(max_, space, "Unterseite", page["id"])
    assert max_.delete(f"{BASE}/pages/{page['id']}").status_code == 200
    assert max_.get(f"{BASE}/tree").json()[0]["pages"] == []
    trash = admin.get(f"{ADMIN}/trash").json()
    assert [(t["title"], t["pages"], t["deleted_by_name"]) for t in trash] == [
        ("Alt", 2, "Max Muster")
    ]
    assert admin.post(f"{ADMIN}/trash/{page['id']}/restore").status_code == 200
    assert len(max_.get(f"{BASE}/tree").json()[0]["pages"]) == 2
    max_.delete(f"{BASE}/pages/{page['id']}")
    assert admin.delete(f"{ADMIN}/trash/{page['id']}").status_code == 200
    assert db.scalars(select(DokuPage)).all() == []
    # Nach 30 Tagen leert der Auftrag den Papierkorb
    other = new_page(max_, space, "Weg")
    max_.delete(f"{BASE}/pages/{other['id']}")
    db.execute(update(DokuPage).values(deleted_at=now_utc() - timedelta(days=31)))
    db.commit()
    assert cleanup(db)["seiten"] == 1
    # Leerer Arbeitsbereich lässt sich löschen, mit Seiten nicht
    new_page(max_, space, "Bleibt")
    assert admin.delete(f"{ADMIN}/spaces/{space}").status_code == 409


@pytest.mark.db
def test_members_by_manager_archive_and_settings(db: Session, space: int) -> None:
    ina = client_for("Ina Beispiel")
    max_ = client_for("Max Muster")
    page = new_page(max_, space, "Seite")
    body = {"members": [member("Ina Beispiel", "manage"), member("Max Muster", "read")]}
    assert max_.put(f"{BASE}/spaces/{space}/members", json=body).status_code == 404
    assert ina.put(f"{BASE}/spaces/{space}/members", json=body).status_code == 200
    assert save(max_, page, "x").status_code == 403
    selfless = {"members": [member("Ina Beispiel", "edit")]}
    assert ina.put(f"{BASE}/spaces/{space}/members", json=selfless).status_code == 409
    admin = client_for("Ada Admin", ["Doku.Admin"])
    archived = admin.put(
        f"{ADMIN}/spaces/{space}",
        json={"name": "IT", "archived": True, "members": [member("Ina Beispiel", "manage")]},
    )
    assert archived.status_code == 200
    assert client_for("Ina Beispiel").get(f"{BASE}/pages/{page['id']}").json()["role"] == "read"
    assert admin.get(f"{ADMIN}/settings").json() == {"version_minutes": 10, "keep_auto": "1y"}
    changed = admin.put(f"{ADMIN}/settings", json={"version_minutes": 30, "keep_auto": "immer"})
    assert changed.json() == {"version_minutes": 30, "keep_auto": "immer"}
    assert (
        admin.put(f"{ADMIN}/settings", json={"version_minutes": 7, "keep_auto": "1y"}).status_code
        == 422
    )


@pytest.mark.db
def test_people_search_needs_edit(db: Session, space: int) -> None:
    ina = client_for("Ina Beispiel")
    cast(FastAPI, ina.app).dependency_overrides[get_people_finder] = lambda: (
        lambda q: [
            Person(
                oid="ABC-1",
                name="Ina Beispiel",
                upn="ina@example.com",
                department="IT",
                job_title="",
                enabled=True,
            )
        ]
    )
    found = ina.get(f"{BASE}/people", params={"q": "ina"})
    assert found.status_code == 200 and found.json()[0]["oid"] == "abc-1"
    assert client_for("Lea Leser").get(f"{BASE}/people", params={"q": "ina"}).status_code == 403
