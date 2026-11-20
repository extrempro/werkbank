"""IT-Bestand: Verleih, Nachrichten an die Person und Vorgänge zu Rückgabe und Überfälligkeit."""

import re
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from tests.inventory_rooms import room_for_tests
from tests.test_admin_settings import HEADERS, settings_with_key
from tests.test_m365_api import client_for
from werkbank.core.app_settings import (
    SMTP_KEY,
    TEAMS_KEY,
    encrypt_secret,
    set_setting,
)
from werkbank.core.mail import SmtpConfig
from werkbank.core.models import AppSetting
from werkbank.modules.inventory.loans import (
    check_loans,
    local_today,
    send_pending,
)
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryHardware,
    InventoryKind,
    InventoryLoan,
    InventoryLoanMessage,
    InventoryWorkplace,
)
from werkbank.modules.inventory.people import PeopleError, Person, get_person_lookup

BASE = "/api/inventory"
OID = "11111111-2222-3333-4444-555555555555"
DISABLED = "99999999-2222-3333-4444-555555555555"
PEOPLE = {
    OID: Person(
        oid=OID,
        name="Pia Beispiel",
        upn="pia@example.com",
        department="",
        job_title="",
        enabled=True,
        mail="pia.beispiel@example.com",
    ),
    DISABLED: Person(
        oid=DISABLED,
        name="Alt Konto",
        upn="alt@example.com",
        department="",
        job_title="",
        enabled=False,
        mail="",
    ),
}


def lookup(oid: str) -> Person | None:
    if oid.startswith("0000"):
        raise PeopleError("Microsoft Graph antwortet mit 503")
    return PEOPLE.get(oid)


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryLoan))
        db_session.execute(delete(InventoryCase))
        db_session.execute(delete(InventoryHardware))
        db_session.execute(delete(InventoryWorkplace))
        db_session.execute(delete(AppSetting).where(AppSetting.key.in_((SMTP_KEY, TEAMS_KEY))))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def editor() -> TestClient:
    client = client_for(["Bestand.Editor"], "verleih-bearbeiter")
    cast(FastAPI, client.app).dependency_overrides[get_person_lookup] = lambda: lookup
    return client


def device(db: Session, kind: str, name: str, serial: str) -> InventoryHardware:
    kind_id = db.scalars(select(InventoryKind.id).where(InventoryKind.name == kind)).one()
    row = InventoryHardware(kind_id=kind_id, name=name, serial=serial)
    db.add(row)
    db.commit()
    return row


def at(day: date) -> datetime:
    return datetime.combine(day, time(10, 0), tzinfo=UTC)


def messages(db: Session, loan_id: int) -> list[tuple[str, str, str]]:
    return [
        (row.kind, row.channel, row.status)
        for row in db.scalars(
            select(InventoryLoanMessage)
            .where(InventoryLoanMessage.loan_id == loan_id)
            .order_by(InventoryLoanMessage.id)
        ).all()
    ]


@pytest.mark.db
def test_loan_lifecycle(db: Session) -> None:
    notebook = device(db, "Notebook", "Leih-Notebook 1", "LN-1")
    headset = device(db, "Headset", "Headset 7", "HS-7")
    client = editor()
    reader = client_for(["Bestand.Reader"], "verleih-leser")
    today = local_today()
    due = today + timedelta(days=10)
    body = {"person": {"oid": OID}, "due_on": due.isoformat(), "hardware_ids": [notebook.id]}

    assert reader.post(f"{BASE}/loans", json=body, headers=HEADERS).status_code == 403
    assert reader.get(f"{BASE}/loans/available").status_code == 403
    available = client.get(f"{BASE}/loans/available").json()
    assert {item["id"] for item in available} >= {notebook.id, headset.id}

    # Prüfungen
    past = {**body, "due_on": (today - timedelta(days=1)).isoformat()}
    assert client.post(f"{BASE}/loans", json=past, headers=HEADERS).status_code == 422
    unknown = {**body, "person": {"oid": "22222222-2222-3333-4444-555555555555"}}
    assert client.post(f"{BASE}/loans", json=unknown, headers=HEADERS).status_code == 422
    disabled = {**body, "person": {"oid": DISABLED}}
    assert client.post(f"{BASE}/loans", json=disabled, headers=HEADERS).status_code == 409
    down = {**body, "person": {"oid": "00000000-2222-3333-4444-555555555555"}}
    assert client.post(f"{BASE}/loans", json=down, headers=HEADERS).status_code == 503

    created = client.post(
        f"{BASE}/loans", json={**body, "hardware_ids": [notebook.id, headset.id]}, headers=HEADERS
    )
    assert created.status_code == 200, created.text
    loan = created.json()
    assert re.fullmatch(r"L-\d{3,}", loan["number"])
    assert loan["person_name"] == "Pia Beispiel" and loan["has_address"] is True
    assert loan["state"] == "offen" and (loan["items"], loan["items_open"]) == (2, 2)
    assert messages(db, loan["id"]) == [
        ("ausgabe", "mail", "offen"),
        ("ausgabe", "teams", "offen"),
    ]
    stored = db.get(InventoryLoan, loan["id"])
    assert stored is not None and stored.person_mail == "pia.beispiel@example.com"

    # Verliehen: nicht nochmal, nicht zuordnen, nicht ausmustern
    assert client.post(f"{BASE}/loans", json=body, headers=HEADERS).status_code == 409
    assert notebook.id not in {item["id"] for item in client.get(f"{BASE}/loans/available").json()}
    view = reader.get(f"{BASE}/hardware/{notebook.id}").json()
    assert view["loan"]["number"] == loan["number"]
    assert any("Verliehen an Pia Beispiel" in event["text"] for event in view["events"])
    workplace = client.post(
        f"{BASE}/workplaces", json={"name": "Platz", "room_id": room_for_tests(db)}, headers=HEADERS
    ).json()
    update = {
        "kind_id": notebook.kind_id,
        "name": notebook.name,
        "serial": notebook.serial,
        "workplace_id": workplace["id"],
    }
    assert (
        client.put(f"{BASE}/hardware/{notebook.id}", json=update, headers=HEADERS).status_code
        == 409
    )
    retire = {"retired_on": today.isoformat(), "reason_id": 1, "whereabouts": "entsorgt"}
    assert (
        client.post(
            f"{BASE}/hardware/{notebook.id}/retire", json=retire, headers=HEADERS
        ).status_code
        == 409
    )

    listed = reader.get(f"{BASE}/loans").json()
    assert listed["open"] >= 1 and loan["id"] in {item["id"] for item in listed["loans"]}

    # Erinnerung zwei Tage vorher, einmal
    assert check_loans(db, at(due - timedelta(days=3))) == (0, 0)
    assert check_loans(db, at(due - timedelta(days=2))) == (1, 0)
    assert check_loans(db, at(due - timedelta(days=1))) == (0, 0)

    # Überfällig: Nachricht und Vorgang, dann wöchentlich, Vorgang nur einmal
    assert check_loans(db, at(due + timedelta(days=1))) == (0, 1)
    assert check_loans(db, at(due + timedelta(days=3))) == (0, 0)
    assert check_loans(db, at(due + timedelta(days=8))) == (0, 1)
    overdue = db.scalars(select(InventoryCase).where(InventoryCase.kind == "ueberfaellig")).all()
    assert len(overdue) == 1 and overdue[0].facts["loan_number"] == loan["number"]

    # Einzeln zurück: Vorgang „Rückgabe prüfen“, Verleih bleibt offen
    partly = client.post(
        f"{BASE}/loans/{loan['id']}/return", json={"hardware_ids": [headset.id]}, headers=HEADERS
    ).json()
    assert partly["state"] != "zurueck" and partly["items_open"] == 1
    assert (
        client.post(
            f"{BASE}/loans/{loan['id']}/return",
            json={"hardware_ids": [headset.id]},
            headers=HEADERS,
        ).status_code
        == 409
    )
    # Rest zurück: Verleih fertig, „überfällig“ schließt sich, Dank an die Person
    done = client.post(
        f"{BASE}/loans/{loan['id']}/return", json={"hardware_ids": [notebook.id]}, headers=HEADERS
    ).json()
    assert done["state"] == "zurueck" and done["returned_on"] == today.isoformat()
    db.expire_all()
    assert overdue[0].status == "fertig" and overdue[0].decision == "zurueck"
    returns = db.scalars(
        select(InventoryCase).where(InventoryCase.kind == "rueckgabe").order_by(InventoryCase.id)
    ).all()
    assert [case.facts["devices"] for case in returns] == [["Headset 7"], ["Leih-Notebook 1"]]
    assert ("rueckgabe", "mail", "offen") in messages(db, loan["id"])
    assert reader.get(f"{BASE}/hardware/{notebook.id}").json()["loan"] is None
    assert {case["kind"] for case in done["cases"]} == {"rueckgabe", "ueberfaellig"}

    # Rückgabe prüfen: zurück ins Lager
    decided = client.post(
        f"{BASE}/cases/{returns[1].id}/decide", json={"decision": "lager"}, headers=HEADERS
    ).json()
    assert decided["status"] == "fertig"
    assert (
        client.post(
            f"{BASE}/cases/{overdue[0].id}/decide",
            json={"decision": "geklaert"},
            headers=HEADERS,
        ).status_code
        == 409
    )


@pytest.mark.db
def test_overdue_case_extends_loan(db: Session) -> None:
    notebook = device(db, "Notebook", "Leih-Notebook 2", "LN-2")
    client = editor()
    today = local_today()
    loan = client.post(
        f"{BASE}/loans",
        json={
            "person": {"oid": OID},
            "due_on": today.isoformat(),
            "hardware_ids": [notebook.id],
        },
        headers=HEADERS,
    ).json()
    # Kein Erinnern, wenn das Datum schon so nah ist
    assert check_loans(db, at(today)) == (0, 0)
    check_loans(db, at(today + timedelta(days=1)))
    case = db.scalars(select(InventoryCase).where(InventoryCase.kind == "ueberfaellig")).one()
    url = f"{BASE}/cases/{case.id}/decide"
    assert client.post(url, json={"decision": "verlaengert"}, headers=HEADERS).status_code == 422
    assert client.post(url, json={"decision": "zurueck"}, headers=HEADERS).status_code == 422
    new_due = today + timedelta(days=14)
    decided = client.post(
        url, json={"decision": "verlaengert", "due_on": new_due.isoformat()}, headers=HEADERS
    )
    assert decided.status_code == 200, decided.text
    stored = db.get(InventoryLoan, loan["id"])
    assert stored is not None
    db.refresh(stored)
    assert stored.due_on == new_due and stored.overdue_notified_on is None

    # Neues Datum, wieder überfällig: neuer Vorgang; nach „geklärt“ keiner mehr zum selben Datum
    soon = today + timedelta(days=1)
    later = client.put(
        f"{BASE}/loans/{loan['id']}/due", json={"due_on": soon.isoformat()}, headers=HEADERS
    )
    assert later.status_code == 200 and later.json()["due_on"] == soon.isoformat()
    db.expire_all()
    check_loans(db, at(soon + timedelta(days=1)))
    second = db.scalars(
        select(InventoryCase).where(
            InventoryCase.kind == "ueberfaellig", InventoryCase.status == "neu"
        )
    ).one()
    assert (
        client.post(
            f"{BASE}/cases/{second.id}/decide", json={"decision": "geklaert"}, headers=HEADERS
        ).status_code
        == 200
    )
    check_loans(db, at(soon + timedelta(days=2)))
    assert (
        len(db.scalars(select(InventoryCase).where(InventoryCase.kind == "ueberfaellig")).all())
        == 2
    )


@pytest.mark.db
def test_send_pending_only_number_and_date(db: Session, tmp_path: Path) -> None:
    notebook = device(db, "Notebook", "Geheimes Notebook", "LN-3")
    client = editor()
    due = local_today() + timedelta(days=5)
    loan = client.post(
        f"{BASE}/loans",
        json={"person": {"oid": OID}, "due_on": due.isoformat(), "hardware_ids": [notebook.id]},
        headers=HEADERS,
    ).json()
    settings = settings_with_key(tmp_path)

    # Nichts eingerichtet: Nachrichten bleiben nicht hängen
    assert send_pending(db, settings) == 0
    assert {status for _, _, status in messages(db, loan["id"])} == {"aus"}

    # Mit SMTP und Teams
    db.execute(
        update(InventoryLoanMessage)
        .where(InventoryLoanMessage.loan_id == loan["id"])
        .values(status="offen", error="")
    )
    set_setting(
        db, SMTP_KEY, {"host": "smtp.example.com", "sender_address": "it@example.com"}, None
    )
    set_setting(
        db,
        TEAMS_KEY,
        {
            "enabled": True,
            "url_encrypted": encrypt_secret(
                settings, "https://prod-01.westeurope.logic.azure.com/workflows/abc"
            ),
        },
        None,
    )
    db.commit()
    mails: list[EmailMessage] = []
    cards: list[dict[str, Any]] = []

    def mail_sender(config: SmtpConfig, message: EmailMessage) -> None:
        mails.append(message)

    def teams_sender(url: str, payload: dict[str, Any]) -> None:
        cards.append(payload)

    assert send_pending(db, settings, mail_sender=mail_sender, teams_sender=teams_sender) == 2
    assert mails[0]["To"] == "pia.beispiel@example.com"
    assert loan["number"] in mails[0]["Subject"]
    text = "".join(
        str(part.get_content())
        for part in mails[0].walk()
        if part.get_content_type() in ("text/plain", "text/html")
    )
    assert f"{due:%d.%m.%Y}" in text and "Geheimes Notebook" not in text and "LN-3" not in text
    assert cards[0]["recipient"] == "pia.beispiel@example.com"
    assert "Geheimes Notebook" not in str(cards[0])
    assert {status for _, _, status in messages(db, loan["id"])} == {"gesendet"}


@pytest.mark.db
def test_lists_search_and_pages(db: Session) -> None:
    client = editor()
    due = (local_today() + timedelta(days=7)).isoformat()
    numbers = []
    for index in range(3):
        row = device(db, "Notebook", f"Such-Notebook {index}", f"SN-SUCH-{index}")
        numbers.append(
            client.post(
                f"{BASE}/loans",
                json={"person": {"oid": OID}, "due_on": due, "hardware_ids": [row.id]},
                headers=HEADERS,
            ).json()["number"]
        )
    first = client.get(f"{BASE}/loans?state=alle&limit=2").json()
    assert first["total"] == 3 and len(first["loans"]) == 2
    rest = client.get(f"{BASE}/loans?state=alle&limit=2&offset=2").json()
    assert len(rest["loans"]) == 1
    assert {item["id"] for item in first["loans"] + rest["loans"]} == {
        item["id"] for item in client.get(f"{BASE}/loans?state=alle").json()["loans"]
    }
    # Suche nach Gerät, Nummer und Person; Platzhalter zählen als Text
    found = client.get(f"{BASE}/loans", params={"state": "alle", "q": "sn-such-1"}).json()
    assert [item["number"] for item in found["loans"]] == [numbers[1]] and found["total"] == 1
    assert client.get(f"{BASE}/loans", params={"q": numbers[2]}).json()["total"] == 1
    assert client.get(f"{BASE}/loans", params={"q": "pia bei"}).json()["total"] == 3
    assert client.get(f"{BASE}/loans", params={"q": "%"}).json()["total"] == 0
    assert client.get(f"{BASE}/loans?limit=0").status_code == 422

    # Vorgänge: Rückgaben erzeugen, dann suchen und blättern
    for number in numbers:
        loan = next(item for item in first["loans"] + rest["loans"] if item["number"] == number)
        detail = client.get(f"{BASE}/loans/{loan['id']}").json()
        client.post(
            f"{BASE}/loans/{loan['id']}/return",
            json={"hardware_ids": [detail["entries"][0]["hardware_id"]]},
            headers=HEADERS,
        )
    cases = client.get(f"{BASE}/cases?state=alle&limit=2").json()
    assert cases["total"] == 3 and len(cases["cases"]) == 2
    hit = client.get(f"{BASE}/cases", params={"state": "alle", "q": "Such-Notebook 2"}).json()
    assert hit["total"] == 1 and numbers[2] in hit["cases"][0]["title"]
    assert client.get(f"{BASE}/cases", params={"q": "x" * 101}).status_code == 422
    # Nach Art eingrenzen: nur Rückgaben, keine Monitore
    by_kind = client.get(f"{BASE}/cases", params={"state": "alle", "kind": "rueckgabe"}).json()
    assert by_kind["total"] == 3
    monitors = client.get(f"{BASE}/cases", params={"state": "alle", "kind": "monitor"}).json()
    assert monitors["total"] == 0
    assert client.get(f"{BASE}/cases", params={"kind": "gibtsnicht"}).status_code == 422
