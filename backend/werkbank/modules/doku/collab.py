"""Gemeinsames Bearbeiten in Echtzeit (spec.md 8f, Phase D2).

Ein WebSocket je geöffneter Seite (`/api/doku/live/{id}`), Protokoll wie `y-websocket`
(Synchronisation und Anwesenheit). Der Server hält je Seite ein gemeinsames Dokument (pycrdt),
verteilt Änderungen an alle Verbundenen und speichert kurz nach der letzten Änderung:
als Stand des gemeinsamen Dokuments und als geprüftes JSON des Editors (Positivliste wie beim
Speichern über die API). Ist der Inhalt nicht erlaubt, wird nichts gespeichert und alle laden neu.

Rechte: Anmeldung über das Sitzungs-Cookie, Herkunft (Origin) muss die der Werkbank sein. Wer nur
lesen darf (oder die Seite ist gesperrt bzw. der Arbeitsbereich archiviert), bekommt Änderungen,
seine eigenen nimmt der Server nicht an. Ändern sich Rechte oder Sperre, trennt der Server alle
Verbindungen der Seite; die Oberfläche verbindet sich neu und bekommt die neuen Rechte.

Läuft in einem Prozess (uvicorn ohne mehrere Worker); die Räume liegen im Speicher.
"""

import asyncio
import contextlib
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import anyio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pycrdt import (
    Decoder,
    Doc,
    Encoder,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import SESSION_COOKIE, load_session
from werkbank.db import get_sessionmaker
from werkbank.modules.doku.access import can_edit, load_access, visible_page
from werkbank.modules.doku.content import ContentError, clean_content
from werkbank.modules.doku.models import DokuPage
from werkbank.modules.doku.service import load_settings, record_edit
from werkbank.modules.doku.ydoc import doc_from_state, doc_state, doc_to_json, json_to_doc

logger = logging.getLogger(__name__)

router = APIRouter()

# Speichern so lange nach der letzten Änderung
SAVE_DELAY_SECONDS = 2.0
# Größte Nachricht und höchste Zahl gleichzeitiger Verbindungen je Seite
MESSAGE_MAX_BYTES = 2 * 1024 * 1024
PEERS_MAX = 50

# Gründe beim Trennen (die Oberfläche lädt bei 4001 neu, bei 4403 nicht mehr verbinden)
CLOSE_RELOAD = 4001
CLOSE_FORBIDDEN = 4403
CLOSE_TOO_BIG = 4413


@dataclass(eq=False)
class Peer:
    ws: WebSocket
    name: str
    can_write: bool
    # Kennungen der Browser-Fenster dieser Verbindung (Anwesenheit) mit letztem Zähler
    clients: dict[int, int] = field(default_factory=dict)


@dataclass(eq=False)
class Room:
    page_id: uuid.UUID
    space_id: int
    doc: Doc[Any]
    peers: list[Peer] = field(default_factory=list)
    # Anwesenheit aller Verbundenen: Kennung → (Zähler, Zustand als JSON)
    awareness: dict[int, tuple[int, str]] = field(default_factory=dict)
    editors: list[str] = field(default_factory=list)
    dirty: bool = False
    save_task: asyncio.Task[None] | None = None
    closed: bool = False


class Rooms:
    """Alle offenen Seiten dieses Prozesses."""

    def __init__(self) -> None:
        self.rooms: dict[uuid.UUID, Room] = {}
        self.loop: asyncio.AbstractEventLoop | None = None
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    @property
    def lock(self) -> asyncio.Lock:
        """Sperre der laufenden Ereignisschleife (in Tests startet jeder Server eine neue)."""
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
            self.rooms.clear()
        return self._lock


ROOMS = Rooms()


# --- Anwesenheit (Format wie y-protocols/awareness) ---------------------------------------


def parse_awareness(payload: bytes) -> list[tuple[int, int, str]]:
    decoder = Decoder(payload)
    count = decoder.read_var_uint()
    entries = []
    for _ in range(count):
        client = decoder.read_var_uint()
        clock = decoder.read_var_uint()
        state = decoder.read_var_string()
        entries.append((client, clock, state))
    return entries


def encode_awareness(entries: list[tuple[int, int, str]]) -> bytes:
    encoder = Encoder()
    encoder.write_var_uint(len(entries))
    for client, clock, state in entries:
        encoder.write_var_uint(client)
        encoder.write_var_uint(clock)
        encoder.write_var_string(state)
    return encoder.to_bytes()


def _with_name(state: str, name: str) -> str:
    """Der angezeigte Name kommt vom Server, nicht aus dem Browser (kein Vortäuschen)."""
    if state == "null":
        return state
    try:
        data = json.loads(state)
    except ValueError:
        return "null"
    if not isinstance(data, dict):
        return "null"
    raw = data.get("user")
    user: dict[str, Any] = raw if isinstance(raw, dict) else {}
    color = user.get("color")
    color = color if isinstance(color, str) else ""
    data["user"] = {"name": name, "color": color[:20]}
    return json.dumps(data)[:4000]


# --- Laden und Speichern (in einem Thread mit eigener Datenbank-Sitzung) ------------------


@dataclass
class Entry:
    can_write: bool
    name: str


def _check(settings: Settings, cookie: str | None, page_id: uuid.UUID) -> Entry | None:
    with get_sessionmaker()() as db:
        user = load_session(db, settings, cookie)
        if user is None:
            return None
        if not user.has_any_role(Role.DOKU_USER, Role.DOKU_ADMIN):
            return None
        access = load_access(db, user)
        try:
            page, role = visible_page(db, access, page_id)
        except Exception:
            return None
        writable = (
            can_edit(role) and page.locked_at is None and page.space_id not in access.archived
        )
        db.commit()
        return Entry(can_write=writable, name=user.display_name)


def _load(page_id: uuid.UUID) -> tuple[Doc[Any], int] | None:
    with get_sessionmaker()() as db:
        page = db.get(DokuPage, page_id)
        if page is None or page.deleted_at is not None:
            return None
        if page.ystate:
            return doc_from_state(page.ystate), page.space_id
        doc = json_to_doc(page.content)
        page.ystate = doc_state(doc)
        db.commit()
        return doc, page.space_id


def _save(page_id: uuid.UUID, state: bytes, content: dict[str, Any], editors: list[str]) -> bool:
    """Geprüften Inhalt speichern. False: Inhalt nicht erlaubt (nichts gespeichert)."""
    try:
        cleaned, text = clean_content(content)
    except ContentError as exc:
        logger.warning("Doku %s: Inhalt aus der Live-Bearbeitung abgelehnt: %s", page_id, exc)
        return False
    with get_sessionmaker()() as db:
        page = db.get(DokuPage, page_id)
        if page is None or page.deleted_at is not None:
            return True
        page.ystate = state
        if cleaned != page.content:
            page.content = cleaned
            page.text = text
            settings = load_settings(db)
            for name in editors or [""]:
                record_edit(db, page, name, settings)
        db.commit()
    return True


# --- Räume --------------------------------------------------------------------------------


async def _send(peer: Peer, data: bytes) -> None:
    with contextlib.suppress(Exception):
        await peer.ws.send_bytes(data)


async def _broadcast(room: Room, data: bytes, skip: Peer | None = None) -> None:
    for peer in list(room.peers):
        if peer is not skip:
            await _send(peer, data)


async def _persist(room: Room) -> None:
    if not room.dirty:
        return
    room.dirty = False
    editors = list(room.editors)
    room.editors.clear()
    state = doc_state(room.doc)
    content = doc_to_json(room.doc)
    ok = await anyio.to_thread.run_sync(_save, room.page_id, state, content, editors)
    if not ok:
        await _close_room(room, CLOSE_RELOAD, persist=False)


async def _save_later(room: Room) -> None:
    await asyncio.sleep(SAVE_DELAY_SECONDS)
    room.save_task = None
    await _persist(room)


def _schedule_save(room: Room) -> None:
    if room.save_task is None:
        room.save_task = asyncio.create_task(_save_later(room))


async def _close_room(room: Room, code: int, *, persist: bool) -> None:
    async with ROOMS.lock:
        if ROOMS.rooms.get(room.page_id) is room:
            del ROOMS.rooms[room.page_id]
    if room.closed:
        return
    room.closed = True
    if room.save_task is not None:
        room.save_task.cancel()
        room.save_task = None
    if persist:
        await _persist(room)
    for peer in list(room.peers):
        with contextlib.suppress(Exception):
            await peer.ws.close(code)
    room.peers.clear()


async def _room(page_id: uuid.UUID) -> Room | None:
    async with ROOMS.lock:
        room = ROOMS.rooms.get(page_id)
        if room is not None:
            return room
        loaded = await anyio.to_thread.run_sync(_load, page_id)
        if loaded is None:
            return None
        room = Room(page_id=page_id, space_id=loaded[1], doc=loaded[0])
        ROOMS.rooms[page_id] = room
        ROOMS.loop = asyncio.get_running_loop()
        return room


async def _handle(room: Room, peer: Peer, message: bytes) -> None:
    if not message:
        return
    kind = message[0]
    body = message[1:]
    if kind == YMessageType.SYNC and body:
        sync_type = body[0]
        if sync_type == YSyncMessageType.SYNC_STEP1:
            reply = handle_sync_message(body, room.doc)
            if reply is not None:
                await _send(peer, reply)
            return
        if not peer.can_write:
            # Nur lesen: Änderungen aus diesem Browser werden nicht übernommen
            return
        update = read_message(body[1:])
        if update == b"\x00\x00":
            return
        room.doc.apply_update(update)
        await _broadcast(room, create_update_message(update), skip=peer)
        if peer.name not in room.editors:
            room.editors.append(peer.name)
        room.dirty = True
        _schedule_save(room)
    elif kind == YMessageType.AWARENESS and body:
        entries = []
        for client, clock, state in parse_awareness(read_message(body)):
            if len(peer.clients) >= 10 and client not in peer.clients:
                continue
            peer.clients[client] = clock
            safe = _with_name(state, peer.name)
            room.awareness[client] = (clock, safe)
            if safe == "null":
                room.awareness.pop(client, None)
            entries.append((client, clock, safe))
        if entries:
            await _broadcast(room, create_awareness_message(encode_awareness(entries)), skip=peer)


async def _leave(room: Room, peer: Peer) -> None:
    if peer in room.peers:
        room.peers.remove(peer)
    gone = [(client, clock + 1, "null") for client, clock in peer.clients.items()]
    for client, _, _ in gone:
        room.awareness.pop(client, None)
    if gone:
        await _broadcast(room, create_awareness_message(encode_awareness(gone)))
    if not room.peers:
        await _close_room(room, 1000, persist=True)


@router.websocket("/api/doku/live/{page_id}")
async def live(websocket: WebSocket, page_id: uuid.UUID) -> None:
    settings: Settings = websocket.app.state.settings
    origin = websocket.headers.get("origin", "")
    entry = None
    if origin == settings.public_origin:
        entry = await anyio.to_thread.run_sync(
            _check, settings, websocket.cookies.get(SESSION_COOKIE), page_id
        )
    await websocket.accept()
    if entry is None:
        await websocket.close(CLOSE_FORBIDDEN)
        return
    room = await _room(page_id)
    if room is None or len(room.peers) >= PEERS_MAX:
        await websocket.close(CLOSE_FORBIDDEN if room is None else 1013)
        return
    peer = Peer(ws=websocket, name=entry.name, can_write=entry.can_write)
    room.peers.append(peer)
    try:
        await _send(peer, create_sync_message(room.doc))
        if room.awareness:
            await _send(
                peer,
                create_awareness_message(
                    encode_awareness([(c, clock, s) for c, (clock, s) in room.awareness.items()])
                ),
            )
        while True:
            message = await websocket.receive_bytes()
            if len(message) > MESSAGE_MAX_BYTES:
                await websocket.close(CLOSE_TOO_BIG)
                break
            if room.closed:
                break
            try:
                await _handle(room, peer, message)
            except Exception as exc:  # fehlerhafte Nachricht: Verbindung trennen
                # Nur die Art des Fehlers, ohne Zeilenumbrüche: Der Text kann Teile der
                # Nachricht enthalten (Log Injection)
                kind = type(exc).__name__.replace("\r", "").replace("\n", "")
                logger.warning("Doku %s: Nachricht nicht verarbeitet (%s)", str(page_id), kind)
                await websocket.close(1003)
                break
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        # Verbindung schon geschlossen (z. B. durch Zurücksetzen des Raums)
        pass
    finally:
        if not room.closed:
            await _leave(room, peer)


# --- Aufrufe aus der API (laufen in Threads) -----------------------------------------------


def reset_page(page_id: uuid.UUID, *, persist: bool, timeout: float = 10.0) -> None:
    """Alle Verbindungen einer Seite trennen (sie laden neu). `persist`: offene Änderungen
    vorher speichern (z. B. beim Sperren); sonst verwerfen (z. B. beim Wiederherstellen)."""
    loop = ROOMS.loop
    room = ROOMS.rooms.get(page_id)
    if loop is None or room is None or loop.is_closed():
        return
    future = asyncio.run_coroutine_threadsafe(
        _close_room(room, CLOSE_RELOAD, persist=persist), loop
    )
    with contextlib.suppress(Exception):
        future.result(timeout)


def reset_space(space_id: int) -> None:
    """Alle offenen Seiten eines Arbeitsbereichs trennen (Rechte oder Archiv geändert)."""
    for room in list(ROOMS.rooms.values()):
        if room.space_id == space_id:
            reset_page(room.page_id, persist=True)
