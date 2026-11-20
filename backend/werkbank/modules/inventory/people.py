"""Personen aus Entra für die Besetzung einer Stelle (nur lesend, über Microsoft Graph).

Gesucht wird erst, wenn jemand mit Bearbeiterrolle tippt; gespeichert wird nur die gewählte
Person (Objekt-ID, Name, Anmeldename) an der Stelle. Braucht die Anwendungsberechtigung
`User.Read.All` der Collector-App (siehe docs/entra-setup.md).
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from werkbank.config import Settings
from werkbank.core.deps import SettingsDep
from werkbank.modules.m365_config.utcm import (
    GRAPH_URL,
    UtcmClient,
    UtcmError,
    graph_token_provider,
)

HTTP_TIMEOUT_SECONDS = 15
MAX_HITS = 15
QUERY_MAX = 60
# Zeichen, die in $search eine Bedeutung haben, werden entfernt
_SEARCH_SPECIAL = re.compile(r'["\\]')
_OID = re.compile(r"^[0-9a-fA-F-]{36}$")


class PeopleError(RuntimeError):
    """Personensuche nicht möglich (nicht eingerichtet oder Graph antwortet nicht)."""


@dataclass(frozen=True)
class Person:
    oid: str
    name: str
    upn: str
    department: str
    job_title: str
    enabled: bool


def search_term(query: str) -> str:
    """Suchtext für Graph `$search`: ohne Anführungszeichen und Backslash, gekürzt."""
    return " ".join(_SEARCH_SPECIAL.sub(" ", query).split())[:QUERY_MAX]


def _text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def parse_people(items: list[dict[str, Any]]) -> list[Person]:
    people: list[Person] = []
    for item in items:
        oid = item.get("id")
        if not isinstance(oid, str) or not _OID.match(oid):
            continue
        people.append(
            Person(
                oid=oid.lower(),
                name=_text(item.get("displayName"), 200),
                upn=_text(item.get("userPrincipalName"), 200),
                department=_text(item.get("department"), 120),
                job_title=_text(item.get("jobTitle"), 120),
                enabled=item.get("accountEnabled") is not False,
            )
        )
    return people


PeopleFinder = Callable[[str], list[Person]]


class GraphPeople(UtcmClient):
    """Suche nach Konten in Entra; nur Mitglieder, keine Gäste."""

    def search(self, query: str) -> list[Person]:
        term = search_term(query)
        if len(term) < 2:
            return []
        data = self._json(
            "GET",
            f"{GRAPH_URL}/users",
            params={
                "$search": f'"displayName:{term}" OR "userPrincipalName:{term}"',
                "$filter": "userType eq 'Member'",
                "$select": "id,displayName,userPrincipalName,department,jobTitle,accountEnabled",
                "$orderby": "displayName",
                "$top": str(MAX_HITS),
                "$count": "true",
            },
            headers={"ConsistencyLevel": "eventual"},
        )
        values = data.get("value")
        return parse_people([item for item in values or [] if isinstance(item, dict)])


# Token-Abruf je Einstellungen merken, damit MSAL das Token zwischenspeichern kann
_TOKENS: dict[int, Callable[[], str]] = {}


def graph_people_finder(settings: Settings) -> PeopleFinder:
    if not settings.collector_configured:
        raise PeopleError("Die Verbindung zu Entra ist nicht eingerichtet.")
    token = _TOKENS.get(id(settings))
    if token is None:
        try:
            token = _TOKENS.setdefault(id(settings), graph_token_provider(settings))
        except (OSError, ValueError) as exc:
            raise PeopleError("Die Anmeldedaten für Entra sind nicht lesbar.") from exc

    def find(query: str) -> list[Person]:
        try:
            with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
                return GraphPeople(http, token).search(query)
        except UtcmError as exc:
            raise PeopleError(str(exc)) from exc

    return find


def get_people_finder(settings: SettingsDep) -> PeopleFinder:
    """Abhängigkeit für die API; in Tests ersetzbar."""

    def find(query: str) -> list[Person]:
        return graph_people_finder(settings)(query)

    return find
