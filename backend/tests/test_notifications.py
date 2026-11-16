"""Benachrichtigungen (Glocke): Abgleich, Empfänger, Ausschalten und API."""

import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.config import Settings
from werkbank.core.models import (
    Notification,
    NotificationKind,
    NotificationMark,
    NotificationMute,
    User,
)
from werkbank.core.notifications import KINDS, NOTIFY, Event, dispatch, purge
from werkbank.core.sessions import now_utc
from werkbank.worker.tasks import REGISTRY

BASE = "/api/notifications"
HEADERS = {"Origin": ORIGIN}
NOW = now_utc().replace(microsecond=0)


@pytest.fixture
def db(db_session: Session) -> Session:
    for table in (Notification, NotificationMark, NotificationKind, NotificationMute):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def user_id(db: Session, oid: str) -> uuid.UUID:
    return db.scalars(select(User.id).where(User.entra_oid == f"test:{oid}")).one()


def invoice(key: str, title: str = "Rechnung prüfen") -> Event:
    return Event(kind="budget.rechnung_pruefen", key=key, title=title, link="/budget/rechnungen")


def mine(db: Session, oid: str) -> list[Notification]:
    return list(db.scalars(select(Notification).where(Notification.user_id == user_id(db, oid))))


def test_every_kind_has_roles_and_label() -> None:
    for kind, info in KINDS.items():
        assert info.roles, kind
        assert info.label and info.module, kind


def test_job_is_registered() -> None:
    assert NOTIFY in REGISTRY


@pytest.mark.db
def test_first_run_marks_existing_without_flood(db: Session) -> None:
    client_for(["Budget.Manager"], "glocke-manager")
    db.expire_all()
    assert dispatch(db, [invoice("1"), invoice("2")], now=NOW) == 0
    db.commit()
    assert mine(db, "glocke-manager") == []
    # Beim nächsten Lauf: nur die neue Rechnung, die alten nicht noch einmal
    dispatch(db, [invoice("1"), invoice("2"), invoice("3", "Neu")], now=NOW)
    dispatch(db, [invoice("3", "Neu")], now=NOW)
    db.commit()
    assert [entry.title for entry in mine(db, "glocke-manager")] == ["Neu"]


@pytest.mark.db
def test_recipients_by_role_user_and_mute(db: Session) -> None:
    client_for(["Budget.Manager"], "glocke-a")
    client_for(["Budget.Manager"], "glocke-b")
    client_for(["Budget.Reader"], "glocke-leser")
    db.expire_all()
    dispatch(db, [], now=NOW)
    a, b = user_id(db, "glocke-a"), user_id(db, "glocke-b")
    db.add(NotificationMute(user_id=b, kind="budget.rechnung_pruefen"))
    db.flush()
    dispatch(
        db,
        [
            invoice("10"),
            Event(
                kind="budget.rechnung_gebucht",
                key="10",
                title="Gebucht",
                link="/budget/rechnungen",
                user_ids=frozenset({b}),
            ),
            Event(
                kind="budget.kuendigung",
                key="5",
                title="Kündigen",
                link="/budget/vertraege/5",
                exclude=frozenset({a}),
            ),
        ],
        now=NOW,
    )
    db.commit()
    assert [entry.kind for entry in mine(db, "glocke-a")] == ["budget.rechnung_pruefen"]
    assert sorted(entry.kind for entry in mine(db, "glocke-b")) == [
        "budget.kuendigung",
        "budget.rechnung_gebucht",
    ]
    assert mine(db, "glocke-leser") == []


@pytest.mark.db
def test_unknown_kind_is_rejected(db: Session) -> None:
    with pytest.raises(ValueError):
        dispatch(db, [Event(kind="gibt.es_nicht", key="1", title="x", link="/")])


@pytest.mark.db
def test_purge_drops_old_entries_and_vanished_marks(db: Session) -> None:
    client_for(["Budget.Manager"], "glocke-alt")
    db.expire_all()
    dispatch(db, [], now=NOW - timedelta(days=200))
    dispatch(db, [invoice("20")], now=NOW - timedelta(days=100))
    dispatch(db, [invoice("21")], now=NOW)
    purge(db, now=NOW)
    db.commit()
    assert [entry.title for entry in mine(db, "glocke-alt")] == ["Rechnung prüfen"]
    assert db.get(NotificationMark, "budget.rechnung_pruefen:20") is None
    assert db.get(NotificationMark, "budget.rechnung_pruefen:21") is not None


@pytest.mark.db
def test_api_list_read_and_settings(db: Session) -> None:
    client: TestClient = client_for(["Budget.Manager"], "glocke-api")
    other = client_for(["Budget.Manager"], "glocke-andere")
    db.expire_all()
    dispatch(db, [], now=NOW)
    dispatch(db, [invoice("30", "Erste"), invoice("31", "Zweite")], now=NOW)
    db.commit()

    data = client.get(BASE).json()
    assert data["unread"] == 2
    assert {entry["title"] for entry in data["entries"]} == {"Erste", "Zweite"}
    assert data["entries"][0]["module"] == "IT-Budget"
    first = data["entries"][0]["id"]

    # Fremde Einträge lassen sich nicht als gelesen markieren
    assert other.post(f"{BASE}/{first}/read", headers=HEADERS).status_code == 404
    response = client.post(f"{BASE}/{first}/read", headers=HEADERS)
    assert response.json() == {"unread": 1}
    assert client.get(BASE).json()["unread"] == 1
    assert client.post(f"{BASE}/read-all", headers=HEADERS).json() == {"unread": 0}
    assert client.get(BASE).json()["unread"] == 0

    kinds = client.get(f"{BASE}/settings").json()["kinds"]
    assert {entry["kind"] for entry in kinds} == {
        kind for kind, info in KINDS.items() if "Budget.Manager" in info.roles
    }
    assert all(entry["enabled"] for entry in kinds)
    saved = client.put(
        f"{BASE}/settings",
        json={"disabled": ["budget.prognose", "config.abweichung"]},
        headers=HEADERS,
    ).json()["kinds"]
    # Arten ohne passende Rolle werden nicht gespeichert
    assert [entry["kind"] for entry in saved if not entry["enabled"]] == ["budget.prognose"]
    assert (
        client.put(
            f"{BASE}/settings",
            json={"disabled": ["gibt.es_nicht"]},
            headers=HEADERS,
        ).status_code
        == 422
    )


@pytest.mark.db
def test_api_hides_kinds_without_current_role(db: Session) -> None:
    client_for(["Budget.Manager"], "glocke-wechsel")
    db.expire_all()
    dispatch(db, [], now=NOW)
    dispatch(db, [invoice("40")], now=NOW)
    db.commit()
    # Später ohne die Rolle angemeldet: der Eintrag ist nicht mehr zu sehen
    later = client_for(["Budget.Reader"], "glocke-wechsel")
    assert later.get(BASE).json() == {"unread": 0, "entries": []}


@pytest.mark.db
def test_job_runs_over_all_sources(db: Session) -> None:
    """Alle Quellen laufen gegen den Bestand der Testdatenbank, zweimal ohne neue Einträge."""
    settings = Settings(public_url=ORIGIN, environment="test")
    REGISTRY[NOTIFY].handler(db, settings, {})
    db.commit()
    assert db.scalar(select(func.count()).select_from(Notification)) == 0
    assert set(db.scalars(select(NotificationKind.kind))) == set(KINDS)
    REGISTRY[NOTIFY].handler(db, settings, {})
    db.commit()
    assert db.scalar(select(func.count()).select_from(Notification)) == 0
