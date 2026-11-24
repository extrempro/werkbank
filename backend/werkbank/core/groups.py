"""Gruppenmitgliedschaft bei der Anmeldung (Microsoft Graph, im Namen der Person).

Geprüft wird mit dem Zugriffstoken der Anmeldung über `POST /me/checkMemberGroups`. Dafür reicht
die delegierte Berechtigung User.Read; die Prüfung ist transitiv (auch verschachtelte Gruppen).
Geprüft werden nur die beiden Gruppen aus der Konfiguration, nichts wird gespeichert außer dem
Ergebnis (Admin ja/nein).
"""

from collections.abc import Callable
from typing import Annotated

import httpx
from fastapi import Depends

GRAPH_CHECK_URL = "https://graph.microsoft.com/v1.0/me/checkMemberGroups"
TIMEOUT_SECONDS = 10.0


class GroupCheckError(RuntimeError):
    """Graph hat die Gruppen nicht beantwortet."""


# (Zugriffstoken, Objekt-IDs der Gruppen) -> Objekt-IDs, in denen die Person Mitglied ist
GroupChecker = Callable[[str, list[str]], set[str]]


def graph_group_checker(
    access_token: str, group_ids: list[str], transport: httpx.BaseTransport | None = None
) -> set[str]:
    """Fragt Graph, in welchen der Gruppen die angemeldete Person Mitglied ist."""
    try:
        with httpx.Client(
            timeout=TIMEOUT_SECONDS, follow_redirects=False, transport=transport
        ) as http:
            response = http.post(
                GRAPH_CHECK_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                json={"groupIds": group_ids},
            )
    except httpx.HTTPError as exc:
        raise GroupCheckError("Graph ist nicht erreichbar.") from exc
    if response.status_code != 200:
        raise GroupCheckError(f"Graph antwortet mit {response.status_code}.")
    try:
        values = response.json().get("value")
    except ValueError as exc:
        raise GroupCheckError("Graph liefert keine lesbare Antwort.") from exc
    if not isinstance(values, list):
        raise GroupCheckError("Graph liefert keine Gruppenliste.")
    wanted = {group.lower() for group in group_ids}
    return {value.lower() for value in values if isinstance(value, str)} & wanted


def get_group_checker() -> GroupChecker:
    """Abhängigkeit für die Anmeldung; in Tests ersetzbar."""
    return graph_group_checker


GroupCheckerDep = Annotated[GroupChecker, Depends(get_group_checker)]
