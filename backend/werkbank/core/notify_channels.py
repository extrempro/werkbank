"""Benachrichtigungen per Mail und Teams (spec.md 6.7).

Gesammelt: Ein Auftrag fasst alle 15 Minuten die neuen, ungelesenen Benachrichtigungen je Person
zusammen und schickt je Kanal höchstens eine Nachricht. Sie nennt nur Anzahl und Bereich, nie
den Inhalt, und führt per Link in die Werkbank. Jede Person schaltet Arten je Kanal selbst ein
(Vorgabe: aus); mitgeteilt wird nur, was nach dem Einschalten entstanden ist.

Teams: Die Werkbank schickt eine Adaptive Card mit der Mailadresse der Person an einen
Power-Automate-Workflow („Wenn eine Teams-Webhookanforderung empfangen wird“). Der Workflow
postet sie als Flow-Bot in den Chat der Person (docs/teams-workflow.md).
"""

import html
import logging
import re
import uuid
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Annotated, Any
from urllib.parse import urlsplit

import httpx
from fastapi import Depends
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import TEAMS_KEY, decrypt_secret, get_setting
from werkbank.core.branding import ACCENT_PATTERN, BRANDING_KEY, DEFAULT_NAME
from werkbank.core.mail import MailError, SmtpConfig, load_smtp_config, send_message
from werkbank.core.models import BrandingAsset, Notification, NotificationChannel, User
from werkbank.core.notifications import KINDS
from werkbank.core.sessions import now_utc

logger = logging.getLogger(__name__)

DELIVER = "kern.benachrichtigungen_versand"
DELIVER_INTERVAL = timedelta(minutes=15)
CHANNEL_MAIL = "mail"
CHANNEL_TEAMS = "teams"
CHANNELS = (CHANNEL_MAIL, CHANNEL_TEAMS)
# Ältere, noch nicht mitgeteilte Benachrichtigungen werden nicht mehr verschickt
MAX_AGE = timedelta(hours=24)
DEFAULT_ACCENT = "#1f57c3"
TEAMS_TIMEOUT_SECONDS = 15
URL_MAX = 2000
# Nur Adressen von Power Automate bzw. Logic Apps (kein beliebiges Ziel vom Server aus)
WORKFLOW_HOSTS = (".logic.azure.com", ".api.powerplatform.com")
LINK_PATH = "/benachrichtigungen"
SETTINGS_PATH = "/konto"
LOGO_CID_DOMAIN = "werkbank.invalid"


class TeamsError(Exception):
    """Der Versand an Teams ist fehlgeschlagen. Text für die Anzeige, ohne Adresse."""


def valid_workflow_url(value: str) -> bool:
    """https-Adresse eines Power-Automate-Workflows, ohne Benutzerangaben, Port nur 443."""
    if len(value) > URL_MAX or any(ord(char) < 33 for char in value):
        return False
    parts = urlsplit(value)
    host = (parts.hostname or "").lower()
    return (
        parts.scheme == "https"
        and parts.username is None
        and parts.password is None
        and parts.port in (None, 443)
        and bool(re.fullmatch(r"[a-z0-9.-]+", host))
        and host.endswith(WORKFLOW_HOSTS)
        and bool(parts.path)
    )


def load_teams_url(db: Session, settings: Settings) -> str | None:
    """Adresse des Workflows, wenn eingetragen und eingeschaltet."""
    stored: Any = get_setting(db, TEAMS_KEY)
    if not isinstance(stored, dict) or stored.get("enabled") is not True:
        return None
    token = stored.get("url_encrypted")
    url = decrypt_secret(settings, token) if isinstance(token, str) and token else None
    return url if url and valid_workflow_url(url) else None


TeamsSender = Callable[[str, dict[str, Any]], None]


def send_teams(url: str, payload: dict[str, Any]) -> None:
    """Schickt die Nachricht an den Workflow. Weiterleitungen werden nicht verfolgt."""
    try:
        response = httpx.post(
            url, json=payload, timeout=TEAMS_TIMEOUT_SECONDS, follow_redirects=False
        )
    except httpx.HTTPError as error:
        raise TeamsError(f"Der Workflow ist nicht erreichbar ({type(error).__name__}).") from error
    if response.status_code >= 300:
        raise TeamsError(f"Der Workflow hat mit {response.status_code} geantwortet.")


def get_teams_sender() -> TeamsSender:
    """In Tests ersetzbar."""
    return send_teams


TeamsSenderDep = Annotated[TeamsSender, Depends(get_teams_sender)]

MailMessageSender = Callable[[SmtpConfig, EmailMessage], None]


@dataclass(frozen=True)
class Brand:
    name: str
    accent: str
    # PNG für die Mail (eingebettet); andere Formate zeigen viele Mailprogramme nicht
    logo_png: bytes | None


def load_brand(db: Session) -> Brand:
    stored: Any = get_setting(db, BRANDING_KEY)
    data = stored if isinstance(stored, dict) else {}
    name = data.get("app_name")
    accent = data.get("accent")
    logo = db.get(BrandingAsset, "logo-hell")
    return Brand(
        name=name if isinstance(name, str) and name else DEFAULT_NAME,
        accent=accent
        if isinstance(accent, str) and ACCENT_PATTERN.match(accent)
        else DEFAULT_ACCENT,
        logo_png=logo.data if logo is not None and logo.content_type == "image/png" else None,
    )


@dataclass(frozen=True)
class Digest:
    """Was eine Person bekommt: Anzahl je Bereich, ohne Inhalte."""

    name: str
    total: int
    modules: list[tuple[str, int]]


def summarize(kinds: list[str], name: str) -> Digest:
    counts = Counter(KINDS[kind].module for kind in kinds if kind in KINDS)
    return Digest(name=name, total=sum(counts.values()), modules=sorted(counts.items()))


def _count_text(total: int) -> str:
    return "eine neue Benachrichtigung" if total == 1 else f"{total} neue Benachrichtigungen"


def mail_subject(brand: Brand, digest: Digest) -> str:
    return f"{brand.name}: {_count_text(digest.total)}"


def mail_text(brand: Brand, digest: Digest, base_url: str) -> str:
    lines = [
        f"Hallo {digest.name},",
        "",
        f"in {brand.name} gibt es {_count_text(digest.total)} für dich:",
        "",
        *[f"- {module}: {count}" for module, count in digest.modules],
        "",
        f"Ansehen: {base_url}{LINK_PATH}",
        "",
        f"Welche Benachrichtigungen du per Mail bekommst, stellst du in {brand.name} "
        f"unter Konto ein: {base_url}{SETTINGS_PATH}",
    ]
    return "\n".join(lines)


def mail_html(brand: Brand, digest: Digest, base_url: str, logo_cid: str | None) -> str:
    """Schlichte HTML-Mail mit Name, Farbe und Logo aus dem Branding. Alles kodiert."""
    name = html.escape(brand.name)
    accent = html.escape(brand.accent)
    head = (
        f'<img src="cid:{html.escape(logo_cid)}" alt="{name}" height="32" '
        'style="display:block;height:32px;width:auto">'
        if logo_cid
        else f'<span style="font-size:18px;font-weight:700;color:#ffffff">{name}</span>'
    )
    rows = "".join(
        f'<tr><td style="padding:4px 0">{html.escape(module)}</td>'
        f'<td style="padding:4px 0 4px 16px;text-align:right">{count}</td></tr>'
        for module, count in digest.modules
    )
    link = html.escape(f"{base_url}{LINK_PATH}", quote=True)
    settings_link = html.escape(f"{base_url}{SETTINGS_PATH}", quote=True)
    return (
        '<!DOCTYPE html><html lang="de"><body style="margin:0;padding:0;background:#f5f6f8;'
        'font-family:Segoe UI,Arial,sans-serif;color:#171a1f">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        '<tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">'
        f'<tr><td style="background:{accent};padding:16px 24px">{head}</td></tr>'
        '<tr><td style="padding:24px">'
        f'<p style="margin:0 0 12px">Hallo {html.escape(digest.name)},</p>'
        f'<p style="margin:0 0 16px">in {name} gibt es '
        f"{html.escape(_count_text(digest.total))} für dich:</p>"
        f'<table role="presentation" cellpadding="0" cellspacing="0">{rows}</table>'
        f'<p style="margin:24px 0"><a href="{link}" style="display:inline-block;'
        f"background:{accent};color:#ffffff;text-decoration:none;padding:10px 18px;"
        'border-radius:8px;font-weight:600">Benachrichtigungen ansehen</a></p>'
        '<p style="margin:0;font-size:13px;color:#4f5765">Welche Benachrichtigungen du '
        f"per Mail bekommst, stellst du in {name} unter "
        f'<a href="{settings_link}" style="color:#4f5765">Konto</a> ein.</p>'
        "</td></tr></table></td></tr></table></body></html>"
    )


def build_mail(
    config: SmtpConfig, recipient: str, brand: Brand, digest: Digest, base_url: str
) -> EmailMessage:
    """Mail mit Text- und HTML-Teil; das Logo hängt eingebettet an (keine externe Adresse)."""
    message = EmailMessage()
    message["From"] = formataddr((config.sender_name or brand.name, config.sender_address))
    message["To"] = recipient
    message["Subject"] = mail_subject(brand, digest)
    message.set_content(mail_text(brand, digest, base_url))
    cid = make_msgid(domain=LOGO_CID_DOMAIN) if brand.logo_png else None
    message.add_alternative(
        mail_html(brand, digest, base_url, cid[1:-1] if cid else None), subtype="html"
    )
    if cid and brand.logo_png:
        html_part = message.get_payload()[1]  # type: ignore[index]
        html_part.add_related(brand.logo_png, maintype="image", subtype="png", cid=cid)
    return message


def teams_payload(recipient: str, brand: Brand, digest: Digest, base_url: str) -> dict[str, Any]:
    """Nachricht für den Workflow: Empfänger und eine Adaptive Card ohne Inhalte."""
    card: dict[str, Any] = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [
            {
                "type": "TextBlock",
                "text": brand.name,
                "weight": "Bolder",
                "size": "Medium",
                "color": "Accent",
            },
            {
                "type": "TextBlock",
                "text": f"Hallo {digest.name}, in {brand.name} gibt es "
                f"{_count_text(digest.total)} für dich.",
                "wrap": True,
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": module, "value": str(count)} for module, count in digest.modules
                ],
            },
        ],
        "actions": [
            {
                "type": "Action.OpenUrl",
                "title": "Benachrichtigungen ansehen",
                "url": f"{base_url}{LINK_PATH}",
            }
        ],
    }
    return {
        "type": "message",
        "recipient": recipient,
        "summary": mail_subject(brand, digest),
        "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "content": card}
        ],
    }


def sample_digest(name: str) -> Digest:
    """Für den Test aus der Verwaltung: eine erfundene Benachrichtigung ohne Inhalt."""
    return Digest(name=name, total=1, modules=[("Werkbank", 1)])


def _pending(db: Session, channel: str, since: datetime) -> dict[uuid.UUID, list[Notification]]:
    sent = Notification.mailed_at if channel == CHANNEL_MAIL else Notification.teams_at
    rows = db.scalars(
        select(Notification)
        .join(
            NotificationChannel,
            (NotificationChannel.user_id == Notification.user_id)
            & (NotificationChannel.kind == Notification.kind)
            & (NotificationChannel.channel == channel),
        )
        .where(
            sent.is_(None),
            Notification.read_at.is_(None),
            Notification.created_at >= since,
            Notification.created_at >= NotificationChannel.created_at,
        )
        .order_by(Notification.id)
    ).all()
    grouped: dict[uuid.UUID, list[Notification]] = {}
    for row in rows:
        grouped.setdefault(row.user_id, []).append(row)
    return grouped


def deliver(
    db: Session,
    settings: Settings,
    *,
    mail_sender: MailMessageSender = send_message,
    teams_sender: TeamsSender = send_teams,
    now: datetime | None = None,
) -> dict[str, int]:
    """Schickt je Person und Kanal eine Sammelnachricht. Liefert die Zahl der Nachrichten."""
    now = now or now_utc()
    since = now - MAX_AGE
    base_url = settings.public_origin
    brand = load_brand(db)
    sent = {CHANNEL_MAIL: 0, CHANNEL_TEAMS: 0}
    try:
        smtp = load_smtp_config(db, settings)
    except MailError:
        logger.warning("Mailversand: Die SMTP-Einstellungen lassen sich nicht lesen.")
        smtp = None
    teams_url = load_teams_url(db, settings)
    targets: dict[str, bool] = {CHANNEL_MAIL: smtp is not None, CHANNEL_TEAMS: bool(teams_url)}
    for channel in CHANNELS:
        if not targets[channel]:
            continue
        for user_id, rows in _pending(db, channel, since).items():
            user = db.get(User, user_id)
            if user is None or not user.email:
                continue
            digest = summarize([row.kind for row in rows], user.display_name)
            try:
                if channel == CHANNEL_MAIL and smtp is not None:
                    mail_sender(smtp, build_mail(smtp, user.email, brand, digest, base_url))
                elif channel == CHANNEL_TEAMS and teams_url:
                    teams_sender(teams_url, teams_payload(user.email, brand, digest, base_url))
            except (MailError, TeamsError) as error:
                # Beim nächsten Lauf erneut; nach 24 Stunden verfällt es.
                logger.warning("Versand per %s fehlgeschlagen: %s", channel, error)
                continue
            column = Notification.mailed_at if channel == CHANNEL_MAIL else Notification.teams_at
            db.execute(
                update(Notification)
                .where(Notification.id.in_([row.id for row in rows]))
                .values({column: now})
            )
            db.commit()
            sent[channel] += 1
    return sent


def deliver_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    deliver(db, settings)
