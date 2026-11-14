"""Aufträge des Moduls M365-Konfiguration für den Worker."""

from typing import Any

import httpx
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.modules.m365_config.collector import collect
from werkbank.modules.m365_config.utcm import UtcmClient, graph_token_provider

COLLECT = "m365_config.abruf"
HTTP_TIMEOUT_SECONDS = 60.0


def collect_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf der Einstellungen aus dem Tenant."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        collect(db, settings, UtcmClient(http, graph_token_provider(settings)))
