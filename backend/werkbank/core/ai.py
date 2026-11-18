"""KI-Texte über einen frei einstellbaren Anbieter (spec.md 6.9).

Zwei Arten von Anbietern: eine OpenAI-kompatible Schnittstelle (`/chat/completions`) oder die
Schnittstelle von Anthropic (`/messages`, Mitdenken aus). Art, Adresse, Modell und Schlüssel stehen
in der Verwaltung; der Schlüssel liegt nur verschlüsselt in der Datenbank.
An den Anbieter gehen ausschließlich technische Angaben, nie Werte aus dem Tenant und nie
personenbezogene Daten. Was übergeben wird, entscheidet das aufrufende Modul.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any, Literal

import httpx
from fastapi import Depends
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import decrypt_secret, get_setting

AI_KEY = "ki"
AI_TIMEOUT_SECONDS = 30.0
AI_MAX_TOKENS = 400
AI_TEXT_MAX_LENGTH = 1500
AI_RATE_DEFAULT = 30
AI_RATE_MIN = 1
AI_RATE_MAX = 500
# Art der Schnittstelle; ältere Einstellungen ohne Angabe sind OpenAI-kompatibel
AiProvider = Literal["openai", "anthropic"]
AI_PROVIDERS: tuple[AiProvider, ...] = ("openai", "anthropic")
ANTHROPIC_VERSION = "2023-06-01"
# Bei Anthropic zählt das Mitdenken mit in max_tokens; der Text selbst bleibt kurz
# (AI_TEXT_MAX_LENGTH), das Budget lässt dem Modell Platz zum Denken.
ANTHROPIC_MAX_TOKENS = 4000
# Höchstlänge der Fehlermeldung des Anbieters in der Anzeige
PROVIDER_ERROR_LENGTH = 200


class AiError(Exception):
    """Der Abruf ist fehlgeschlagen. Der Text ist für die Anzeige gedacht (ohne Geheimnisse)."""


@dataclass(frozen=True)
class AiConfig:
    base_url: str
    model: str
    api_key: str | None
    # Höchstzahl neuer Texte je Stunde (begrenzt die Kosten beim Anbieter)
    texts_per_hour: int
    provider: AiProvider = "openai"


def ai_provider(stored: dict[str, Any]) -> AiProvider:
    value = stored.get("provider")
    return "anthropic" if value == "anthropic" else "openai"


def stored_ai(db: Session) -> dict[str, Any]:
    value = get_setting(db, AI_KEY)
    return value if isinstance(value, dict) else {}


def ai_rate(stored: dict[str, Any]) -> int:
    value = stored.get("texts_per_hour")
    if not isinstance(value, int) or isinstance(value, bool):
        return AI_RATE_DEFAULT
    return min(max(value, AI_RATE_MIN), AI_RATE_MAX)


def load_ai_config(
    db: Session, settings: Settings, *, require_enabled: bool = True
) -> AiConfig | None:
    """Einstellungen des Anbieters; None, wenn die KI-Texte aus oder nicht eingerichtet sind."""
    stored = stored_ai(db)
    if require_enabled and stored.get("enabled") is not True:
        return None
    base_url = stored.get("base_url")
    model = stored.get("model")
    if not isinstance(base_url, str) or not base_url or not isinstance(model, str) or not model:
        return None
    token = stored.get("api_key_encrypted")
    api_key = decrypt_secret(settings, token) if isinstance(token, str) and token else None
    if token and api_key is None:
        raise AiError(
            "Der gespeicherte Schlüssel lässt sich nicht lesen. "
            "Bitte in der Verwaltung neu eintragen."
        )
    return AiConfig(
        base_url=base_url.rstrip("/"),
        model=model,
        api_key=api_key,
        texts_per_hour=ai_rate(stored),
        provider=ai_provider(stored),
    )


def provider_error(response: httpx.Response, secret: str | None) -> str:
    """Gekürzte Fehlermeldung des Anbieters, einzeilig und ohne Schlüssel."""
    try:
        data = response.json()
    except ValueError:
        return ""
    error = data.get("error") if isinstance(data, dict) else None
    message = error.get("message") if isinstance(error, dict) else error
    if not isinstance(message, str):
        return ""
    text = " ".join("".join(char if ord(char) >= 32 else " " for char in message).split())
    if secret:
        text = text.replace(secret, "…")
    if len(text) > PROVIDER_ERROR_LENGTH:
        text = text[: PROVIDER_ERROR_LENGTH - 1] + "…"
    return text


def _request(
    config: AiConfig,
    path: str,
    headers: dict[str, str],
    body: dict[str, Any],
    transport: httpx.BaseTransport | None,
) -> Any:
    try:
        # Weiterleitungen werden nicht verfolgt: Der Schlüssel geht nur an die eingetragene Adresse.
        with httpx.Client(
            timeout=AI_TIMEOUT_SECONDS, follow_redirects=False, transport=transport
        ) as client:
            response = client.post(f"{config.base_url}{path}", headers=headers, json=body)
    except httpx.HTTPError as error:
        raise AiError(f"Der Anbieter ist nicht erreichbar ({type(error).__name__}).") from error
    if response.status_code != 200:
        detail = provider_error(response, config.api_key)
        suffix = f" Meldung des Anbieters: {detail}" if detail else ""
        if response.status_code in (401, 403):
            raise AiError(
                "Der Anbieter hat die Anmeldung abgelehnt. Bitte den Schlüssel prüfen." + suffix
            )
        if response.status_code == 404:
            raise AiError("Adresse oder Modell sind dem Anbieter nicht bekannt (404)." + suffix)
        if response.status_code == 429:
            raise AiError(
                "Der Anbieter meldet zu viele Anfragen (429). Später erneut versuchen." + suffix
            )
        raise AiError(
            f"Der Anbieter hat mit einem Fehler geantwortet ({response.status_code})." + suffix
        )
    try:
        return response.json()
    except ValueError as error:
        raise AiError("Die Antwort des Anbieters hat nicht das erwartete Format.") from error


def _openai(
    config: AiConfig, system: str, prompt: str, transport: httpx.BaseTransport | None
) -> Any:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    body = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": AI_MAX_TOKENS,
        "temperature": 0.2,
    }
    data = _request(config, "/chat/completions", headers, body, transport)
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise AiError("Die Antwort des Anbieters hat nicht das erwartete Format.") from error


def _anthropic(
    config: AiConfig, system: str, prompt: str, transport: httpx.BaseTransport | None
) -> Any:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
    }
    if config.api_key:
        headers["x-api-key"] = config.api_key
    # Kurze Beschreibungen: Neuere Modelle lassen das Mitdenken nicht abschalten
    # („thinking.type.disabled is not supported“). Deshalb adaptiv mit geringem Aufwand, damit
    # einfache Fragen meist ohne langes Denken beantwortet werden. Keine temperature, die
    # verträgt sich nicht mit dem Mitdenken.
    body = {
        "model": config.model,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "low"},
    }
    data = _request(config, "/messages", headers, body, transport)
    blocks = data.get("content") if isinstance(data, dict) else None
    if not isinstance(blocks, list):
        raise AiError("Die Antwort des Anbieters hat nicht das erwartete Format.")
    return "".join(
        block["text"]
        for block in blocks
        if isinstance(block, dict)
        and block.get("type") == "text"
        and isinstance(block.get("text"), str)
    )


def complete(
    config: AiConfig,
    system: str,
    prompt: str,
    transport: httpx.BaseTransport | None = None,
) -> str:
    """Schickt eine Anfrage an den Anbieter und gibt den Antworttext zurück."""
    if config.provider == "anthropic":
        text = _anthropic(config, system, prompt, transport)
    else:
        text = _openai(config, system, prompt, transport)
    if not isinstance(text, str) or not text.strip():
        raise AiError("Der Anbieter hat keinen Text geliefert.")
    return text.strip()[:AI_TEXT_MAX_LENGTH]


AiCompleter = Callable[[AiConfig, str, str], str]


def get_ai_completer() -> AiCompleter:
    """In Tests ersetzbar."""
    return complete


AiCompleterDep = Annotated[AiCompleter, Depends(get_ai_completer)]
