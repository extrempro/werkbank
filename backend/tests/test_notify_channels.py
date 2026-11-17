"""Benachrichtigungen per Mail und Teams: Inhalt, Versand, Einstellungen, Verwaltung."""

import uuid
from datetime import timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS, SMTP, admin, settings_with_key
from tests.test_auth import client_for, login_as, make_app
from werkbank.config import Settings
from werkbank.core.app_settings import SMTP_KEY, TEAMS_KEY, encrypt_secret, set_setting
from werkbank.core.mail import SmtpConfig
from werkbank.core.models import (
    AppSetting,
    Notification,
    NotificationChannel,
    NotificationKind,
    NotificationMark,
    NotificationMute,
    User,
)
from werkbank.core.notify_channels import (
    Brand,
    TeamsError,
    build_mail,
    deliver,
    get_teams_sender,
    mail_html,
    summarize,
    teams_payload,
    valid_workflow_url,
)
from werkbank.core.sessions import now_utc

WORKFLOW = "https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=xyz"
CONFIG = SmtpConfig("smtp.example.com", 587, "starttls", None, None, "wb@example.com", "")
BRAND = Brand(name="Werkbank", accent="#1f57c3", logo_png=None)
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
NOW = now_utc().replace(microsecond=0)


def test_only_power_automate_addresses() -> None:
    assert valid_workflow_url(WORKFLOW)
    assert valid_workflow_url(
        "https://default1234.56.environment.api.powerplatform.com/powerautomate/automations/"
        "direct/workflows/abc/triggers/manual/paths/invoke?sig=x"
    )
    for bad in (
        "http://prod-12.westeurope.logic.azure.com/workflows/abc",
        "https://example.com/workflows/abc",
        "https://logic.azure.com.example.com/x",
        "https://user:pw@prod-12.westeurope.logic.azure.com/workflows/abc",
        "https://prod-12.westeurope.logic.azure.com:8443/workflows/abc",
        "https://prod-12.westeurope.logic.azure.com",
        "https://prod-12.westeurope.logic.azure.com/a b",
        "https://x.logic.azure.com/" + "a" * 2000,
    ):
        assert not valid_workflow_url(bad), bad


def test_digest_counts_modules_without_content() -> None:
    digest = summarize(
        ["budget.rechnung_pruefen", "budget.kuendigung", "evergreen.schritt", "gibt.es_nicht"],
        "Erika Beispiel",
    )
    assert digest.total == 3
    assert digest.modules == [("Evergreen", 1), ("IT-Budget", 2)]


def test_mail_is_branded_plain_and_html_with_embedded_logo() -> None:
    digest = summarize(["budget.rechnung_pruefen"], "Erika Beispiel")
    brand = Brand(name="Werk<bank>", accent="#aa0000", logo_png=PNG)
    message = build_mail(CONFIG, "erika@example.com", brand, digest, "https://werkbank.example.com")
    assert message["Subject"] == "Werk<bank>: eine neue Benachrichtigung"
    text = message.get_body(("plain",))
    html_part = message.get_body(("html",))
    assert isinstance(text, EmailMessage) and isinstance(html_part, EmailMessage)
    plain = text.get_content()
    assert "Hallo Erika Beispiel," in plain
    assert "- IT-Budget: 1" in plain
    assert "https://werkbank.example.com/benachrichtigungen" in plain
    markup = html_part.get_content()
    assert "Werk&lt;bank&gt;" in markup and "<bank>" not in markup
    assert "#aa0000" in markup
    assert "cid:" in markup
    images = [part for part in message.walk() if part.get_content_type() == "image/png"]
    assert len(images) == 1


def test_mail_without_logo_shows_name() -> None:
    markup = mail_html(
        BRAND, summarize(["evergreen.schritt"], "Ina"), "https://w.example.com", None
    )
    assert "cid:" not in markup and ">Werkbank</span>" in markup


def test_teams_card_names_recipient_and_link_only() -> None:
    payload = teams_payload(
        "erika@example.com",
        BRAND,
        summarize(["evergreen.schritt", "evergreen.schritt"], "Erika"),
        "https://werkbank.example.com",
    )
    assert payload["recipient"] == "erika@example.com"
    card = payload["attachments"][0]["content"]
    assert card["type"] == "AdaptiveCard"
    assert "2 neue Benachrichtigungen" in card["body"][1]["text"]
    assert card["body"][2]["facts"] == [{"title": "Evergreen", "value": "2"}]
    assert card["actions"][0]["url"] == "https://werkbank.example.com/benachrichtigungen"


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (
        Notification,
        NotificationChannel,
        NotificationMark,
        NotificationKind,
        NotificationMute,
        AppSetting,
    ):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def person(db: Session, oid: str, email: str | None = "erika@example.com") -> uuid.UUID:
    user = User(entra_oid=f"kanal:{oid}", display_name="Erika Beispiel", email=email)
    db.add(user)
    db.flush()
    return user.id


def configure(db: Session, settings: Settings) -> None:
    set_setting(db, SMTP_KEY, {**SMTP, "password_encrypted": None}, None)
    set_setting(
        db, TEAMS_KEY, {"enabled": True, "url_encrypted": encrypt_secret(settings, WORKFLOW)}, None
    )


def note(db: Session, user_id: uuid.UUID, kind: str, **values: Any) -> Notification:
    row = Notification(user_id=user_id, kind=kind, title="Titel", link="/", **values)
    db.add(row)
    db.flush()
    return row


@pytest.mark.db
def test_deliver_once_per_person_and_channel(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    erika = person(db, "erika")
    ohne = person(db, "ohne-mail", email=None)
    for user_id in (erika, ohne):
        db.add(
            NotificationChannel(
                user_id=user_id,
                channel="mail",
                kind="budget.rechnung_pruefen",
                created_at=NOW - timedelta(hours=2),
            )
        )
    db.add(
        NotificationChannel(
            user_id=erika,
            channel="teams",
            kind="budget.rechnung_pruefen",
            created_at=NOW - timedelta(hours=2),
        )
    )
    note(db, erika, "budget.rechnung_pruefen", created_at=NOW - timedelta(hours=1))
    note(db, erika, "budget.rechnung_pruefen", created_at=NOW - timedelta(minutes=5))
    # gelesen, vor dem Einschalten, zu alt, andere Art: nicht mitteilen
    note(db, erika, "budget.rechnung_pruefen", created_at=NOW, read_at=NOW)
    note(db, erika, "budget.rechnung_pruefen", created_at=NOW - timedelta(hours=3))
    note(db, erika, "budget.kuendigung", created_at=NOW)
    note(db, ohne, "budget.rechnung_pruefen", created_at=NOW)
    db.commit()

    mails: list[EmailMessage] = []
    cards: list[dict[str, Any]] = []
    sent = deliver(
        db,
        settings,
        mail_sender=lambda config, message: mails.append(message),
        teams_sender=lambda url, payload: cards.append(payload),
        now=NOW,
    )
    assert sent == {"mail": 1, "teams": 1}
    assert mails[0]["To"] == "erika@example.com"
    assert mails[0]["Subject"] == "Werkbank: 2 neue Benachrichtigungen"
    assert "Titel" not in str(mails[0])
    assert cards[0]["recipient"] == "erika@example.com"

    again = deliver(
        db,
        settings,
        mail_sender=lambda config, message: mails.append(message),
        teams_sender=lambda url, payload: cards.append(payload),
        now=NOW + timedelta(minutes=15),
    )
    assert again == {"mail": 0, "teams": 0}


@pytest.mark.db
def test_failed_delivery_is_retried(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    erika = person(db, "erneut")
    db.add(
        NotificationChannel(
            user_id=erika, channel="teams", kind="evergreen.schritt", created_at=NOW - timedelta(1)
        )
    )
    note(db, erika, "evergreen.schritt", created_at=NOW)
    db.commit()

    def broken(url: str, payload: dict[str, Any]) -> None:
        raise TeamsError("Der Workflow hat mit 500 geantwortet.")

    assert (
        deliver(db, settings, teams_sender=broken, mail_sender=lambda c, m: None, now=NOW)["teams"]
        == 0
    )
    cards: list[dict[str, Any]] = []
    assert (
        deliver(
            db,
            settings,
            teams_sender=lambda url, payload: cards.append(payload),
            mail_sender=lambda c, m: None,
            now=NOW,
        )["teams"]
        == 1
    )


@pytest.mark.db
def test_nothing_without_configuration(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    erika = person(db, "ohne-server")
    db.add(NotificationChannel(user_id=erika, channel="mail", kind="evergreen.schritt"))
    note(db, erika, "evergreen.schritt", created_at=NOW + timedelta(seconds=1))
    db.commit()
    assert deliver(db, settings, mail_sender=lambda c, m: None, now=NOW) == {
        "mail": 0,
        "teams": 0,
    }


@pytest.mark.db
def test_settings_per_channel(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    db.commit()
    client = client_for(make_app(settings))
    login_as(client, ["Budget.Manager"], oid="kanal-einstellungen")
    data = client.get("/api/notifications/settings").json()
    assert data["channels"] == {"mail": True, "teams": True, "push": False, "has_email": True}
    assert not any(entry["mail"] or entry["teams"] for entry in data["kinds"])

    saved = client.put(
        "/api/notifications/settings",
        json={
            "disabled": ["budget.prognose"],
            "mail": ["budget.rechnung_pruefen", "budget.prognose", "evergreen.schritt"],
            "teams": ["budget.kuendigung"],
        },
        headers=HEADERS,
    ).json()["kinds"]
    by_kind = {entry["kind"]: entry for entry in saved}
    assert by_kind["budget.rechnung_pruefen"]["mail"] is True
    # Ohne Glocke keine Mail; fremde Arten werden nicht gespeichert
    assert by_kind["budget.prognose"]["mail"] is False
    assert "evergreen.schritt" not in by_kind
    assert by_kind["budget.kuendigung"]["teams"] is True
    # Nur die Glocke ändern: Mail und Teams bleiben
    kept = client.put("/api/notifications/settings", json={"disabled": []}, headers=HEADERS).json()[
        "kinds"
    ]
    assert {entry["kind"] for entry in kept if entry["mail"]} == {"budget.rechnung_pruefen"}
    assert (
        client.put(
            "/api/notifications/settings",
            json={"disabled": [], "teams": ["gibt.es_nicht"]},
            headers=HEADERS,
        ).status_code
        == 422
    )


@pytest.mark.db
def test_admin_teams_workflow(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    base = "/api/admin/settings"
    assert client.get(base).json()["teams"] == {
        "enabled": False,
        "url_set": False,
        "url_storage_available": True,
    }
    bad = client.put(
        f"{base}/teams", json={"enabled": True, "url": "https://example.com/hook"}, headers=HEADERS
    )
    assert bad.status_code == 422
    assert client.put(f"{base}/teams", json={"enabled": True}, headers=HEADERS).status_code == 422
    saved = client.put(f"{base}/teams", json={"enabled": True, "url": WORKFLOW}, headers=HEADERS)
    assert saved.json()["teams"] == {
        "enabled": True,
        "url_set": True,
        "url_storage_available": True,
    }
    assert "sig=" not in saved.text
    stored = db.scalars(select(AppSetting).where(AppSetting.key == TEAMS_KEY)).one()
    db.refresh(stored)
    assert WORKFLOW not in str(stored.value)

    cards: list[tuple[str, dict[str, Any]]] = []
    client.app.dependency_overrides[get_teams_sender] = lambda: (  # type: ignore[attr-defined]
        lambda url, payload: cards.append((url, payload))
    )
    result = client.post(f"{base}/teams/test", headers=HEADERS)
    assert result.json() == {"recipient": "erika@example.com"}
    assert cards[0][0] == WORKFLOW
    assert cards[0][1]["recipient"] == "erika@example.com"

    off = client.put(f"{base}/teams", json={"enabled": False, "url": ""}, headers=HEADERS)
    assert off.json()["teams"]["url_set"] is False
    assert client.post(f"{base}/teams/test", headers=HEADERS).status_code == 502
