"""Rückmeldungen: senden, eigene sehen, Admins lesen und antworten, Glocke, Aufräumen."""

import base64
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS
from tests.test_m365_api import client_for
from werkbank.config import Settings
from werkbank.modules.feedback.api import PER_HOUR, image_type, purge_screenshots
from werkbank.modules.feedback.models import FeedbackEntry
from werkbank.modules.feedback.notifications import feedback_notifications

BASE = "/api/feedback"
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40).decode()


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    db_session.execute(delete(FeedbackEntry))
    db_session.commit()
    yield db_session
    db_session.rollback()
    db_session.execute(delete(FeedbackEntry))
    db_session.commit()


def test_image_type_by_content() -> None:
    assert image_type(b"\x89PNG\r\n\x1a\nxx") == "image/png"
    assert image_type(b"\xff\xd8\xff\xe0xx") == "image/jpeg"
    assert image_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert image_type(b"<svg xmlns=") is None


@pytest.mark.db
def test_send_and_read_own_feedback(db: Session) -> None:
    person = client_for(["Bestand.Reader"], "rm-person")
    other = client_for(["Bestand.Reader"], "rm-andere")
    body = {
        "kind": "fehler",
        "text": "Beim Abschließen kommt ein Fehler.\nZweite Zeile.",
        "page": "/bestand/ausgaben/3",
        "technical": {
            "version": "0.151.0",
            "window": "1280 \u00d7 800",
            "browser_errors": ["TypeError: x is undefined\nzweite"] * 8,
        },
        "screenshot": PNG,
    }
    created = person.post(BASE, json=body, headers={**HEADERS, "User-Agent": "Test\nBrowser"})
    assert created.status_code == 200, created.text
    entry = created.json()
    assert entry["number"].startswith("RM-") and entry["status"] == "neu"
    # Die Person sieht keine technischen Angaben und kein Bild
    assert entry["technical"] == {} and entry["has_screenshot"] is False
    stored = db.get(FeedbackEntry, entry["id"])
    assert stored is not None and stored.screenshot_type == "image/png"
    assert stored.technical["version"] == "0.151.0"
    assert stored.technical["window"] == "1280 \u00d7 800"
    assert stored.technical["browser"] == "Test Browser"
    assert len(stored.technical["browser_errors"]) == 5
    assert all("\n" not in line for line in stored.technical["browser_errors"])

    mine = person.get(f"{BASE}/mine").json()
    assert [row["id"] for row in mine] == [entry["id"]]
    assert other.get(f"{BASE}/mine").json() == []
    assert other.get(f"{BASE}/{entry['id']}").status_code == 404
    assert person.get(f"{BASE}/{entry['id']}/screenshot").status_code == 403
    assert person.get(BASE).status_code == 403


@pytest.mark.db
def test_validation_and_limits(db: Session) -> None:
    person = client_for(["Bestand.Reader"], "rm-pruefen")
    short = person.post(BASE, json={"kind": "idee", "text": "ok"}, headers=HEADERS)
    assert short.status_code == 422
    foreign = person.post(
        BASE, json={"kind": "idee", "text": "Eine Idee", "page": "//example.com"}, headers=HEADERS
    )
    assert foreign.status_code == 422
    svg = base64.b64encode(b"<svg onload=alert(1)>").decode()
    bad = person.post(
        BASE, json={"kind": "fehler", "text": "Fehler mit Bild", "screenshot": svg}, headers=HEADERS
    )
    assert bad.status_code == 422
    idea_image = person.post(
        BASE, json={"kind": "idee", "text": "Idee mit Bild", "screenshot": PNG}, headers=HEADERS
    )
    assert idea_image.status_code == 422
    for index in range(PER_HOUR):
        ok = person.post(BASE, json={"kind": "idee", "text": f"Idee {index}"}, headers=HEADERS)
        assert ok.status_code == 200
    again = person.post(BASE, json={"kind": "idee", "text": "Noch eine"}, headers=HEADERS)
    assert again.status_code == 429


@pytest.mark.db
def test_admin_reads_answers_and_closes(db: Session) -> None:
    person = client_for(["Bestand.Reader"], "rm-melder")
    admin = client_for(["Werkbank.Admin"], "rm-admin")
    entry = person.post(
        BASE,
        json={"kind": "fehler", "text": "Diagramm bleibt leer", "screenshot": PNG},
        headers=HEADERS,
    ).json()
    idea = person.post(BASE, json={"kind": "idee", "text": "Dunkles Logo"}, headers=HEADERS).json()

    listed = admin.get(BASE, params={"state": "fehler"}).json()
    assert [row["id"] for row in listed["entries"]] == [entry["id"]]
    assert listed["open"] == 2
    view = admin.get(f"{BASE}/{entry['id']}").json()
    assert view["has_screenshot"] is True and "browser" in view["technical"]
    shot = admin.get(f"{BASE}/{entry['id']}/screenshot")
    assert shot.headers["content-type"] == "image/png"
    assert shot.headers["x-content-type-options"] == "nosniff"
    assert shot.headers["cache-control"] == "no-store"

    replied = admin.post(
        f"{BASE}/{entry['id']}/replies", json={"text": "Danke, ist behoben."}, headers=HEADERS
    ).json()
    assert [r["text"] for r in replied["reply_list"]] == ["Danke, ist behoben."]
    done = admin.put(
        f"{BASE}/{entry['id']}/status", json={"status": "erledigt"}, headers=HEADERS
    ).json()
    assert done["status"] == "erledigt" and done["closed_at"] is not None
    assert (
        person.put(
            f"{BASE}/{idea['id']}/status", json={"status": "erledigt"}, headers=HEADERS
        ).status_code
        == 403
    )

    mine = {row["id"]: row for row in person.get(f"{BASE}/mine").json()}
    assert mine[entry["id"]]["reply_list"][0]["text"] == "Danke, ist behoben."
    assert mine[entry["id"]]["status"] == "erledigt"

    # Glocke: neue Rückmeldung an Admins, Antwort und Stand an die Person; ohne Inhalte
    owner = db.scalars(select(FeedbackEntry.user_id).where(FeedbackEntry.id == entry["id"])).one()
    events = list(feedback_notifications(db, Settings(environment="test"), datetime.now(UTC)))
    kinds = {(event.kind, event.user_ids) for event in events}
    assert ("rueckmeldung.antwort", frozenset({owner})) in kinds
    assert ("rueckmeldung.stand", frozenset({owner})) in kinds
    assert any(event.kind == "rueckmeldung.neu" for event in events)
    assert all("Diagramm" not in event.title for event in events)

    # Bildschirmfoto 30 Tage nach Abschluss weg
    stored = db.get(FeedbackEntry, entry["id"])
    assert stored is not None
    db.refresh(stored)
    assert purge_screenshots(db, datetime.now(UTC) + timedelta(days=29)) == 0
    assert purge_screenshots(db, datetime.now(UTC) + timedelta(days=31)) == 1
    db.commit()
    db.refresh(stored)
    assert stored.screenshot is None
