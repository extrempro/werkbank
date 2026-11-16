"""IT-Tools je Konto: Favoriten, zuletzt genutzte Tools, Verlauf."""

from datetime import timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS
from tests.test_auth import client_for, login_as, make_app
from werkbank.core.sessions import now_utc
from werkbank.modules.tools.account import HISTORY_MAX, summarize
from werkbank.modules.tools.models import ToolHistory, ToolPrefs

BASE = "/api/tools"


def test_summary_is_short() -> None:
    assert summarize({"cidr": "10.0.0.0/24", "leer": " "}) == "10.0.0.0/24"
    assert summarize({"a": "eins\nzwei\ndrei"}) == "eins (+2 Zeilen)"
    assert summarize({"a": "x" * 60}) == "x" * 47 + "…"
    long = summarize({str(i): "y" * 40 for i in range(10)})
    assert len(long) == 160 and long.endswith("…")


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    db_session.execute(delete(ToolHistory))
    db_session.execute(delete(ToolPrefs))
    db_session.commit()
    return db_session


def tools_client(oid: str, roles: list[str] | None = None):  # type: ignore[no-untyped-def]
    client = client_for(make_app())
    login_as(client, roles or ["Tools.User"], oid=oid)
    return client


@pytest.mark.db
def test_only_with_role(db: Session) -> None:
    client = tools_client("tools-ohne", ["Budget.Reader"])
    assert client.get(f"{BASE}/prefs").status_code == 403
    assert client.get(f"{BASE}/history").status_code == 403


@pytest.mark.db
def test_favorites_recent_and_switch(db: Session) -> None:
    client = tools_client("tools-prefs")
    assert client.get(f"{BASE}/prefs").json() == {
        "favorites": [],
        "recent": [],
        "history_enabled": True,
    }
    saved = client.put(
        f"{BASE}/prefs", json={"favorites": ["cidr", "uuid", "cidr"]}, headers=HEADERS
    ).json()
    assert saved["favorites"] == ["cidr", "uuid"]
    assert (
        client.put(f"{BASE}/prefs", json={"favorites": ["../x"]}, headers=HEADERS).status_code
        == 422
    )
    for tool in ["a", "b", "c", "d", "e", "f", "g", "b"]:
        recent = client.post(f"{BASE}/recent", json={"tool": tool}, headers=HEADERS).json()
    assert recent["recent"] == ["b", "g", "f", "e", "d", "c"]
    off = client.put(f"{BASE}/prefs", json={"history_enabled": False}, headers=HEADERS).json()
    assert off["history_enabled"] is False and off["favorites"] == ["cidr", "uuid"]
    stored = client.post(
        f"{BASE}/history", json={"tool": "cidr", "params": {"cidr": "10.0.0.0/24"}}, headers=HEADERS
    ).json()
    assert stored == {"entry": None}
    assert client.get(f"{BASE}/history").json() == []


@pytest.mark.db
def test_history_dedupe_own_entries_and_delete(db: Session) -> None:
    client = tools_client("tools-verlauf")
    other = tools_client("tools-andere")
    first = client.post(
        f"{BASE}/history", json={"tool": "cidr", "params": {"cidr": "10.0.0.0/24"}}, headers=HEADERS
    ).json()["entry"]
    assert first["summary"] == "10.0.0.0/24"
    # Gleiche Einstellungen: kein neuer Eintrag
    again = client.post(
        f"{BASE}/history", json={"tool": "cidr", "params": {"cidr": "10.0.0.0/24"}}, headers=HEADERS
    ).json()["entry"]
    assert again["id"] == first["id"]
    client.post(
        f"{BASE}/history", json={"tool": "cidr", "params": {"cidr": "10.0.1.0/24"}}, headers=HEADERS
    )
    client.post(f"{BASE}/history", json={"tool": "uuid", "params": {"n": "5"}}, headers=HEADERS)
    assert len(client.get(f"{BASE}/history").json()) == 3
    assert [e["params"]["cidr"] for e in client.get(f"{BASE}/history?tool=cidr").json()] == [
        "10.0.1.0/24",
        "10.0.0.0/24",
    ]
    assert other.get(f"{BASE}/history").json() == []
    assert other.delete(f"{BASE}/history/{first['id']}", headers=HEADERS).status_code == 404
    # Leere Werte und ungültige Schlüssel
    assert client.post(
        f"{BASE}/history", json={"tool": "cidr", "params": {"cidr": "  "}}, headers=HEADERS
    ).json() == {"entry": None}
    assert (
        client.post(
            f"{BASE}/history", json={"tool": "cidr", "params": {"a b": "x"}}, headers=HEADERS
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{BASE}/history", json={"tool": "cidr", "params": {"a": "x" * 501}}, headers=HEADERS
        ).status_code
        == 422
    )
    assert client.delete(f"{BASE}/history/{first['id']}", headers=HEADERS).json() == {"deleted": 1}
    assert client.delete(f"{BASE}/history?tool=cidr", headers=HEADERS).json() == {"deleted": 1}
    assert [e["tool"] for e in client.get(f"{BASE}/history").json()] == ["uuid"]
    assert client.delete(f"{BASE}/history", headers=HEADERS).json() == {"deleted": 1}


@pytest.mark.db
def test_history_is_trimmed(db: Session) -> None:
    client = tools_client("tools-viel")
    client.post(f"{BASE}/history", json={"tool": "uuid", "params": {"n": "0"}}, headers=HEADERS)
    owner = db.scalars(select(ToolHistory.user_id)).first()
    old = now_utc() - timedelta(days=100)
    db.add(ToolHistory(user_id=owner, tool="alt", params={"x": "1"}, summary="1", created_at=old))
    for index in range(HISTORY_MAX + 5):
        db.add(
            ToolHistory(
                user_id=owner,
                tool="cidr",
                params={"n": str(index)},
                summary=str(index),
                created_at=now_utc() - timedelta(minutes=index + 1),
            )
        )
    db.commit()
    client.post(f"{BASE}/history", json={"tool": "uuid", "params": {"n": "9"}}, headers=HEADERS)
    db.expire_all()
    rows = list(db.scalars(select(ToolHistory).where(ToolHistory.user_id == owner)))
    assert len(rows) == HISTORY_MAX
    assert not any(row.tool == "alt" for row in rows)
