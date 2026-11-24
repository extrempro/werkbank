"""Dokumentation (Phase D3): Kommentare an Textstellen, Erwähnungen, Verweise, Live-Bausteine,
Rückverweise und Benachrichtigungen."""

import base64
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from tests.test_doku import (
    ADMIN,
    BASE,
    client_for,
    db,  # noqa: F401 - Fixture
    member,
    new_page,
    oid_of,
    space,  # noqa: F401 - Fixture
)
from werkbank.core.sessions import now_utc
from werkbank.modules.budget.models import BudgetContract, BudgetPartner
from werkbank.modules.doku.content import ContentError, clean_content
from werkbank.modules.doku.d3_api import doku_notifications
from werkbank.modules.doku.models import DokuComment, DokuThread
from werkbank.modules.projects.models import Project, ProjectTask

ANCHOR = {
    "from": base64.b64encode(b"\x01\x02").decode(),
    "to": base64.b64encode(b"\x01\x03").decode(),
}


def ref(kind: str, ref_id: str) -> dict[str, Any]:
    return {"type": "werkbankRef", "attrs": {"kind": kind, "id": ref_id}}


def page_with(client: Any, space_id: int, title: str, *nodes: dict[str, Any]) -> Any:
    page = new_page(client, space_id, title)
    body = {"type": "doc", "content": [{"type": "paragraph", "content": list(nodes)}]}
    saved = client.put(
        f"{BASE}/pages/{page['id']}",
        json={"title": title, "content": body, "revision": page["revision"]},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


# --- ohne Datenbank -------------------------------------------------------------------------


def test_content_accepts_refs_and_live_blocks() -> None:
    content, text = clean_content(
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "Siehe "},
                        {
                            "type": "werkbankRef",
                            "attrs": {"kind": "ticket", "id": "1042", "label": "geheim"},
                        },
                    ],
                },
                {"type": "liveBlock", "attrs": {"kind": "tickets", "status": "offen", "q": "x"}},
            ],
        }
    )
    # Titel oder Stand werden nie gespeichert, unbekannte Eigenschaften fallen weg
    assert content["content"][0]["content"][1]["attrs"] == {"kind": "ticket", "id": "1042"}
    assert "geheim" not in text
    for bad in (
        {"type": "werkbankRef", "attrs": {"kind": "ticket", "id": "1;2"}},
        {"type": "werkbankRef", "attrs": {"kind": "konto", "id": "1"}},
        {"type": "werkbankRef", "attrs": {"kind": "ticket"}},
        {"type": "liveBlock", "attrs": {"kind": "tickets", "months": 7}},
        {"type": "liveBlock", "attrs": {"kind": "html"}},
        {"type": "liveBlock", "attrs": {"kind": "projekt", "project": True}},
    ):
        with pytest.raises(ContentError):
            clean_content({"type": "doc", "content": [{"type": "paragraph", "content": [bad]}]})


# --- Kommentare -----------------------------------------------------------------------------


@pytest.mark.db
def test_comments_mentions_and_rights(db: Session, space: int) -> None:  # noqa: F811
    ina = client_for("Ina Beispiel")
    lea = client_for("Lea Leser")
    max_ = client_for("Max Muster")
    otto = client_for("Otto Ohne")
    page = new_page(ina, space, "Drucker")
    base = f"{BASE}/pages/{page['id']}"

    # Wer lesen darf, darf kommentieren und nur Lesende erwähnen
    names = [p["name"] for p in lea.get(f"{base}/mentionable").json()]
    assert names == ["Ina Beispiel", "Lea Leser", "Max Muster"]
    assert lea.get(f"{base}/mentionable", params={"q": "max"}).json()[0]["oid"] == oid_of(
        "Max Muster"
    )
    bad = lea.post(
        f"{base}/threads",
        json={
            "anchor": ANCHOR,
            "quote": "Toner",
            "text": "Hallo",
            "mentions": [oid_of("Otto Ohne")],
        },
    )
    assert bad.status_code == 422
    created = lea.post(
        f"{base}/threads",
        json={
            "anchor": ANCHOR,
            "quote": "Toner  bestellen\n",
            "text": "Wer bestellt? @Max Muster",
            "mentions": [oid_of("Max Muster")],
        },
    )
    assert created.status_code == 201, created.text
    thread = created.json()
    assert thread["quote"] == "Toner bestellen"
    assert thread["anchor"] == ANCHOR
    assert thread["comments"][0]["own"] is True

    # Fremde sehen nichts
    assert otto.get(f"{base}/threads").status_code == 404
    assert (
        client_for("Otto Ohne", ["Doku.Nutzer"])
        .post(f"{BASE}/threads/{thread['id']}/comments", json={"text": "x"})
        .status_code
        == 404
    )

    answered = max_.post(f"{BASE}/threads/{thread['id']}/comments", json={"text": "Ich."})
    assert answered.status_code == 201
    assert [c["author_name"] for c in answered.json()["comments"]] == ["Lea Leser", "Max Muster"]

    done = ina.put(f"{BASE}/threads/{thread['id']}/resolved", json={"resolved": True})
    assert done.json()["resolved_by_name"] == "Ina Beispiel"
    assert (
        ina.put(f"{BASE}/threads/{thread['id']}/resolved", json={"resolved": False}).json()[
            "resolved_at"
        ]
        is None
    )

    # Löschen nur den eigenen Beitrag; der letzte nimmt den Faden mit
    first, second = answered.json()["comments"]
    assert lea.delete(f"{BASE}/comments/{second['id']}").status_code == 403
    assert max_.delete(f"{BASE}/comments/{second['id']}").status_code == 200
    assert lea.delete(f"{BASE}/comments/{first['id']}").status_code == 200
    assert lea.get(f"{base}/threads").json() == []


@pytest.mark.db
def test_comment_notifications(db: Session, space: int) -> None:  # noqa: F811
    ina = client_for("Ina Beispiel")
    lea = client_for("Lea Leser")
    max_ = client_for("Max Muster")
    page = new_page(ina, space, "Notizen")
    thread = lea.post(
        f"{BASE}/pages/{page['id']}/threads",
        json={"anchor": ANCHOR, "text": "Frage an @Max Muster", "mentions": [oid_of("Max Muster")]},
    ).json()
    max_.post(f"{BASE}/threads/{thread['id']}/comments", json={"text": "Antwort"})
    events = list(doku_notifications(db, None, now_utc()))  # type: ignore[arg-type]
    kinds = sorted(e.kind for e in events)
    assert kinds == ["doku.antwort", "doku.erwaehnung"]
    assert all("Notizen" not in e.title for e in events)
    assert all(e.link.endswith(f"?kommentar={thread['id']}") for e in events)

    # Wer die Seite nicht mehr lesen darf, bekommt nichts
    admin = client_for("Ada Admin", ["Doku.Admin"])
    admin.put(
        f"{ADMIN}/spaces/{space}",
        json={
            "name": "IT",
            "description": "",
            "members": [member("Ina Beispiel", "manage"), member("Max Muster", "edit")],
        },
    )
    events = list(doku_notifications(db, None, now_utc()))  # type: ignore[arg-type]
    assert [e.kind for e in events] == ["doku.erwaehnung"]
    db.execute(delete(DokuComment))
    db.execute(delete(DokuThread))
    db.commit()


# --- Verweise, Live-Bausteine, Rückverweise -------------------------------------------------


@pytest.fixture
def objects(db: Session) -> Iterator[dict[str, int]]:  # noqa: F811
    def cleanup() -> None:
        db.rollback()
        db.execute(delete(ProjectTask))
        db.execute(delete(BudgetContract))
        db.execute(delete(Project).where(Project.name == "Druckerumstellung"))
        db.execute(delete(BudgetPartner).where(BudgetPartner.name == "Firma A"))
        db.commit()

    cleanup()
    db.execute(delete(ProjectTask))
    db.execute(delete(BudgetContract))
    db.execute(delete(Project).where(Project.name == "Druckerumstellung"))
    db.execute(delete(BudgetPartner).where(BudgetPartner.name == "Firma A"))
    project = Project(name="Druckerumstellung", status="aktiv")
    partner = BudgetPartner(name="Firma A")
    db.add_all([project, partner])
    db.flush()
    db.add_all(
        [
            ProjectTask(project_id=project.id, text="Standorte festlegen"),
            ProjectTask(project_id=project.id, text="Bestellen", done=True),
        ]
    )
    today = date.today()
    contract = BudgetContract(
        title="Druckerwartung",
        partner_id=partner.id,
        starts_on=today - timedelta(days=200),
        ends_on=today + timedelta(days=120),
        notice_months=3,
        net_cents=10000,
        amount_cents=11900,
        interval="jaehrlich",
    )
    db.add(contract)
    db.commit()
    yield {"project": project.id, "contract": contract.id}
    cleanup()


@pytest.mark.db
def test_refs_follow_rights_of_reader(db: Session, space: int, objects: dict[str, int]) -> None:  # noqa: F811
    project = str(objects["project"])
    ina = client_for("Ina Beispiel", ["Doku.Nutzer", "Projekte.Reader", "Budget.Reader"])
    lea = client_for("Lea Leser", ["Doku.Nutzer"])
    refs = [{"kind": "projekt", "id": project}, {"kind": "vertrag", "id": str(objects["contract"])}]
    seen = ina.post(f"{BASE}/refs/resolve", json={"refs": refs}).json()
    assert seen[0]["title"] == "Druckerumstellung"
    assert seen[0]["detail"] == "1 von 2 Aufgaben erledigt"
    assert seen[0]["href"] == f"/projekte/{project}"
    assert seen[1]["status"].startswith("Kündigung bis ")
    # Ohne Rechte: nichts über das Objekt, nicht einmal ob es existiert
    hidden = lea.post(f"{BASE}/refs/resolve", json={"refs": refs}).json()
    assert hidden == [
        {
            "kind": k["kind"],
            "id": k["id"],
            "allowed": False,
            "found": False,
            "title": "",
            "status": "",
            "detail": "",
            "href": "",
        }
        for k in refs
    ]
    missing = ina.post(f"{BASE}/refs/resolve", json={"refs": [{"kind": "projekt", "id": "999999"}]})
    assert missing.json()[0] == {**missing.json()[0], "allowed": True, "found": False}
    assert (
        ina.post(f"{BASE}/refs/resolve", json={"refs": [{"kind": "x", "id": "1"}]}).status_code
        == 422
    )

    hits = ina.get(f"{BASE}/refs/search", params={"kind": "projekt", "q": "drucker"}).json()
    assert [h["id"] for h in hits] == [project]
    assert lea.get(f"{BASE}/refs/search", params={"kind": "projekt", "q": "drucker"}).json() == []

    # Live-Bausteine mit den Rechten der lesenden Person
    block = ina.post(
        f"{BASE}/live-bausteine/daten", json={"kind": "projekt", "project": int(project)}
    )
    assert block.json()["project"]["tasks"] == [{"text": "Standorte festlegen", "due": None}]
    assert lea.post(
        f"{BASE}/live-bausteine/daten", json={"kind": "projekt", "project": int(project)}
    ).json() == {
        "kind": "projekt",
        "allowed": False,
        "title": "",
        "rows": None,
        "project": None,
        "note": "",
    }
    deadlines = ina.post(f"{BASE}/live-bausteine/daten", json={"kind": "vertraege", "months": 3})
    assert [r["title"] for r in deadlines.json()["rows"]] == ["Druckerwartung"]
    tickets = ina.post(f"{BASE}/live-bausteine/daten", json={"kind": "tickets"}).json()
    assert tickets["allowed"] is False
    options = ina.get(f"{BASE}/live-bausteine/optionen").json()
    assert {"id": int(project), "name": "Druckerumstellung"} in options["projects"]
    assert lea.get(f"{BASE}/live-bausteine/optionen").json()["projects"] == []


@pytest.mark.db
def test_backlinks_only_for_readable_pages(
    db: Session,  # noqa: F811
    space: int,  # noqa: F811
    objects: dict[str, int],
) -> None:
    project = str(objects["project"])
    ina = client_for("Ina Beispiel", ["Doku.Nutzer", "Projekte.Reader"])
    visible = page_with(
        ina, space, "Mit Verweis", {"type": "text", "text": "Siehe "}, ref("projekt", project)
    )
    secret = page_with(ina, space, "Geheim", ref("projekt", project))
    rights = ina.put(
        f"{BASE}/pages/{secret['id']}/rights",
        json={"own_rights": True, "entries": [member("Max Muster", "none")]},
    )
    assert rights.status_code == 200, rights.text
    max_ = client_for("Max Muster", ["Doku.Nutzer", "Projekte.Reader"])
    titles = [
        p["title"]
        for p in max_.get(f"{BASE}/backlinks", params={"kind": "projekt", "id": project}).json()
    ]
    assert titles == ["Mit Verweis"]
    assert sorted(
        p["title"]
        for p in ina.get(f"{BASE}/backlinks", params={"kind": "projekt", "id": project}).json()
    ) == ["Geheim", "Mit Verweis"]
    # Ohne Recht am Objekt keine Liste
    lea = client_for("Lea Leser", ["Doku.Nutzer"])
    assert lea.get(f"{BASE}/backlinks", params={"kind": "projekt", "id": project}).json() == []
    assert visible["id"]
