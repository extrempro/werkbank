"""Berechtigungen in der Werkbank: Stufen, Gruppen bei der Anmeldung, Verwaltung."""

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.test_auth import (
    ORIGIN,
    FakeEntra,
    client_for,
    good_claims,
    login_as,
    make_app,
    make_settings,
)
from werkbank.config import Settings
from werkbank.core.auth import get_entra_client
from werkbank.core.groups import (
    GRAPH_CHECK_URL,
    GroupCheckError,
    get_group_checker,
    graph_group_checker,
)
from werkbank.core.models import AuditLog, User
from werkbank.core.permissions import (
    AREAS,
    levels_from_roles,
    normalize,
    roles_from_levels,
)

ADMIN_GROUP = "aaaaaaaa-0000-0000-0000-000000000001"
ACCESS_GROUP = "aaaaaaaa-0000-0000-0000-000000000002"


# --- ohne Datenbank -------------------------------------------------------------------


def test_levels_round_trip() -> None:
    for area in AREAS:
        for index in range(1, len(area.levels)):
            assert levels_from_roles(roles_from_levels({area.key: index})) == {area.key: index}
    assert roles_from_levels({"unbekannt": 1, "tools": 9}) == []


def test_old_app_roles_become_whole_levels() -> None:
    # Die wichtigste Rolle einer Stufe genügt, die Stufe bringt die übrigen mit
    assert normalize(["Budget.Manager"]) == ["Budget.Editor", "Budget.Manager", "Budget.Reader"]
    assert normalize(["Bestand.Editor"]) == ["Bestand.Editor", "Bestand.Reader"]
    # Tenant gehört zu M365 Lesen
    assert normalize(["Tenant.Reader"]) == ["Config.Reader", "Tenant.Reader"]
    assert levels_from_roles(["Monitoring.Berichte"]) == {"monitoring": 1}
    assert levels_from_roles(["Monitoring.Berichte", "Monitoring.Reader"]) == {"monitoring": 2}
    # Die Verwaltung ist kein Bereichsrecht
    assert normalize(["Werkbank.Admin", "Unbekannt"]) == []


def test_groups_must_be_complete_and_valid() -> None:
    with pytest.raises(RuntimeError, match="zusammen"):
        Settings(entra_admin_group_id=ADMIN_GROUP).validate_for_startup()
    with pytest.raises(RuntimeError, match="keine Objekt-IDs"):
        Settings(
            entra_admin_group_id="admins", entra_access_group_id=ACCESS_GROUP
        ).validate_for_startup()
    with pytest.raises(RuntimeError, match="verschiedene"):
        Settings(
            entra_admin_group_id=ADMIN_GROUP, entra_access_group_id=ADMIN_GROUP.upper()
        ).validate_for_startup()
    settings = Settings(entra_admin_group_id=ADMIN_GROUP, entra_access_group_id=ACCESS_GROUP)
    settings.validate_for_startup()
    assert settings.entra_groups_configured


def test_graph_group_checker() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == GRAPH_CHECK_URL
        assert request.headers["Authorization"] == "Bearer zugriff"
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"value": [ACCESS_GROUP.upper(), "fremd"]})

    result = graph_group_checker(
        "zugriff", [ADMIN_GROUP, ACCESS_GROUP], httpx.MockTransport(handler)
    )
    assert result == {ACCESS_GROUP}
    assert seen == [{"groupIds": [ADMIN_GROUP, ACCESS_GROUP]}]

    for response in (httpx.Response(403), httpx.Response(200, json={"value": "x"})):
        with pytest.raises(GroupCheckError):
            graph_group_checker(
                "zugriff", [ADMIN_GROUP], httpx.MockTransport(lambda _r, r=response: r)
            )


# --- mit Datenbank --------------------------------------------------------------------


class TokenEntra(FakeEntra):
    def acquire_token_by_auth_code_flow(
        self, auth_code_flow: dict[str, Any], auth_response: dict[str, Any], **kwargs: Any
    ) -> dict[str, Any]:
        return {"id_token_claims": self.claims, "access_token": "zugriff"}


def group_login(
    groups: set[str] | Exception, *, roles: list[str] | None = None, oid: str | None = None
) -> tuple[TestClient, int]:
    """Anmeldung über Entra mit Gruppen; `groups` ist die Antwort der Gruppenprüfung."""
    claims = good_claims(roles=roles or [], **({"oid": oid} if oid else {}))
    app = make_app(
        make_settings(entra_admin_group_id=ADMIN_GROUP, entra_access_group_id=ACCESS_GROUP)
    )

    def checker(token: str, group_ids: list[str]) -> set[str]:
        assert token == "zugriff"  # noqa: S105 - Testwert
        assert group_ids == [ADMIN_GROUP, ACCESS_GROUP]
        if isinstance(groups, Exception):
            raise groups
        return groups

    app.dependency_overrides[get_entra_client] = lambda: TokenEntra(claims)
    app.dependency_overrides[get_group_checker] = lambda: checker
    client = client_for(app)
    assert client.get("/auth/login").status_code == 303
    response = client.get("/auth/callback", params={"code": "x", "state": "abc"})
    return client, response.status_code


def person(db: Session, oid: str) -> User:
    db.expire_all()
    return db.execute(select(User).where(User.entra_oid == oid)).scalar_one()


@pytest.mark.db
def test_group_login_takes_over_app_roles_once(migrated_db: None, db_session: Session) -> None:
    oid = "22222222-0000-0000-0000-000000000001"
    client, code = group_login({ACCESS_GROUP}, roles=["Budget.Manager", "Werkbank.Admin"], oid=oid)
    assert code == 303
    me = client.get("/api/me").json()
    # Übernommen als ganze Stufe; die Verwaltung kommt nicht aus der App-Rolle
    assert me["roles"] == ["Budget.Editor", "Budget.Manager", "Budget.Reader"]
    user = person(db_session, oid)
    assert user.permissions_origin == "app_rollen"
    assert user.is_admin is False

    # Später zählen die App-Rollen nicht mehr
    client, code = group_login({ACCESS_GROUP, ADMIN_GROUP}, roles=["Tools.User"], oid=oid)
    assert code == 303
    assert client.get("/api/me").json()["roles"] == [
        "Budget.Editor",
        "Budget.Manager",
        "Budget.Reader",
        "Werkbank.Admin",
    ]


@pytest.mark.db
def test_group_login_rules(migrated_db: None, db_session: Session) -> None:
    # Nur Admin-Gruppe genügt zum Anmelden, bringt aber keine Bereichsrechte
    client, code = group_login({ADMIN_GROUP}, oid="22222222-0000-0000-0000-000000000002")
    assert code == 303
    assert client.get("/api/me").json()["roles"] == ["Werkbank.Admin"]
    # Zugangs-Gruppe ohne Rechte: Anmeldung klappt, nur die Startseite
    client, code = group_login({ACCESS_GROUP}, oid="22222222-0000-0000-0000-000000000003")
    assert code == 303
    assert client.get("/api/me").json()["roles"] == []
    # Keine der Gruppen, oder Graph antwortet nicht: abgelehnt
    _, code = group_login(set(), roles=["Tools.User"], oid="22222222-0000-0000-0000-000000000004")
    assert code == 403
    _, code = group_login(GroupCheckError("x"), oid="22222222-0000-0000-0000-000000000005")
    assert code == 403
    reasons = db_session.scalars(
        select(AuditLog.details).where(AuditLog.action == "anmeldung.abgelehnt")
    ).all()
    assert {"grund": "keine_gruppe"} in reasons
    assert {"grund": "gruppen_nicht_pruefbar"} in reasons


def admin_client() -> TestClient:
    client = client_for(make_app(make_settings(step_up_minutes=15)))
    login_as(client, ["Werkbank.Admin"], oid="rechte-admin")
    return client


@pytest.mark.db
def test_admin_sets_levels_and_they_apply_at_once(migrated_db: None, db_session: Session) -> None:
    worker = client_for(make_app())
    login_as(worker, ["Tools.User"], oid="rechte-person")
    assert worker.get("/api/me").json()["roles"] == ["Tools.User"]

    admin = admin_client()
    overview = admin.get("/api/admin/permissions").json()
    assert [area["key"] for area in overview["areas"]][:2] == ["tickets", "doku"]
    target = next(p for p in overview["people"] if p["levels"] == {"tools": 1})
    response = admin.put(
        f"/api/admin/permissions/{target['id']}",
        json={"levels": {"budget": 2, "tools": 0}},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200, response.text
    assert response.json()["levels"] == {"budget": 2}
    # Die laufende Sitzung hat die neuen Rechte ohne neue Anmeldung
    assert worker.get("/api/me").json()["roles"] == ["Budget.Editor", "Budget.Reader"]

    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "berechtigungen.geaendert")
    ).all()
    assert audit[-1].details is not None
    assert audit[-1].details["nachher"] == {"IT-Budget": "Bearbeiten"}

    bad = admin.put(
        f"/api/admin/permissions/{target['id']}",
        json={"levels": {"budget": 7}},
        headers={"Origin": ORIGIN},
    )
    assert bad.status_code == 422


@pytest.mark.db
def test_permissions_need_admin(migrated_db: None) -> None:
    client = client_for(make_app())
    login_as(client, ["Budget.Manager"], oid="rechte-kein-admin")
    assert client.get("/api/admin/permissions").status_code == 403
    assert client.get("/api/admin/permissions/candidates", params={"q": "ab"}).status_code == 403


@pytest.mark.db
def test_set_by_admin_is_not_overwritten_by_takeover(
    migrated_db: None, db_session: Session
) -> None:
    oid = "22222222-0000-0000-0000-000000000006"
    db_session.add(User(entra_oid=oid, display_name="Ina Beispiel"))
    db_session.commit()
    user = person(db_session, oid)
    admin = admin_client()
    response = admin.put(
        f"/api/admin/permissions/{user.id}",
        json={"levels": {"doku": 1}},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200
    client, code = group_login({ACCESS_GROUP}, roles=["Budget.Manager"], oid=oid)
    assert code == 303
    assert client.get("/api/me").json()["roles"] == ["Doku.Nutzer"]


@pytest.mark.db
def test_candidates_without_entra_connection(migrated_db: None) -> None:
    admin = admin_client()
    response = admin.get("/api/admin/permissions/candidates", params={"q": "Ina"})
    assert response.status_code == 409
    assert admin.get("/api/admin/permissions/candidates", params={"q": "I"}).json() == []


@pytest.mark.db
def test_add_person_from_entra(migrated_db: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from werkbank.modules.inventory import people

    oid = "22222222-0000-0000-0000-000000000007"
    found = people.Person(
        oid=oid,
        name="Tom Beispielmann",
        upn="tom@example.com",
        department="Technik",
        job_title="",
        enabled=True,
        mail="tom@example.com",
    )
    monkeypatch.setattr(people, "graph_people_finder", lambda _s: lambda _q: [found])
    monkeypatch.setattr(
        people, "graph_person_lookup", lambda _s: lambda o: found if o == oid else None
    )
    admin = admin_client()
    hits = admin.get("/api/admin/permissions/candidates", params={"q": "Tom"}).json()
    assert [hit["display_name"] for hit in hits] == ["Tom Beispielmann"]
    added = admin.post(
        "/api/admin/permissions/people", json={"oid": oid}, headers={"Origin": ORIGIN}
    )
    assert added.status_code == 201, added.text
    assert added.json()["levels"] == {}
    assert added.json()["permissions_origin"] == "verwaltung"
    # Bekannte Personen stehen nicht mehr in der Suche, doppelt aufnehmen geht nicht
    assert admin.get("/api/admin/permissions/candidates", params={"q": "Tom"}).json() == []
    again = admin.post(
        "/api/admin/permissions/people", json={"oid": oid}, headers={"Origin": ORIGIN}
    )
    assert again.status_code == 409
