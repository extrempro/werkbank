"""Zugriff auf die Postfächer der Bereiche über Microsoft Graph (App „Werkbank Tickets“).

Anwendungsberechtigungen `Mail.ReadWrite` und `Mail.Send`, in Exchange Online per RBAC für
Anwendungen auf die Ticket-Postfächer beschränkt (docs/entra-setup.md). Anmeldung nur per
Zertifikat. In der Testumgebung ersetzt `TestMailbox` Graph: Mails kommen über den Test-Endpunkt
herein, gesendete Mails stehen nur im Ausgang (`ticket_mail_out`).
"""

import base64
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from werkbank.config import Settings
from werkbank.core.credentials import certificate_credential
from werkbank.modules.m365_config.utcm import GRAPH_SCOPE, GRAPH_URL, UtcmClient, UtcmError

HTTP_TIMEOUT_SECONDS = 60
# Größte Mail, die die Werkbank abholt (MIME, mit Anhängen)
MAX_MIME_BYTES = 40 * 1024 * 1024
INBOX_BATCH = 25
FOLDER_PROCESSED = "Verarbeitet"
FOLDER_IGNORED = "Ignoriert"
_MAILBOX = re.compile(r"^[^@\s/?#]{1,64}@[A-Za-z0-9.-]{1,253}$")


class MailboxError(RuntimeError):
    """Postfach nicht erreichbar oder nicht eingerichtet."""


@dataclass(frozen=True)
class InboxItem:
    graph_id: str
    received_at: datetime | None


class Mailbox(Protocol):
    """Was die Werkbank mit einem Postfach tut."""

    def inbox(self, mailbox: str) -> list[InboxItem]: ...

    def mime(self, mailbox: str, graph_id: str) -> bytes: ...

    def move(self, mailbox: str, graph_id: str, folder: str) -> None: ...

    def purge(self, mailbox: str, folder: str, before: datetime) -> int: ...

    def send(self, mailbox: str, mime: bytes) -> None: ...


def check_mailbox(address: str) -> str:
    if not _MAILBOX.match(address):
        raise MailboxError("Ungültige Adresse eines Postfachs.")
    return quote(address.lower(), safe="@.")


class GraphMailbox(UtcmClient):
    """Postfächer über Microsoft Graph."""

    def __init__(self, http: httpx.Client, token: Callable[[], str]) -> None:
        super().__init__(http, token)
        self._folders: dict[tuple[str, str], str] = {}

    def _base(self, mailbox: str) -> str:
        return f"{GRAPH_URL}/users/{check_mailbox(mailbox)}"

    def _call(self, fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except UtcmError as exc:
            raise MailboxError(str(exc)) from exc

    def inbox(self, mailbox: str) -> list[InboxItem]:
        def run() -> list[InboxItem]:
            data = self._json(
                "GET",
                f"{self._base(mailbox)}/mailFolders/inbox/messages",
                params={
                    "$select": "id,receivedDateTime",
                    "$orderby": "receivedDateTime",
                    "$top": str(INBOX_BATCH),
                },
            )
            items = []
            for item in data.get("value") or []:
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    received = item.get("receivedDateTime")
                    at = (
                        datetime.fromisoformat(received.replace("Z", "+00:00"))
                        if isinstance(received, str)
                        else None
                    )
                    items.append(InboxItem(graph_id=item["id"], received_at=at))
            return items

        result: list[InboxItem] = self._call(run)
        return result

    def mime(self, mailbox: str, graph_id: str) -> bytes:
        def run() -> bytes:
            response = self._request(
                "GET", f"{self._base(mailbox)}/messages/{quote(graph_id, safe='')}/$value"
            )
            if len(response.content) > MAX_MIME_BYTES:
                raise MailboxError("Die Mail ist zu groß.")
            return response.content

        result: bytes = self._call(run)
        return result

    def _folder(self, mailbox: str, name: str) -> str:
        key = (mailbox.lower(), name)
        if key in self._folders:
            return self._folders[key]

        def run() -> str:
            base = self._base(mailbox)
            data = self._json(
                "GET",
                f"{base}/mailFolders",
                params={"$filter": f"displayName eq '{name}'", "$select": "id"},
            )
            found = [i for i in data.get("value") or [] if isinstance(i, dict) and i.get("id")]
            if found:
                return str(found[0]["id"])
            created = self._json("POST", f"{base}/mailFolders", json={"displayName": name})
            return str(created["id"])

        folder_id: str = self._call(run)
        self._folders[key] = folder_id
        return folder_id

    def move(self, mailbox: str, graph_id: str, folder: str) -> None:
        folder_id = self._folder(mailbox, folder)
        self._call(
            lambda: self._json(
                "POST",
                f"{self._base(mailbox)}/messages/{quote(graph_id, safe='')}/move",
                json={"destinationId": folder_id},
            )
        )

    def purge(self, mailbox: str, folder: str, before: datetime) -> int:
        """Mails im Ordner, die vor `before` eingegangen sind, endgültig löschen."""
        folder_id = self._folder(mailbox, folder)
        stamp = before.strftime("%Y-%m-%dT%H:%M:%SZ")

        def run() -> int:
            base = self._base(mailbox)
            data = self._json(
                "GET",
                f"{base}/mailFolders/{quote(folder_id, safe='')}/messages",
                params={"$filter": f"receivedDateTime lt {stamp}", "$select": "id", "$top": "50"},
            )
            count = 0
            for item in data.get("value") or []:
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    self._request(
                        "POST", f"{base}/messages/{quote(item['id'], safe='')}/permanentDelete"
                    )
                    count += 1
            return count

        result: int = self._call(run)
        return result

    def send(self, mailbox: str, mime: bytes) -> None:
        """Mail als MIME senden (eigene Message-ID, In-Reply-To und References bleiben).

        `mime` muss CRLF-Zeilenenden haben (siehe `mime_bytes`), sonst zeigt Exchange
        quoted-printable-Text roh an („dies=r Zeile“).
        """
        self._call(
            lambda: self._request(
                "POST",
                f"{self._base(mailbox)}/sendMail",
                content=base64.b64encode(mime),
                headers={"Content-Type": "text/plain"},
            )
        )


class TestMailbox:
    """Testumgebung: kein Graph. Eingang leer; Senden tut nichts (Ausgang steht in der DB)."""

    def inbox(self, mailbox: str) -> list[InboxItem]:
        return []

    def mime(self, mailbox: str, graph_id: str) -> bytes:
        raise MailboxError("Testumgebung: keine Mails abrufbar.")

    def move(self, mailbox: str, graph_id: str, folder: str) -> None:
        return None

    def purge(self, mailbox: str, folder: str, before: datetime) -> int:
        return 0

    def send(self, mailbox: str, mime: bytes) -> None:
        return None


def mail_token_provider(settings: Settings) -> Callable[[], str]:
    import msal

    app = msal.ConfidentialClientApplication(
        client_id=settings.tickets_mail_client_id,
        client_credential=certificate_credential(
            settings.tickets_mail_client_key_file, settings.tickets_mail_client_cert_file
        ),
        authority=f"https://login.microsoftonline.com/{settings.entra_tenant_id}",
    )

    def token() -> str:
        result = app.acquire_token_for_client(scopes=[GRAPH_SCOPE])
        value = result.get("access_token") if isinstance(result, dict) else None
        if not isinstance(value, str):
            error = result.get("error") if isinstance(result, dict) else None
            raise UtcmError(f"Anmeldung für die Postfächer fehlgeschlagen: {error or 'unbekannt'}")
        return value

    return token


_TOKENS: dict[int, Callable[[], str]] = {}


def is_test(settings: Settings) -> bool:
    return settings.enable_test_login and settings.environment in ("test", "development")


def available(settings: Settings) -> bool:
    return is_test(settings) or settings.tickets_mail_configured


def open_mailbox(settings: Settings, http: httpx.Client) -> Mailbox:
    """Graph oder (Testumgebung) TestMailbox. MailboxError, wenn nicht eingerichtet."""
    if is_test(settings):
        return TestMailbox()
    if not settings.tickets_mail_configured:
        raise MailboxError("Die Postfächer der Tickets sind nicht eingerichtet.")
    token = _TOKENS.get(id(settings))
    if token is None:
        try:
            token = _TOKENS.setdefault(id(settings), mail_token_provider(settings))
        except (OSError, ValueError) as exc:
            raise MailboxError("Das Zertifikat für die Postfächer ist nicht lesbar.") from exc
    return GraphMailbox(http, token)


def new_http() -> httpx.Client:
    return httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False)


def mime_bytes(message: EmailMessage) -> bytes:
    """MIME für Graph `sendMail`: Zeilenenden CRLF wie im Mailstandard (RFC 5322).

    `EmailMessage.as_bytes()` nutzt sonst nur LF; Exchange dekodiert dann quoted-printable
    nicht (Umlaute, weiche Zeilenumbrüche) und das Logo fehlt.
    """
    return message.as_bytes(policy=message.policy.clone(linesep="\r\n"))
