"""Mailversand über einen SMTP-Server, der in der Verwaltung eingetragen ist."""

import smtplib
import ssl
from collections.abc import Callable
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import SMTP_KEY, decrypt_secret, get_setting

SMTP_TIMEOUT_SECONDS = 10
SECURITY_MODES = ("starttls", "tls", "none")


class MailError(Exception):
    """Der Versand ist fehlgeschlagen. Der Text ist für die Anzeige gedacht (ohne Geheimnisse)."""


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    security: str
    username: str | None
    password: str | None
    sender_address: str
    sender_name: str | None


def load_smtp_config(db: Session, settings: Settings) -> SmtpConfig | None:
    """Gespeicherte SMTP-Einstellungen, oder None, wenn noch nichts eingetragen ist."""
    stored: Any = get_setting(db, SMTP_KEY)
    if not isinstance(stored, dict) or not stored.get("host") or not stored.get("sender_address"):
        return None
    token = stored.get("password_encrypted")
    password = decrypt_secret(settings, token) if isinstance(token, str) and token else None
    if token and password is None:
        raise MailError(
            "Das gespeicherte Passwort lässt sich nicht lesen. "
            "Bitte trag es in der Verwaltung neu ein."
        )
    return SmtpConfig(
        host=str(stored["host"]),
        port=int(stored.get("port") or 587),
        security=str(stored.get("security") or "starttls"),
        username=stored.get("username") or None,
        password=password,
        sender_address=str(stored["sender_address"]),
        sender_name=stored.get("sender_name") or None,
    )


def build_message(config: SmtpConfig, recipient: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((config.sender_name or "Werkbank", config.sender_address))
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    return message


def send_mail(config: SmtpConfig, recipient: str, subject: str, body: str) -> None:
    """Sendet eine Textmail. Anmeldung am Server nur über eine verschlüsselte Verbindung."""
    send_message(config, build_message(config, recipient, subject, body))


def send_message(config: SmtpConfig, message: EmailMessage) -> None:
    """Sendet eine fertige Mail. Anmeldung am Server nur über eine verschlüsselte Verbindung."""
    context = ssl.create_default_context()
    try:
        if config.security == "tls":
            server: smtplib.SMTP = smtplib.SMTP_SSL(
                config.host, config.port, timeout=SMTP_TIMEOUT_SECONDS, context=context
            )
        else:
            server = smtplib.SMTP(config.host, config.port, timeout=SMTP_TIMEOUT_SECONDS)
        with server:
            if config.security == "starttls":
                server.starttls(context=context)
            if config.username and config.password and config.security != "none":
                server.login(config.username, config.password)
            server.send_message(message)
    except smtplib.SMTPAuthenticationError as error:
        raise MailError("Der Server hat die Anmeldung abgelehnt.") from error
    except smtplib.SMTPRecipientsRefused as error:
        raise MailError("Der Server hat die Empfängeradresse abgelehnt.") from error
    except smtplib.SMTPSenderRefused as error:
        raise MailError("Der Server hat die Absenderadresse abgelehnt.") from error
    except ssl.SSLError as error:
        raise MailError(
            "Die verschlüsselte Verbindung kam nicht zustande (Zertifikat oder Verfahren)."
        ) from error
    except (smtplib.SMTPException, OSError) as error:
        raise MailError(
            f"Der Server ist nicht erreichbar oder hat abgelehnt ({type(error).__name__})."
        ) from error


MailSender = Callable[[SmtpConfig, str, str, str], None]


def get_mail_sender() -> MailSender:
    """In Tests ersetzbar."""
    return send_mail


MailSenderDep = Annotated[MailSender, Depends(get_mail_sender)]
