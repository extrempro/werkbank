"""Aufträge des Moduls Evergreen für den Worker."""

from typing import Any

import httpx
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.modules.evergreen.implementation import check_open_items
from werkbank.modules.evergreen.message_center import fetch_messages
from werkbank.modules.m365_config.utcm import UtcmClient, graph_token_provider

FETCH_MESSAGES = "evergreen.nachrichtencenter"
CHECK_IMPLEMENTATION = "evergreen.umsetzung_pruefen"
HTTP_TIMEOUT_SECONDS = 60.0


def fetch_messages_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf des Nachrichtencenters."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        fetch_messages(db, UtcmClient(http, graph_token_provider(settings)))


def check_implementation_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Soll/Ist-Abgleich für Vorgänge im Schritt „Umsetzung“."""
    check_open_items(db)
