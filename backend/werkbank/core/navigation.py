"""Angeheftete und zuletzt besuchte Seiten der Navigation, je Person auf dem Server.

Gespeichert werden nur Pfade aus der Navigation (siehe frontend/src/navigation.ts, ``areasFor``).
Welche Seiten jemand sehen darf, prüft der Server mit derselben Rollenlogik: beim Speichern und
noch einmal beim Ausgeben, damit nach dem Entzug einer Rolle nichts mehr auftaucht.
"""

import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.core.deps import CurrentUserDep, DbDep
from werkbank.core.models import NavEntry
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc

router = APIRouter(prefix="/api/navigation")

PINS_MAX = 20
RECENT_MAX = 10
PATH_MAX = 120

CONFIG = (Role.CONFIG_READER, Role.CONFIG_REVIEWER)
EVERGREEN = (Role.EVERGREEN_READER, Role.EVERGREEN_EDITOR)
BUDGET = (Role.BUDGET_READER, Role.BUDGET_EDITOR, Role.BUDGET_MANAGER)
PROJECTS = (Role.PROJECTS_READER, Role.PROJECTS_EDITOR)
INVENTORY = (Role.INVENTORY_READER, Role.INVENTORY_EDITOR)
EVERYONE: tuple[str, ...] = ()

# Seite → Rollen (eine davon genügt; leer = alle Angemeldeten). Wie areasFor im Frontend.
PAGES: dict[str, tuple[str, ...]] = {
    "/": EVERYONE,
    "/suche": EVERYONE,
    "/m365": CONFIG,
    "/m365/aenderungen": CONFIG,
    "/m365/einstellungen": CONFIG,
    "/m365/empfehlungen": CONFIG,
    "/m365/snapshots": CONFIG,
    "/m365/lizenzen": (Role.TENANT_READER,),
    "/m365/benutzer": (Role.TENANT_READER,),
    "/m365/zugangsdaten": (Role.TENANT_READER,),
    "/m365/dienststatus": (Role.TENANT_READER,),
    "/m365/nutzung": (Role.TENANT_READER,),
    "/m365/geraete/zuordnung": (Role.DEVICES_ASSOCIATION,),
    "/m365/neuerungen": EVERGREEN,
    "/budget": BUDGET,
    "/budget/planung": BUDGET,
    "/budget/statistik": BUDGET,
    "/budget/posten": BUDGET,
    "/budget/rechnungen": BUDGET,
    "/budget/vertraege": BUDGET,
    "/budget/partner": BUDGET,
    "/budget/konten": BUDGET,
    "/budget/import": (Role.BUDGET_MANAGER,),
    "/budget/einstellungen": (Role.BUDGET_MANAGER,),
    "/it-tools": (Role.TOOLS_USER,),
    "/it-tools/verlauf": (Role.TOOLS_USER,),
    "/projekte": PROJECTS,
    "/bestand/vorgaenge": INVENTORY,
    "/bestand/statistik": INVENTORY,
    "/bestand/hardware": INVENTORY,
    "/bestand/stellen": INVENTORY,
    "/bestand/arbeitsplaetze": INVENTORY,
    "/bestand/standorte": INVENTORY,
    "/bestand/verleih": INVENTORY,
    "/bestand/stammdaten": INVENTORY,
    # Admins sehen das Monitoring nur mit Monitoring.Reader (entschieden); die Verbindung zu
    # Zabbix richten sie in der Verwaltung ein.
    "/monitoring/dns": (Role.MONITORING_READER,),
    "/monitoring/zabbix": (Role.MONITORING_READER,),
    "/monitoring/zabbix/hosts": (Role.MONITORING_READER,),
    "/monitoring/zabbix/wartungen": (Role.MONITORING_READER,),
    "/monitoring/zabbix/berichte": (Role.MONITORING_READER, Role.MONITORING_REPORTS),
    "/verwaltung/zabbix": (Role.WERKBANK_ADMIN,),
    # FortiGate: eigene Rechte, unabhängig von Monitoring.Reader; Admins nur mit dem Recht
    "/monitoring/fortigate": (Role.FORTIGATE_READER,),
    "/monitoring/fortigate/policies": (Role.FORTIGATE_READER,),
    "/monitoring/fortigate/objekte": (Role.FORTIGATE_READER,),
    "/monitoring/fortigate/unbenutzt": (Role.FORTIGATE_READER,),
    "/monitoring/fortigate/befunde": (Role.FORTIGATE_READER,),
    "/monitoring/fortigate/pfad": (Role.FORTIGATE_READER,),
    "/monitoring/fortigate/internet": (Role.FORTIGATE_READER,),
    "/monitoring/fortigate/aenderungen": (Role.FORTIGATE_READER,),
    "/verwaltung/fortigate": (Role.WERKBANK_ADMIN,),
    # NetBird: eigenes Recht (Peer-Liste ist personenbezogen), Admins nur mit dem Recht
    "/monitoring/netbird": (Role.NETBIRD_READER,),
    "/monitoring/netbird/peers": (Role.NETBIRD_READER,),
    "/monitoring/netbird/netze": (Role.NETBIRD_READER,),
    "/monitoring/netbird/richtlinien": (Role.NETBIRD_READER,),
    "/verwaltung/netbird": (Role.WERKBANK_ADMIN,),
    "/verwaltung": (Role.WERKBANK_ADMIN,),
    "/verwaltung/berechtigungen": (Role.WERKBANK_ADMIN,),
    "/verwaltung/mail-teams": (Role.WERKBANK_ADMIN,),
    "/verwaltung/verbindungen": (Role.WERKBANK_ADMIN,),
    "/audit": (Role.WERKBANK_ADMIN,),
    # Tickets: Zugriff hängt an den Rollen je Bereich (Datenbank und Graph), nicht an App-Rollen.
    # Die Seiten zeigen ohne Rolle im Bereich nichts; deshalb hier für alle Angemeldeten.
    "/doku": (Role.DOKU_USER, Role.DOKU_ADMIN),
    "/doku/verwaltung": (Role.DOKU_ADMIN,),
    "/tickets": EVERYONE,
    "/tickets/neu": EVERYONE,
    "/tickets/einstellungen": EVERYONE,
    "/tickets/uebersicht": EVERYONE,
}
# Kategorien der IT-Tools (wie frontend/src/tools/index.ts)
TOOL_CATEGORIES = (
    "netzwerk",
    "system",
    "encoding",
    "formatter",
    "identitaet",
    "konverter",
    "text",
    "rechner",
    "planung",
    "zertifikate",
    "generator",
)
PAGES.update({f"/it-tools/kategorie/{c}": (Role.TOOLS_USER,) for c in TOOL_CATEGORIES})


def allowed(user: CurrentUser, path: str) -> bool:
    """Darf die Person diese Seite der Navigation sehen?"""
    roles = PAGES.get(path)
    if roles is None:
        return False
    return not roles or user.has_any_role(*roles)


class PrefsOut(BaseModel):
    pinned: list[str]
    recent: list[str]


class PinsIn(BaseModel):
    paths: list[str] = Field(max_length=PINS_MAX)


class VisitIn(BaseModel):
    path: str = Field(min_length=1, max_length=PATH_MAX)


def _entries(db: Session, user_id: uuid.UUID, kind: Literal["pin", "recent"]) -> list[NavEntry]:
    query = select(NavEntry).where(NavEntry.user_id == user_id, NavEntry.kind == kind)
    if kind == "pin":
        query = query.order_by(NavEntry.position, NavEntry.id)
    else:
        query = query.order_by(NavEntry.used_at.desc(), NavEntry.id.desc())
    return list(db.scalars(query).all())


def prefs(db: Session, user: CurrentUser) -> PrefsOut:
    return PrefsOut(
        pinned=[e.path for e in _entries(db, user.user_id, "pin") if allowed(user, e.path)],
        recent=[e.path for e in _entries(db, user.user_id, "recent") if allowed(user, e.path)],
    )


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


@router.get("")
def read_prefs(user: CurrentUserDep, db: DbDep) -> PrefsOut:
    """Eigene angeheftete und zuletzt besuchte Seiten (nur mit passender Rolle)."""
    return prefs(db, user)


@router.put("/pins")
def save_pins(body: PinsIn, user: CurrentUserDep, db: DbDep) -> PrefsOut:
    """Ersetzt die angehefteten Seiten (Reihenfolge wie übergeben, höchstens 20)."""
    paths = list(dict.fromkeys(body.paths))
    for path in paths:
        if len(path) > PATH_MAX or not allowed(user, path):
            raise _invalid("Diese Seite lässt sich nicht anheften.")
    db.execute(delete(NavEntry).where(NavEntry.user_id == user.user_id, NavEntry.kind == "pin"))
    for position, path in enumerate(paths):
        db.add(NavEntry(user_id=user.user_id, kind="pin", path=path, position=position))
    db.commit()
    return prefs(db, user)


@router.post("/recent")
def visit(body: VisitIn, user: CurrentUserDep, db: DbDep) -> PrefsOut:
    """Merkt eine besuchte Seite; es bleiben die letzten zehn. Fremde Pfade zählen nicht."""
    if not allowed(user, body.path):
        return prefs(db, user)
    existing = db.scalars(
        select(NavEntry).where(
            NavEntry.user_id == user.user_id,
            NavEntry.kind == "recent",
            NavEntry.path == body.path,
        )
    ).first()
    if existing is None:
        db.add(NavEntry(user_id=user.user_id, kind="recent", path=body.path))
    else:
        existing.used_at = now_utc()
    db.flush()
    for old in _entries(db, user.user_id, "recent")[RECENT_MAX:]:
        db.delete(old)
    db.commit()
    return prefs(db, user)


@router.delete("/recent")
def clear_recent(user: CurrentUserDep, db: DbDep) -> PrefsOut:
    """„Zuletzt besucht leeren“."""
    db.execute(delete(NavEntry).where(NavEntry.user_id == user.user_id, NavEntry.kind == "recent"))
    db.commit()
    return prefs(db, user)
