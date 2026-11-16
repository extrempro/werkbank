"""Dienststatus von Microsoft 365: Zustand je Dienst sowie Störungen und Hinweise.

Beobachtet werden Exchange Online, Microsoft Teams, SharePoint Online und Microsoft Entra.
Die Meldungen von Microsoft enthalten keine Personendaten; ihr Text wird ohne HTML gespeichert.
Störungen und Hinweise bleiben drei Jahre für die Auswertung „Ausfälle je Dienst“.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.core.text import html_to_text
from werkbank.modules.m365_config.utcm import UtcmClient, graph_token_provider
from werkbank.modules.tenant.models import TenantServiceHealth, TenantServiceIssue

FETCH_HEALTH = "tenant.dienststatus"
HTTP_TIMEOUT_SECONDS = 60.0

# Beobachtete Dienste: Kennung bei Microsoft und Name in der Werkbank, in dieser Reihenfolge
SERVICES: dict[str, str] = {
    "Exchange": "Exchange Online",
    "microsoftteams": "Microsoft Teams",
    "SharePoint": "SharePoint Online",
    "OrgLiveID": "Microsoft Entra",
}

RETENTION_DAYS = 3 * 365
# Überlappung beim Abruf, damit keine Änderung an der Zeitgrenze verloren geht
OVERLAP = timedelta(hours=1)
POST_MAX_LENGTH = 8000
POSTS_MAX = 100

STATUS_OK = "serviceOperational"


@dataclass(frozen=True)
class HealthResult:
    services: int = 0
    issues: int = 0
    removed: int = 0


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] or None


def _moment(value: Any) -> datetime | None:
    """Zeitangabe von Microsoft Graph; Platzhalter (Jahr 1) gelten als fehlend."""
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.year < 2000:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def read_posts(raw: Any) -> list[dict[str, Any]]:
    """Mitteilungen einer Störung als Text, älteste zuerst."""
    posts: list[dict[str, Any]] = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        description = entry.get("description")
        content = description.get("content") if isinstance(description, dict) else None
        text = html_to_text(content if isinstance(content, str) else None)
        if not text:
            continue
        at = _moment(entry.get("createdDateTime"))
        posts.append(
            {
                "at": at.isoformat() if at else None,
                "type": _text(entry.get("postType"), 32) or "regular",
                "text": text[:POST_MAX_LENGTH],
            }
        )
    posts.sort(key=lambda post: post["at"] or "")
    return posts[-POSTS_MAX:]


def _service_id(raw: dict[str, Any], names: dict[str, str]) -> str | None:
    """Kennung des Dienstes einer Meldung; Meldungen tragen nur den Namen bei Microsoft."""
    name = _text(raw.get("service"), 128)
    return names.get(name.casefold()) if name else None


def fetch_health(db: Session, client: UtcmClient, now: datetime | None = None) -> HealthResult:
    """Liest den Zustand der beobachteten Dienste und ihre geänderten Störungen und Hinweise."""
    moment = now or now_utc()
    # Name bei Microsoft -> Kennung; die Übersicht ergänzt die Namen, die der Tenant liefert.
    names: dict[str, str] = {name.casefold(): key for key, name in SERVICES.items()}
    names["identity service"] = "OrgLiveID"
    services = 0
    for raw in client.health_overviews():
        service_id = _text(raw.get("id"), 64)
        if service_id not in SERVICES:
            continue
        name = _text(raw.get("service"), 128) or SERVICES[service_id]
        names[name.casefold()] = service_id
        row = db.get(TenantServiceHealth, service_id)
        if row is None:
            row = TenantServiceHealth(service_id=service_id)
            db.add(row)
        row.service_name = name
        row.status = _text(raw.get("status"), 48) or "unbekannt"
        row.fetched_at = moment
        services += 1

    last = db.scalar(select(func.max(TenantServiceIssue.fetched_at)))
    issues = 0
    for raw in client.health_issues(last - OVERLAP if last else None):
        issue_id = _text(raw.get("id"), 32)
        service_id = _service_id(raw, names)
        if issue_id is None or service_id is None:
            continue
        row = db.get(TenantServiceIssue, issue_id)
        if row is None:
            row = TenantServiceIssue(issue_id=issue_id)
            db.add(row)
        row.service_id = service_id
        row.service_name = _text(raw.get("service"), 128) or SERVICES[service_id]
        row.title = _text(raw.get("title"), 500) or issue_id
        row.classification = _text(raw.get("classification"), 16) or "advisory"
        row.status = _text(raw.get("status"), 48) or "unbekannt"
        row.feature_group = _text(raw.get("featureGroup"), 128)
        row.feature = _text(raw.get("feature"), 128)
        row.impact = _text(raw.get("impactDescription"), 2000)
        row.resolved = bool(raw.get("isResolved"))
        row.start_at = _moment(raw.get("startDateTime"))
        row.end_at = _moment(raw.get("endDateTime"))
        row.modified_at = _moment(raw.get("lastModifiedDateTime"))
        row.posts = read_posts(raw.get("posts"))
        row.fetched_at = moment
        issues += 1

    limit = moment - timedelta(days=RETENTION_DAYS)
    old = or_(
        TenantServiceIssue.end_at < limit,
        TenantServiceIssue.end_at.is_(None) & (TenantServiceIssue.modified_at < limit),
    )
    removed = int(db.scalar(select(func.count()).select_from(TenantServiceIssue).where(old)) or 0)
    if removed:
        db.execute(delete(TenantServiceIssue).where(old))
    db.commit()
    return HealthResult(services=services, issues=issues, removed=removed)


def fetch_health_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf. Ohne ServiceHealth.Read.All schlägt der Auftrag fehl."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        fetch_health(db, UtcmClient(http, graph_token_provider(settings)))
