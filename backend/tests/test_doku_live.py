"""Dokumentation (Phase D2): gemeinsames Bearbeiten über WebSocket mit einem echten Server.

Der Browser spricht das Protokoll von y-websocket; hier übernimmt pycrdt die Rolle des Browsers.
"""

import socket
import tempfile
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn
from pycrdt import (
    Doc,
    XmlElement,
    XmlFragment,
    XmlText,
    YMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)
from sqlalchemy import delete
from sqlalchemy.orm import Session
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import ClientConnection, connect

from werkbank.config import Settings
from werkbank.main import create_app
from werkbank.modules.doku.collab import encode_awareness, parse_awareness
from werkbank.modules.doku.models import (
    DokuPage,
    DokuPageRight,
    DokuSpace,
    DokuSpaceMember,
    DokuVersion,
)
from werkbank.modules.doku.ydoc import FIELD, doc_to_json, json_to_doc

pytestmark = pytest.mark.db

KEY_FILE = Path(tempfile.mkdtemp()) / "settings_key"
KEY_FILE.write_text("nur-fuer-tests-" + "x" * 40, encoding="utf-8")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def server() -> Iterator[str]:
    port = _free_port()
    origin = f"http://127.0.0.1:{port}"
    settings = Settings(
        public_url=origin, environment="test", enable_test_login=True, settings_key_file=KEY_FILE
    )
    config = uvicorn.Config(create_app(settings), host="127.0.0.1", port=port, log_level="warning")
    instance = uvicorn.Server(config)
    thread = threading.Thread(target=instance.run, daemon=True)
    thread.start()
    for _ in range(100):
        if instance.started:
            break
        time.sleep(0.05)
    yield origin
    instance.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def db(db_session: Session) -> Session:
    for table in (DokuVersion, DokuPageRight, DokuPage, DokuSpaceMember, DokuSpace):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def login(origin: str, name: str, roles: list[str]) -> httpx.Client:
    client = httpx.Client(base_url=origin, headers={"Origin": origin})
    response = client.post(
        "/auth/test-login",
        json={"oid": name.lower().replace(" ", "-"), "name": name, "roles": roles},
    )
    assert response.status_code == 303, response.text
    # Das Sitzungs-Cookie ist „Secure“; über http schickt httpx es nicht von selbst mit
    pairs = [c.split(";")[0] for c in response.headers.get_list("set-cookie")]
    client.headers["Cookie"] = "; ".join(pairs)
    return client


def oid(name: str) -> str:
    return "test:" + name.lower().replace(" ", "-")


def ws_connect(
    server: str, client: httpx.Client | None, page: str, origin: str | None = None
) -> ClientConnection:
    cookie = client.headers.get("Cookie", "") if client else ""
    headers = {"Origin": origin or server}
    if cookie:
        headers["Cookie"] = cookie
    url = server.replace("http://", "ws://") + f"/api/doku/live/{page}"
    return connect(url, additional_headers=headers, open_timeout=5)


class Peer:
    """Ein „Browser“: verbindet, gleicht ab und nimmt Änderungen auf."""

    def __init__(self, conn: ClientConnection) -> None:
        self.conn = conn
        self.doc: Doc[Any] = Doc()
        self.awareness: list[tuple[int, int, str]] = []
        self.conn.send(create_sync_message(self.doc))

    def pump(self, seconds: float = 0.5) -> None:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                message = self.conn.recv(timeout=0.05)
            except TimeoutError:
                continue
            assert isinstance(message, bytes)
            if message[0] == YMessageType.SYNC:
                reply = handle_sync_message(message[1:], self.doc)
                if reply is not None:
                    self.conn.send(reply)
            elif message[0] == YMessageType.AWARENESS:
                from pycrdt import read_message

                self.awareness.extend(parse_awareness(read_message(message[1:])))

    def json(self) -> dict[str, Any]:
        return doc_to_json(self.doc)

    def add_paragraph(self, text: str, node: str = "paragraph") -> None:
        fragment = self.doc.get(FIELD, type=XmlFragment)
        before = self.doc.get_state()
        element = fragment.children.append(XmlElement(node))
        element.children.append(XmlText(text))
        update = self.doc.get_update(before)
        self.conn.send(create_update_message(update))


def setup_page(origin: str) -> tuple[str, httpx.Client, httpx.Client]:
    admin = login(origin, "Ada Admin", ["Doku.Admin"])
    space = admin.post(
        "/api/doku/admin/spaces",
        json={
            "name": "Live",
            "members": [
                {"oid": oid("Ina Beispiel"), "name": "Ina Beispiel", "role": "edit"},
                {"oid": oid("Lea Leser"), "name": "Lea Leser", "role": "read"},
            ],
        },
    ).json()
    ina = login(origin, "Ina Beispiel", ["Doku.Nutzer"])
    page = ina.post("/api/doku/pages", json={"space_id": space["id"], "title": "Live"}).json()
    content = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Start"}]}],
    }
    saved = ina.put(
        f"/api/doku/pages/{page['id']}",
        json={"title": "Live", "content": content, "revision": page["revision"]},
    )
    assert saved.status_code == 200, saved.text
    lea = login(origin, "Lea Leser", ["Doku.Nutzer"])
    return page["id"], ina, lea


def wait_closed(conn: ClientConnection, seconds: float = 8.0) -> int:
    """Wartet, bis der Server trennt; liefert den Grund (Code)."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            conn.recv(timeout=0.25)
        except TimeoutError:
            continue
        except ConnectionClosed as closed:
            return closed.rcvd.code if closed.rcvd is not None else 0
    raise AssertionError("Server hat nicht getrennt")


def wait_for(check: Any, seconds: float = 6.0) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError("Zustand nicht erreicht")


def test_converter_round_trip() -> None:
    content = {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "T"}]},
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "a"},
                    {"type": "text", "text": "b", "marks": [{"type": "bold"}]},
                ],
            },
        ],
    }
    assert doc_to_json(json_to_doc(content)) == content


def test_live_sync_rights_and_save(server: str, db: Session) -> None:
    page_id, ina, lea = setup_page(server)

    # Ohne passende Herkunft oder ohne Anmeldung: getrennt mit 4403
    for conn in (
        ws_connect(server, ina, page_id, origin="https://example.com"),
        ws_connect(server, None, page_id),
    ):
        with conn:
            assert wait_closed(conn) == 4403

    writer = Peer(ws_connect(server, ina, page_id))
    reader = Peer(ws_connect(server, lea, page_id))
    writer.pump()
    reader.pump()
    assert writer.json()["content"][0]["content"][0]["text"] == "Start"

    # Änderung kommt bei den anderen an
    writer.add_paragraph("Neu von Ina")
    reader.pump(1.0)
    assert [n["content"][0]["text"] for n in reader.json()["content"]] == ["Start", "Neu von Ina"]

    # Wer nur lesen darf: Änderungen werden nicht übernommen
    reader.add_paragraph("Von Lea")
    writer.pump(1.0)
    assert len(writer.json()["content"]) == 2

    # Anwesenheit: Name kommt vom Server
    reader.conn.send(
        create_awareness_message(
            encode_awareness([(77, 1, '{"user": {"name": "Chefin", "color": "#123456"}}')])
        )
    )
    writer.pump(1.0)
    assert any('"name": "Lea Leser"' in state for _, _, state in writer.awareness)

    # Gespeichert nach kurzer Zeit, mit Version für Ina
    def saved() -> bool:
        data = ina.get(f"/api/doku/pages/{page_id}").json()
        return len(data["content"]["content"]) == 2

    wait_for(saved)
    data = ina.get(f"/api/doku/pages/{page_id}").json()
    assert data["updated_by_name"] == "Ina Beispiel"
    assert ina.get("/api/doku/search", params={"q": "Neu von"}).json()[0]["id"] == page_id

    # Sperren trennt alle (4001), danach darf niemand mehr schreiben
    locked = ina.post(f"/api/doku/pages/{page_id}/lock")
    assert locked.status_code == 200
    assert wait_closed(writer.conn) == 4001
    reader.conn.close()
    again = Peer(ws_connect(server, ina, page_id))
    again.pump()
    again.add_paragraph("Trotz Sperre")
    again.pump(0.5)
    again.conn.close()
    time.sleep(2.5)
    assert len(ina.get(f"/api/doku/pages/{page_id}").json()["content"]["content"]) == 2


def test_live_rejects_unknown_blocks(server: str, db: Session) -> None:
    page_id, ina, _ = setup_page(server)
    writer = Peer(ws_connect(server, ina, page_id))
    writer.pump()
    writer.add_paragraph("böse", node="script")
    assert wait_closed(writer.conn) == 4001
    content = ina.get(f"/api/doku/pages/{page_id}").json()["content"]
    assert [n["type"] for n in content["content"]] == ["paragraph"]


def test_restore_resets_live_document(server: str, db: Session) -> None:
    page_id, ina, _ = setup_page(server)
    version = ina.post(f"/api/doku/pages/{page_id}/versions", json={"name": "Stand"}).json()
    writer = Peer(ws_connect(server, ina, page_id))
    writer.pump()
    writer.add_paragraph("später")
    writer.pump(0.3)
    restored = ina.post(f"/api/doku/pages/{page_id}/versions/{version['id']}/restore", json={})
    assert restored.status_code == 200
    assert wait_closed(writer.conn) == 4001
    # Neu verbunden: der wiederhergestellte Stand
    fresh = Peer(ws_connect(server, ina, page_id))
    fresh.pump()
    assert [n["content"][0]["text"] for n in fresh.json()["content"]] == ["Start"]
    fresh.conn.close()
    versions = ina.get(f"/api/doku/pages/{page_id}/versions").json()
    # Der Stand mit „später“ wurde vor dem Wiederherstellen gesichert
    assert any(v["note"] == "Stand vor dem Wiederherstellen" for v in versions)
