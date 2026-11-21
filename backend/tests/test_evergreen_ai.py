"""KI-Vorschläge für Rollout-Phasen und Steckbrief in Evergreen (spec.md 8.4)."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import settings_with_key
from tests.test_auth import ORIGIN, client_for, login_as, make_app
from werkbank.core.ai import AI_KEY, AiConfig, AiError, get_ai_completer
from werkbank.core.app_settings import set_setting
from werkbank.core.models import AppSetting, AuditLog
from werkbank.modules.evergreen.ai_suggest import (
    SYSTEM_PROMPT,
    apply_answer,
    build_prompt,
    evergreen_ai_enabled,
    generate_suggestions,
    parse_answer,
)
from werkbank.modules.evergreen.message_center import apply_suggestions
from werkbank.modules.evergreen.models import EvEntry, EvNote
from werkbank.modules.evergreen.service import create_entry

HEADERS = {"Origin": ORIGIN}
BASE = "/api/evergreen"
AI = {
    "base_url": "https://ki.example.com/v1",
    "model": "beispiel-modell",
    "texts_per_hour": 3,
}
CONFIG = AiConfig("https://ki.example.com/v1", "beispiel-modell", None, 3)
BODY = (
    "[What and why:]\nTeams summarizes meetings.\n"
    "[When this will happen:]\nRollout starts mid-March 2027 (previously February) "
    "and completes by early May 2027.\n"
    "[How this will affect your organization:]\nThe feature is on by default. "
    "Admins can turn it off with the meeting policy."
)
GOOD = json.dumps(
    {
        "phases": [{"name": "Allgemein verfügbar", "start": "2027-03", "end": "2027-05"}],
        "affected": "Alle Nutzer mit Teams",
        "default_state": "an",
        "controllable": True,
        "controllable_how": "Besprechungsrichtlinie",
    }
)


def message(db: Session, ref: str = "MC700001", **extra: Any) -> EvEntry:
    entry = create_entry(
        db,
        software="m365",
        title="Teams fasst Besprechungen zusammen",
        source="nachrichtencenter",
        source_ref=ref,
        body=BODY,
        services=["Microsoft Teams"],
        **extra,
    )
    apply_suggestions(entry)
    entry.ai_pending = True
    db.commit()
    return entry


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Iterator[Session]:
    db_session.execute(delete(EvEntry))
    db_session.execute(delete(AppSetting).where(AppSetting.key == AI_KEY))
    db_session.commit()
    yield db_session
    db_session.rollback()
    db_session.execute(delete(AppSetting).where(AppSetting.key == AI_KEY))
    db_session.commit()


def test_parse_answer_accepts_only_the_format() -> None:
    answer = parse_answer(f"Hier ist das Ergebnis:\n```json\n{GOOD}\n```")
    assert answer is not None and answer.phases[0].start == "2027-03"
    assert parse_answer("keine Ahnung") is None
    assert parse_answer('{"phases": [{"name": "X", "start": "2027-13", "end": "2027-01"}]}') is None
    assert parse_answer('{"phases": [{"name": "X", "start": "2027-05", "end": "2027-01"}]}') is None
    assert parse_answer('{"default_state": "vielleicht"}') is None
    too_many = [{"name": f"P{i}", "start": "2027-01", "end": "2027-01"} for i in range(7)]
    assert parse_answer(json.dumps({"phases": too_many})) is None
    assert parse_answer("{}") is not None


def test_prompt_contains_only_microsoft_text(db: Session) -> None:
    entry = message(db)
    entry.summary = "Geheime Einschätzung"
    entry.staff_change = "Interna"
    prompt = build_prompt(entry)
    assert prompt is not None
    assert "previously February" in prompt and "meeting policy" in prompt
    assert "What and why" not in prompt
    assert "Geheime" not in prompt and "Interna" not in prompt
    assert "JSON" in SYSTEM_PROMPT


def test_answer_only_fills_unchecked_fields(db: Session) -> None:
    entry = message(db)
    # von Hand geprüft
    entry.default_state = "aus"
    entry.suggested = [field for field in entry.suggested if field != "default_state"]
    answer = parse_answer(GOOD)
    assert answer is not None
    changed = apply_answer(entry, answer)
    assert changed == ["phases", "affected", "controllable"]
    assert entry.default_state == "aus"
    assert entry.controllable_how == "Besprechungsrichtlinie"
    assert set(entry.ai_suggested) == {"phases", "affected", "controllable"}
    assert entry.phases == [{"name": "Allgemein verfügbar", "start": "2027-03", "end": "2027-05"}]


def test_job_respects_switch_limit_and_errors(db: Session) -> None:
    first, second = message(db, "MC700001"), message(db, "MC700002")
    third = message(db, "MC700003")
    calls: list[str] = []

    def completer(config: AiConfig, system: str, prompt: str) -> str:
        calls.append(prompt)
        if len(calls) == 2:
            raise AiError("Der Anbieter ist nicht erreichbar (ConnectError).")
        return GOOD

    assert not evergreen_ai_enabled(db)
    set_setting(db, AI_KEY, {**AI, "enabled": True}, None)
    db.commit()
    assert not evergreen_ai_enabled(db)  # die Beschreibungen in M365 schalten Evergreen nicht ein
    set_setting(db, AI_KEY, {**AI, "evergreen": True}, None)
    db.commit()
    assert evergreen_ai_enabled(db)

    assert generate_suggestions(db, CONFIG, completer) == 1
    db.expire_all()
    pending = {entry.source_ref: entry.ai_pending for entry in (first, second, third)}
    assert list(pending.values()).count(False) == 1
    notes = db.scalars(select(EvNote).where(EvNote.kind == "ki")).all()
    assert len(notes) == 1 and notes[0].text is not None and "Rollout" in notes[0].text
    failure = db.scalars(select(AuditLog).where(AuditLog.action == "ki.vorschlaege")).all()
    assert failure and failure[-1].result == "fehler"
    # Höchstzahl je Stunde: 3, eine schon verbraucht
    calls.clear()
    assert generate_suggestions(db, CONFIG, lambda c, s, p: GOOD) == 2
    assert generate_suggestions(db, CONFIG, lambda c, s, p: GOOD) == 0


def test_button_and_assessment(db: Session, tmp_path: Path) -> None:
    entry = message(db)
    entry_id = entry.id
    app = make_app(settings_with_key(tmp_path))
    calls: list[str] = []

    def completer(config: AiConfig, system: str, prompt: str) -> str:
        calls.append(prompt)
        return GOOD

    app.dependency_overrides[get_ai_completer] = lambda: completer
    client = client_for(app)
    login_as(client, ["Evergreen.Editor"], oid="ev-ki")
    url = f"{BASE}/entries/{entry_id}/ai-suggestion"

    off = client.post(url, headers=HEADERS)
    assert off.status_code == 409 and "ausgeschaltet" in off.json()["detail"]
    assert client.get(f"{BASE}/entries/{entry_id}").json()["ai_available"] is False

    set_setting(db, AI_KEY, {**AI, "evergreen": True}, None)
    db.commit()
    data = client.post(url, headers=HEADERS).json()
    assert data["ai_available"] is True and data["ai_pending"] is False
    assert set(data["ai_suggested"]) == {"phases", "affected", "default_state", "controllable"}
    assert data["default_state"] == "an" and data["notes"][-1]["kind"] == "ki"
    again = client.post(url, headers=HEADERS)
    assert again.status_code == 409 and "gerade erst" in again.json()["detail"]
    assert len(calls) == 1

    saved = client.put(
        f"{BASE}/entries/{entry_id}/assessment",
        json={"phases": data["phases"], "default_state": "an"},
        headers=HEADERS,
    ).json()
    assert saved["ai_suggested"] == [] and saved["suggested"] == []

    reader = client_for(app)
    login_as(reader, ["Evergreen.Reader"], oid="ev-ki-leser")
    assert reader.post(url, headers=HEADERS).status_code == 403


def test_admin_switch_for_evergreen(db: Session, tmp_path: Path) -> None:
    client = client_for(make_app(settings_with_key(tmp_path)))
    login_as(client, ["Werkbank.Admin"], oid="ev-ki-admin")
    assert client.get("/api/admin/settings").json()["ai"]["evergreen"] is False
    body = {**AI, "enabled": False, "evergreen": True}
    saved = client.put("/api/admin/settings/ai", json=body, headers=HEADERS)
    assert saved.status_code == 200, saved.text
    assert saved.json()["ai"]["evergreen"] is True
    missing = client.put(
        "/api/admin/settings/ai",
        json={**body, "base_url": "", "model": ""},
        headers=HEADERS,
    )
    assert missing.status_code == 422
