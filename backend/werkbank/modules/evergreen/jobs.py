"""Aufträge des Bereichs Evergreen für den Worker."""

from typing import Any

import httpx
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.modules.evergreen.message_center import fetch_messages
from werkbank.modules.m365_config.utcm import UtcmClient, graph_token_provider

FETCH_MESSAGES = "evergreen.nachrichtencenter"
HTTP_TIMEOUT_SECONDS = 60.0


def fetch_messages_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf des Nachrichtencenters."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        fetch_messages(db, UtcmClient(http, graph_token_provider(settings)))
