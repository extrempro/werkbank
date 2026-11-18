"""KI-Texte: Anbieter in der Verwaltung, Abruf, Vorschläge je Art von Einstellung."""

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import settings_with_key
from tests.test_auth import ORIGIN, client_for, login_as, make_app, make_settings
from tests.test_m365_api import SOURCE, policy
from tests.test_m365_api import client_for as m365_client
from werkbank.core.ai import (
    AI_KEY,
    AiConfig,
    AiError,
    AiProvider,
    complete,
    get_ai_completer,
    load_ai_config,
)
from werkbank.core.app_settings import decrypt_secret, set_setting
from werkbank.core.models import AppSetting, AuditLog
from werkbank.modules.m365_config.ai_texts import (
    SYSTEM_PROMPT,
    build_prompt,
    generate_ai_texts,
    generate_ai_texts_job,
)
from werkbank.modules.m365_config.models import (
    AiTextState,
    CfgAiText,
    CfgChange,
    CfgSetting,
    CfgSettingMeta,
    CfgSettingVersion,
    CfgSnapshot,
)
from werkbank.modules.m365_config.versioning import apply_snapshot

ADMIN = "/api/admin/settings"
M365 = "/api/m365-config"
HEADERS = {"Origin": ORIGIN}
ZUGANG = "zugang-nur-fuer-tests"
AI = {
    "enabled": True,
    "base_url": "https://ki.example.com/v1",
    "model": "beispiel-modell",
    "texts_per_hour": 10,
}
CONFIG = AiConfig("https://ki.example.com/v1", "beispiel-modell", ZUGANG, 10)


def answer(text: str, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"choices": [{"message": {"content": text}}]})

    return httpx.MockTransport(handler)


def admin(tmp_path: Path, calls: list[tuple[str, str]] | None = None) -> TestClient:
    app = make_app(settings_with_key(tmp_path))
    if calls is not None:

        def completer(config: AiConfig, system: str, prompt: str) -> str:
            if config.model == "kaputt":
                raise AiError("Der Anbieter ist nicht erreichbar (ConnectError).")
            calls.append((config.api_key or "", prompt))
            return "OK"

        app.dependency_overrides[get_ai_completer] = lambda: completer
    client = client_for(app)
    login_as(client, ["Werkbank.Admin"], oid="ki-admin")
    return client


@pytest.fixture
def clean(migrated_db: None, db_session: Session) -> Session:
    for table in (CfgAiText, CfgSettingMeta, CfgChange, CfgSettingVersion, CfgSetting, CfgSnapshot):
        db_session.execute(delete(table))
    db_session.execute(delete(AppSetting).where(AppSetting.key == AI_KEY))
    db_session.commit()
    return db_session


@pytest.fixture
def stock(clean: Session) -> Session:
    """Zwei Richtlinien mit derselben Eigenschaft: eine Art von Einstellung, zwei Einstellungen."""
    apply_snapshot(
        clean,
        policy("p1", "MFA für alle", state="enabled") + policy("p2", "Gäste", state="disabled"),
        {SOURCE: True},
    )
    clean.commit()
    return clean


# --- Abruf beim Anbieter ---------------------------------------------------------------


def test_complete_sends_only_what_it_is_given() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "  Ein Text. "}}]})

    text = complete(CONFIG, "System", "Frage", transport=httpx.MockTransport(handler))
    assert text == "Ein Text."
    assert seen["url"] == "https://ki.example.com/v1/chat/completions"
    assert seen["auth"] == f"Bearer {ZUGANG}"
    assert seen["body"]["model"] == "beispiel-modell"
    assert [message["content"] for message in seen["body"]["messages"]] == ["System", "Frage"]


@pytest.mark.parametrize(
    ("status", "fragment"),
    [(401, "Schlüssel"), (404, "Modell"), (429, "zu viele"), (500, "Fehler"), (302, "Fehler")],
)
def test_complete_reports_errors_without_details(status: int, fragment: str) -> None:
    with pytest.raises(AiError, match=fragment) as caught:
        complete(CONFIG, "System", "Frage", transport=answer("egal", status))
    assert ZUGANG not in str(caught.value)


def test_complete_anthropic_uses_messages_with_low_effort() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-api-key")
        seen["auth"] = request.headers.get("authorization")
        seen["version"] = request.headers.get("anthropic-version")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": " Ein "}, {"type": "text", "text": "Text. "}]
            },
        )

    config = replace(CONFIG, provider="anthropic")
    text = complete(config, "System", "Frage", transport=httpx.MockTransport(handler))
    assert text == "Ein Text."
    assert seen["url"] == "https://ki.example.com/v1/messages"
    assert (seen["key"], seen["auth"]) == (ZUGANG, None)
    assert seen["version"] == "2023-06-01"
    body = seen["body"]
    assert body["system"] == "System"
    assert body["messages"] == [{"role": "user", "content": "Frage"}]
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "low"}
    assert body["max_tokens"] == 4000
    assert "temperature" not in body

    with pytest.raises(AiError, match="keinen Text"):
        complete(
            config,
            "System",
            "Frage",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"content": [{"type": "thinking"}]})
            ),
        )


def test_complete_shows_shortened_provider_message_without_key() -> None:
    message = f"model: unbekannt\nSchlüssel {ZUGANG} " + "x" * 400

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"type": "error", "error": {"message": message}})

    providers: tuple[AiProvider, ...] = ("openai", "anthropic")
    for provider in providers:
        config = replace(CONFIG, provider=provider)
        with pytest.raises(AiError) as caught:
            complete(config, "System", "Frage", transport=httpx.MockTransport(handler))
        text = str(caught.value)
        assert text.startswith("Der Anbieter hat mit einem Fehler geantwortet (400).")
        assert "Meldung des Anbieters: model: unbekannt Schlüssel" in text
        assert ZUGANG not in text
        assert "\n" not in text
        assert len(text) < 300


def test_complete_rejects_unexpected_answers() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unerwartet": True})

    with pytest.raises(AiError, match="Format"):
        complete(CONFIG, "System", "Frage", transport=httpx.MockTransport(broken))
    with pytest.raises(AiError, match="keinen Text"):
        complete(CONFIG, "System", "Frage", transport=answer("   "))

    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nicht erreichbar")

    with pytest.raises(AiError, match="nicht erreichbar"):
        complete(CONFIG, "System", "Frage", transport=httpx.MockTransport(offline))


def test_prompt_contains_no_tenant_data() -> None:
    prompt = build_prompt("entra", "conditionalAccessPolicy", "state")
    assert prompt == "Dienst: entra\nBereich: conditionalAccessPolicy\nEigenschaft: state"
    assert "UNBEKANNT" in SYSTEM_PROMPT


# --- Verwaltung ------------------------------------------------------------------------


@pytest.mark.db
def test_ai_settings_need_admin(clean: Session) -> None:
    reader = client_for(make_app())
    login_as(reader, ["Config.Reviewer"], oid="ki-leser")
    assert reader.put(f"{ADMIN}/ai", json=AI, headers=HEADERS).status_code == 403
    assert reader.post(f"{ADMIN}/ai/test", headers=HEADERS).status_code == 403


@pytest.mark.db
def test_ai_settings_are_saved_with_encrypted_key(clean: Session, tmp_path: Path) -> None:
    client = admin(tmp_path)
    defaults = client.get(ADMIN).json()["ai"]
    assert (defaults["enabled"], defaults["api_key_set"], defaults["texts_per_hour"]) == (
        False,
        False,
        30,
    )
    response = client.put(f"{ADMIN}/ai", json={**AI, "api_key": ZUGANG}, headers=HEADERS)
    assert response.status_code == 200, response.text
    assert ZUGANG not in response.text
    data = response.json()["ai"]
    assert (data["enabled"], data["api_key_set"], data["model"]) == (True, True, "beispiel-modell")

    clean.expire_all()
    stored = clean.get(AppSetting, AI_KEY)
    assert stored is not None
    assert ZUGANG not in json.dumps(stored.value)
    settings = settings_with_key(tmp_path)
    assert decrypt_secret(settings, stored.value["api_key_encrypted"]) == ZUGANG
    config = load_ai_config(clean, settings)
    assert config is not None and config.api_key == ZUGANG and config.texts_per_hour == 10

    assert config.provider == "openai" and data["provider"] == "openai"
    anthropic = client.put(f"{ADMIN}/ai", json={**AI, "provider": "anthropic"}, headers=HEADERS)
    assert anthropic.json()["ai"]["provider"] == "anthropic"
    clean.expire_all()
    config = load_ai_config(clean, settings)
    assert config is not None and config.provider == "anthropic"
    assert (
        client.put(f"{ADMIN}/ai", json={**AI, "provider": "andere"}, headers=HEADERS).status_code
        == 422
    )

    # ohne neuen Schlüssel bleibt der alte; leerer Text löscht ihn
    kept = client.put(f"{ADMIN}/ai", json={**AI, "model": "anderes"}, headers=HEADERS)
    assert kept.json()["ai"]["api_key_set"] is True
    removed = client.put(f"{ADMIN}/ai", json={**AI, "api_key": ""}, headers=HEADERS)
    assert removed.json()["ai"]["api_key_set"] is False
    entry = clean.scalars(
        select(AuditLog)
        .where(AuditLog.action == "einstellungen.ki_geaendert")
        .order_by(AuditLog.id.desc())
    ).first()
    assert entry is not None and ZUGANG not in json.dumps(entry.details)


@pytest.mark.db
def test_ai_settings_validation(clean: Session, tmp_path: Path) -> None:
    client = admin(tmp_path)
    for patch in (
        {"base_url": "ki.example.com/v1"},
        {"base_url": "ftp://ki.example.com"},
        {"base_url": "https://ki.example.com/v1?x=1"},
        {"base_url": "https://benutzer:pw@ki.example.com"},
        {"model": "mit leerzeichen"},
        {"texts_per_hour": 0},
        {"texts_per_hour": 501},
        {"base_url": ""},
        {"model": ""},
    ):
        response = client.put(f"{ADMIN}/ai", json={**AI, **patch}, headers=HEADERS)
        assert response.status_code == 422, patch
    # Schlüssel nur über eine verschlüsselte Verbindung
    plain = {**AI, "base_url": "http://ki.example.com/v1", "api_key": ZUGANG}
    assert client.put(f"{ADMIN}/ai", json=plain, headers=HEADERS).status_code == 422
    # ohne Schlüssel ist ein Dienst im internen Netz erlaubt
    local = {**AI, "base_url": "http://ki.example.com:11434/v1"}
    assert client.put(f"{ADMIN}/ai", json=local, headers=HEADERS).status_code == 200
    # ausgeschaltet darf alles leer sein
    off = {"enabled": False, "base_url": "", "model": "", "texts_per_hour": 30}
    assert client.put(f"{ADMIN}/ai", json=off, headers=HEADERS).status_code == 200

    no_key_file = client_for(make_app(make_settings(settings_key_file=tmp_path / "fehlt")))
    login_as(no_key_file, ["Werkbank.Admin"], oid="ki-admin")
    conflict = no_key_file.put(f"{ADMIN}/ai", json={**AI, "api_key": ZUGANG}, headers=HEADERS)
    assert conflict.status_code == 409


@pytest.mark.db
def test_ai_connection_test(clean: Session, tmp_path: Path) -> None:
    calls: list[tuple[str, str]] = []
    client = admin(tmp_path, calls)
    missing = client.post(f"{ADMIN}/ai/test", headers=HEADERS)
    assert missing.status_code == 502
    # der Test geht auch, wenn die KI-Texte noch ausgeschaltet sind
    client.put(f"{ADMIN}/ai", json={**AI, "enabled": False, "api_key": ZUGANG}, headers=HEADERS)
    ok = client.post(f"{ADMIN}/ai/test", headers=HEADERS)
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"model": "beispiel-modell"}
    assert calls == [(ZUGANG, "Verbindungstest")]

    client.put(f"{ADMIN}/ai", json={**AI, "model": "kaputt"}, headers=HEADERS)
    failed = client.post(f"{ADMIN}/ai/test", headers=HEADERS)
    assert failed.status_code == 502
    assert "nicht erreichbar" in failed.json()["detail"]
    results = clean.scalars(
        select(AuditLog.result)
        .where(AuditLog.action == "einstellungen.ki_test")
        .order_by(AuditLog.id.desc())
        .limit(2)
    ).all()
    assert list(results) == ["fehler", "ok"]


# --- Vorschläge ------------------------------------------------------------------------


@pytest.mark.db
def test_one_text_per_kind_of_setting(stock: Session) -> None:
    prompts: list[str] = []

    def completer(config: AiConfig, system: str, prompt: str) -> str:
        prompts.append(prompt)
        return "Legt fest, ob die Richtlinie wirkt."

    assert generate_ai_texts(stock, CONFIG, completer) == 1
    # zwei Richtlinien, aber nur eine Anfrage, und darin weder Namen noch Werte
    assert prompts == ["Dienst: entra\nBereich: conditionalAccessPolicy\nEigenschaft: state"]
    text = stock.scalars(select(CfgAiText)).one()
    assert (text.state, text.model) == (AiTextState.UNREVIEWED, "beispiel-modell")
    # ein zweiter Lauf erzeugt nichts Neues
    assert generate_ai_texts(stock, CONFIG, completer) == 0
    assert len(prompts) == 1


@pytest.mark.db
def test_unknown_error_and_limit(clean: Session) -> None:
    apply_snapshot(
        clean,
        policy("p1", "Eins", alpha=1, beta=2, gamma=3, delta=4),
        {SOURCE: True},
    )
    clean.commit()

    def completer(config: AiConfig, system: str, prompt: str) -> str:
        if prompt.endswith("beta"):
            return "UNBEKANNT."
        if prompt.endswith("gamma"):
            raise AiError("Der Anbieter meldet zu viele Anfragen (429).")
        return "Ein Text."

    limited = AiConfig(CONFIG.base_url, CONFIG.model, None, 2)
    assert generate_ai_texts(clean, limited, completer) == 2
    rows = clean.execute(select(CfgAiText.property, CfgAiText.state)).all()
    states = {row[0]: row[1] for row in rows}
    assert states == {"alpha": AiTextState.UNREVIEWED, "beta": AiTextState.UNKNOWN}
    # nächster Lauf: delta kommt vor gamma, bei gamma bricht der Lauf ab und wird protokolliert
    assert generate_ai_texts(clean, limited, completer) == 1
    assert clean.scalars(select(CfgAiText.property).order_by(CfgAiText.property)).all() == [
        "alpha",
        "beta",
        "delta",
    ]
    entry = clean.scalars(
        select(AuditLog).where(AuditLog.action == "ki.texte_erzeugt").order_by(AuditLog.id.desc())
    ).first()
    assert entry is not None and entry.result == "fehler" and "429" in (entry.note or "")


@pytest.mark.db
def test_settings_with_own_description_are_skipped(stock: Session) -> None:
    for setting in stock.scalars(select(CfgSetting)).all():
        stock.add(CfgSettingMeta(setting_id=setting.id, description="Von Hand beschrieben."))
    stock.commit()
    assert generate_ai_texts(stock, CONFIG, lambda *_: "Ein Text.") == 0


@pytest.mark.db
def test_job_does_nothing_while_disabled(stock: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    generate_ai_texts_job(stock, settings, {})
    set_setting(stock, AI_KEY, {**AI, "enabled": False}, None)
    stock.commit()
    generate_ai_texts_job(stock, settings, {})
    assert stock.scalars(select(CfgAiText)).all() == []


@pytest.mark.db
def test_review_of_ai_text(stock: Session) -> None:
    generate_ai_texts(stock, CONFIG, lambda *_: "Legt fest, ob die Richtlinie wirkt.")
    ids = stock.scalars(select(CfgSetting.id).order_by(CfgSetting.id)).all()
    reader = m365_client(["Config.Reader"], "ki-m365-leser")
    listing = reader.get(f"{M365}/settings").json()["entries"]
    assert [entry["ai_unreviewed"] for entry in listing] == [True, True]
    detail = reader.get(f"{M365}/settings/{ids[0]}").json()
    assert detail["ai_text"]["text"] == "Legt fest, ob die Richtlinie wirkt."
    assert detail["ai_text"]["state"] == "ungeprueft"
    forbidden = reader.post(
        f"{M365}/settings/{ids[0]}/ai-text", json={"action": "freigeben"}, headers=HEADERS
    )
    assert forbidden.status_code == 403

    reviewer = m365_client(["Config.Reviewer"], "ki-m365-reviewer")
    approved = reviewer.post(
        f"{M365}/settings/{ids[0]}/ai-text", json={"action": "freigeben"}, headers=HEADERS
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["state"] == "geprueft"
    # gilt für beide Einstellungen derselben Art
    other = reader.get(f"{M365}/settings/{ids[1]}").json()
    assert other["ai_text"]["state"] == "geprueft"
    assert other["setting"]["ai_unreviewed"] is False

    dismissed = reviewer.post(
        f"{M365}/settings/{ids[1]}/ai-text", json={"action": "verwerfen"}, headers=HEADERS
    )
    assert dismissed.status_code == 200 and dismissed.json() is None
    assert reader.get(f"{M365}/settings/{ids[0]}").json()["ai_text"] is None
    again = reviewer.post(
        f"{M365}/settings/{ids[0]}/ai-text", json={"action": "freigeben"}, headers=HEADERS
    )
    assert again.status_code == 404
    # verworfen heißt auch: kein neuer Versuch
    assert generate_ai_texts(stock, CONFIG, lambda *_: "Neuer Text.") == 0
    actions = stock.scalars(
        select(AuditLog.action).where(
            AuditLog.object_type == "ki_text", AuditLog.user_id.is_not(None)
        )
    ).all()
    assert {"ki.text_freigegeben", "ki.text_verworfen"} <= set(actions)
