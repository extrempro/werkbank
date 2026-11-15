"""Empfehlungen aus Microsoft Secure Score (spec.md 7.5, Empfehlung/Benchmark).

Microsoft liefert Empfehlungen als „Controls“ (z. B. „MFA für Admins“) mit Punkten und einem
Statustext für den Tenant, nicht je Einstellung. Welche Einstellungen ein Control betrifft,
pflegen Reviewer von Hand (`cfg_recommendation_links`).
"""

from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.core.text import html_to_text
from werkbank.modules.m365_config.models import CfgRecommendation
from werkbank.modules.m365_config.utcm import UtcmClient, graph_token_provider

FETCH_SECURE_SCORE = "m365_config.secure_score"
MODULE = "m365_config"
HTTP_TIMEOUT_SECONDS = 60.0
TEXT_MAX_LENGTH = 8000


@dataclass(frozen=True)
class ScoreResult:
    received: int = 0
    new: int = 0
    removed: int = 0


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] or None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _https(value: Any) -> str | None:
    """Nur https-Adressen werden als Link übernommen."""
    if isinstance(value, str) and value.startswith("https://") and len(value) <= 500:
        return value
    return None


def _apply_profile(row: CfgRecommendation, profile: dict[str, Any]) -> None:
    row.title = _text(profile.get("title"), 500) or row.control_id
    row.category = _text(profile.get("controlCategory"), 64)
    row.service = _text(profile.get("service"), 128)
    row.action_type = _text(profile.get("actionType"), 32)
    row.user_impact = _text(profile.get("userImpact"), 32)
    row.implementation_cost = _text(profile.get("implementationCost"), 32)
    rank = profile.get("rank")
    row.rank = rank if isinstance(rank, int) and not isinstance(rank, bool) else None
    row.max_score = _number(profile.get("maxScore")) or 0.0
    remediation = html_to_text(profile.get("remediation")) if profile.get("remediation") else None
    row.remediation = remediation[:TEXT_MAX_LENGTH] if remediation else None
    row.action_url = _https(profile.get("actionUrl"))
    row.deprecated = profile.get("deprecated") is True


def fetch_secure_score(db: Session, client: UtcmClient) -> ScoreResult:
    """Liest Controls und aktuellen Stand und gleicht die gespeicherten Empfehlungen ab."""
    profiles = client.secure_score_profiles()
    latest = client.latest_secure_score() or {}
    scores: dict[str, dict[str, Any]] = {}
    for entry in latest.get("controlScores") or []:
        if isinstance(entry, dict) and isinstance(entry.get("controlName"), str):
            scores[entry["controlName"]] = entry

    existing = {row.control_id: row for row in db.scalars(select(CfgRecommendation)).all()}
    now = now_utc()
    seen: set[str] = set()
    new = 0
    for profile in profiles:
        control_id = profile.get("id")
        if not isinstance(control_id, str) or not control_id or len(control_id) > 128:
            continue
        if control_id in seen:
            continue
        seen.add(control_id)
        row = existing.get(control_id)
        if row is None:
            row = CfgRecommendation(control_id=control_id, title=control_id)
            db.add(row)
            new += 1
        _apply_profile(row, profile)
        score = scores.get(control_id, {})
        row.score = _number(score.get("score"))
        status = score.get("implementationStatus")
        status_text = html_to_text(status) if isinstance(status, str) else None
        row.status_text = status_text[:TEXT_MAX_LENGTH] if status_text else None
        row.active = True
        row.fetched_at = now
    removed = 0
    for control_id, row in existing.items():
        if control_id not in seen and row.active:
            row.active = False
            removed += 1
    write_audit(
        db,
        module=MODULE,
        action="secure_score.abruf",
        object_type="empfehlung",
        details={"gelesen": len(seen), "neu": new, "entfallen": removed},
    )
    db.commit()
    return ScoreResult(received=len(seen), new=new, removed=removed)


def fetch_secure_score_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf. Ohne die Berechtigung bei Microsoft schlägt der Auftrag fehl."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        fetch_secure_score(db, UtcmClient(http, graph_token_provider(settings)))
