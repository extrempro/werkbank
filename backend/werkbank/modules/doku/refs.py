"""Verweise auf Objekte der Werkbank und Live-Bausteine in der Dokumentation (spec.md 8f, D3).

Im Inhalt einer Seite stehen nur Art und Kennung eines Objekts (Baustein `werkbankRef`) bzw. die
Einstellungen eines Live-Bausteins (`liveBlock`), nie Titel oder Stand. Beides holt die Seite
beim Anzeigen vom Server, mit den Rechten der Person, die die Seite gerade liest. Ohne Rechte im
jeweiligen Bereich gibt es nur „kein Zugriff“, keine Angaben zum Objekt.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import cast, func, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONB, JSONPATH
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.doku.content import LIVE_KINDS, REF_KINDS

# Kennung eines Verweises immer als Ziffernfolge (Ticket über seine Nummer)
LIVE_MONTHS = (3, 6, 12)
# Trenner in Pfaden („Standort > Etage > Raum“ mit einfachem Winkel)
SEP = " \u203a "
__all__ = ["LIVE_KINDS", "REF_KINDS"]
LIVE_ROWS = 15
SEARCH_HITS = 8

KIND_LABELS = {
    "ticket": "Ticket",
    "hardware": "Gerät",
    "stelle": "Stelle",
    "arbeitsplatz": "Arbeitsplatz",
    "raum": "Raum",
    "projekt": "IT-Projekt",
    "vertrag": "Vertrag",
}

TICKET_STATUS = {
    "new": "Neu",
    "in_progress": "In Bearbeitung",
    "waiting": "Wartet",
    "reminder": "Erinnerung",
    "solved": "Gelöst",
    "closed": "Geschlossen",
    "merged": "Zusammengeführt",
}
PROJECT_STATUS = {
    "geplant": "geplant",
    "aktiv": "aktiv",
    "pausiert": "pausiert",
    "abgeschlossen": "abgeschlossen",
}

INVENTORY_ROLES = (Role.INVENTORY_READER, Role.INVENTORY_EDITOR)
PROJECT_ROLES = (Role.PROJECTS_READER, Role.PROJECTS_EDITOR)
BUDGET_ROLES = (Role.BUDGET_READER, Role.BUDGET_EDITOR, Role.BUDGET_MANAGER)


def _pairs(rows: Any) -> dict[Any, Any]:
    """Zeilen aus zwei Spalten als Wörterbuch (dict() hielte das Ergebnis für eine Abbildung)."""
    return {key: value for key, value in rows}


def valid_ref_id(value: object) -> bool:
    return isinstance(value, str) and value.isdigit() and 0 < len(value) <= 12


@dataclass
class Rights:
    """Was die lesende Person in den anderen Bereichen sehen darf."""

    user: CurrentUser
    oid: str
    db: Session
    settings: Settings
    _ticket_areas: set[int] | None = None

    @property
    def inventory(self) -> bool:
        return self.user.has_any_role(*INVENTORY_ROLES)

    @property
    def projects(self) -> bool:
        return self.user.has_any_role(*PROJECT_ROLES)

    @property
    def budget(self) -> bool:
        return self.user.has_any_role(*BUDGET_ROLES)

    @property
    def ticket_areas(self) -> set[int]:
        """Ticket-Bereiche mit Leserecht (erst bei Bedarf über die Gruppen ermittelt)."""
        if self._ticket_areas is None:
            from werkbank.modules.tickets.access import area_roles, group_source

            self._ticket_areas = (
                set(
                    area_roles(
                        self.db, self.settings, group_source(self.db, self.settings), self.oid
                    )
                )
                if self.oid
                else set()
            )
        return self._ticket_areas

    def allowed(self, kind: str) -> bool:
        if kind == "ticket" or kind == "tickets":
            return bool(self.ticket_areas)
        if kind in ("hardware", "stelle", "arbeitsplatz", "raum", "geraete"):
            return self.inventory
        if kind == "projekt":
            return self.projects
        if kind in ("vertrag", "vertraege"):
            return self.budget
        return False


@dataclass
class RefOut:
    kind: str
    id: str
    allowed: bool
    found: bool = False
    title: str = ""
    status: str = ""
    detail: str = ""
    href: str = ""

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


# --- Standorte -----------------------------------------------------------------------------


def room_paths(db: Session, room_ids: set[int]) -> dict[int, tuple[str, int]]:
    """Raum → (Pfad aus Standort, Abschnitt, Etage und Raum; Etage) für die Anzeige."""
    from werkbank.modules.inventory.models import (
        InventoryFloor,
        InventoryRoom,
        InventorySection,
        InventorySite,
    )

    if not room_ids:
        return {}
    rows = db.execute(
        select(
            InventoryRoom.id,
            InventoryRoom.name,
            InventoryFloor.id,
            InventoryFloor.name,
            InventorySection.name,
            InventorySite.name,
        )
        .join(InventoryFloor, InventoryFloor.id == InventoryRoom.floor_id)
        .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
        .join(InventorySite, InventorySite.id == InventorySection.site_id)
        .where(InventoryRoom.id.in_(room_ids))
    ).all()
    return {
        room_id: (SEP.join((site, section, floor, room)), floor_id)
        for room_id, room, floor_id, floor, section, site in rows
    }


# --- Einzelne Verweise ---------------------------------------------------------------------


def _resolve_ticket(rights: Rights, ids: list[int]) -> dict[str, RefOut]:
    from werkbank.modules.tickets.models import Ticket

    rows = rights.db.scalars(select(Ticket).where(Ticket.number.in_(ids))).all()
    result: dict[str, RefOut] = {}
    for t in rows:
        if t.area_id not in rights.ticket_areas:
            continue
        result[str(t.number)] = RefOut(
            "ticket",
            str(t.number),
            True,
            True,
            f"T-{t.number} · {t.subject}",
            TICKET_STATUS.get(t.status, t.status),
            t.assignee_name or "niemand zuständig",
            f"/tickets/{t.number}",
        )
    return result


def _resolve_hardware(rights: Rights, ids: list[int]) -> dict[str, RefOut]:
    from werkbank.modules.inventory.models import InventoryHardware, InventoryWorkplace

    rows = rights.db.scalars(select(InventoryHardware).where(InventoryHardware.id.in_(ids))).all()
    workplace_rooms = _pairs(
        rights.db.execute(
            select(InventoryWorkplace.id, InventoryWorkplace.room_id).where(
                InventoryWorkplace.id.in_({h.workplace_id for h in rows if h.workplace_id})
            )
        ).tuples()
    )
    rooms = {h.id: h.room_id or workplace_rooms.get(h.workplace_id or 0) for h in rows}
    paths = room_paths(rights.db, {r for r in rooms.values() if r})
    result: dict[str, RefOut] = {}
    for h in rows:
        room = rooms.get(h.id)
        label = h.inventory_no or h.hostname or f"#{h.id}"
        result[str(h.id)] = RefOut(
            "hardware",
            str(h.id),
            True,
            True,
            f"{label} · {h.name}",
            "in Betrieb" if h.status == "aktiv" else "ausgemustert",
            paths[room][0] if room and room in paths else "ohne Standort",
            f"/bestand/hardware/{h.id}",
        )
    return result


def _resolve_position(rights: Rights, ids: list[int]) -> dict[str, RefOut]:
    from werkbank.modules.inventory.models import InventoryPosition

    rows = rights.db.scalars(select(InventoryPosition).where(InventoryPosition.id.in_(ids))).all()
    return {
        str(p.id): RefOut(
            "stelle",
            str(p.id),
            True,
            True,
            f"{p.number} · {p.name}",
            "besetzt" if p.person_oid else "frei",
            p.person_name or "",
            f"/bestand/stellen/{p.id}",
        )
        for p in rows
    }


def _resolve_workplace(rights: Rights, ids: list[int]) -> dict[str, RefOut]:
    from werkbank.modules.inventory.models import InventoryWorkplace

    rows = rights.db.scalars(select(InventoryWorkplace).where(InventoryWorkplace.id.in_(ids))).all()
    paths = room_paths(rights.db, {w.room_id for w in rows if w.room_id})
    return {
        str(w.id): RefOut(
            "arbeitsplatz",
            str(w.id),
            True,
            True,
            f"Arbeitsplatz {w.number}",
            "Pool" if w.pool else ("geteilt" if w.shared else "einzeln"),
            paths[w.room_id][0] if w.room_id and w.room_id in paths else "ohne Raum",
            f"/bestand/arbeitsplaetze/{w.id}",
        )
        for w in rows
    }


def _resolve_room(rights: Rights, ids: list[int]) -> dict[str, RefOut]:
    paths = room_paths(rights.db, set(ids))
    return {
        str(room_id): RefOut(
            "raum",
            str(room_id),
            True,
            True,
            path.split(SEP)[-1],
            "",
            path,
            f"/bestand/standorte/etage/{floor_id}/raum/{room_id}",
        )
        for room_id, (path, floor_id) in paths.items()
    }


def _project_state(db: Session, project_ids: list[int]) -> dict[int, tuple[int, int, date | None]]:
    """Projekt → (erledigte Aufgaben, alle Aufgaben, nächster Jour Fixe)."""
    from werkbank.modules.projects.models import ProjectMeeting, ProjectTask

    tasks: dict[int, tuple[int, int]] = {}
    for project_id, done, count in db.execute(
        select(ProjectTask.project_id, ProjectTask.done, func.count())
        .where(ProjectTask.project_id.in_(project_ids))
        .group_by(ProjectTask.project_id, ProjectTask.done)
    ):
        finished, total = tasks.get(project_id, (0, 0))
        tasks[project_id] = (finished + (count if done else 0), total + count)
    today = now_utc().date()
    meetings = _pairs(
        db.execute(
            select(ProjectMeeting.project_id, func.min(ProjectMeeting.held_on))
            .where(ProjectMeeting.project_id.in_(project_ids), ProjectMeeting.held_on >= today)
            .group_by(ProjectMeeting.project_id)
        ).tuples()
    )
    return {pid: (*tasks.get(pid, (0, 0)), meetings.get(pid)) for pid in project_ids}


def _resolve_project(rights: Rights, ids: list[int]) -> dict[str, RefOut]:
    from werkbank.modules.projects.models import Project

    rows = rights.db.scalars(select(Project).where(Project.id.in_(ids))).all()
    state = _project_state(rights.db, [p.id for p in rows])
    result: dict[str, RefOut] = {}
    for p in rows:
        done, total, _ = state[p.id]
        result[str(p.id)] = RefOut(
            "projekt",
            str(p.id),
            True,
            True,
            p.name,
            PROJECT_STATUS.get(p.status, p.status),
            f"{done} von {total} Aufgaben erledigt" if total else "keine Aufgaben",
            f"/projekte/{p.id}",
        )
    return result


def _contract_deadline_text(deadline: date | None, cancelled_to: date | None) -> str:
    if cancelled_to is not None:
        return f"gekündigt zum {cancelled_to:%d.%m.%Y}"
    if deadline is None:
        return "ohne Kündigungsfrist"
    return f"Kündigung bis {deadline:%d.%m.%Y}"


def _resolve_contract(rights: Rights, ids: list[int]) -> dict[str, RefOut]:
    from werkbank.modules.budget.contracts import notice_deadline
    from werkbank.modules.budget.models import BudgetContract, BudgetPartner

    rows = rights.db.execute(
        select(BudgetContract, BudgetPartner.name)
        .join(BudgetPartner, BudgetPartner.id == BudgetContract.partner_id)
        .where(BudgetContract.id.in_(ids))
    ).all()
    today = now_utc().date()
    return {
        str(c.id): RefOut(
            "vertrag",
            str(c.id),
            True,
            True,
            c.title,
            _contract_deadline_text(notice_deadline(c, today), c.cancelled_to),
            partner,
            f"/budget/vertraege/{c.id}",
        )
        for c, partner in rows
    }


RESOLVERS: dict[str, Callable[[Rights, list[int]], dict[str, RefOut]]] = {
    "ticket": _resolve_ticket,
    "hardware": _resolve_hardware,
    "stelle": _resolve_position,
    "arbeitsplatz": _resolve_workplace,
    "raum": _resolve_room,
    "projekt": _resolve_project,
    "vertrag": _resolve_contract,
}


def resolve(rights: Rights, refs: list[tuple[str, str]]) -> list[RefOut]:
    """Verweise mit Stand, je nach Rechten der Person. Reihenfolge wie angefragt."""
    by_kind: dict[str, set[int]] = {}
    for kind, ref_id in refs:
        if kind in RESOLVERS and valid_ref_id(ref_id):
            by_kind.setdefault(kind, set()).add(int(ref_id))
    found: dict[tuple[str, str], RefOut] = {}
    for kind, ids in by_kind.items():
        if not rights.allowed(kind):
            continue
        for ref_id, out in RESOLVERS[kind](rights, sorted(ids)).items():
            found[(kind, ref_id)] = out
    result = []
    for kind, ref_id in refs:
        hit = found.get((kind, ref_id))
        if hit is not None:
            result.append(hit)
        else:
            # Ohne Recht: nichts über das Objekt verraten, auch nicht, ob es existiert
            allowed = kind in RESOLVERS and rights.allowed(kind)
            result.append(RefOut(kind, ref_id, allowed, False))
    return result


# --- Suche beim Einfügen -------------------------------------------------------------------


def _like(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search(rights: Rights, kind: str, query: str) -> list[RefOut]:
    """Kandidaten für einen Verweis (nur mit Rechten im Bereich)."""
    from werkbank.modules.budget.models import BudgetContract
    from werkbank.modules.inventory.models import (
        InventoryHardware,
        InventoryPosition,
        InventoryRoom,
        InventoryWorkplace,
    )
    from werkbank.modules.projects.models import Project
    from werkbank.modules.tickets.models import Ticket

    query = " ".join(query.split())[:60]
    if not query or kind not in RESOLVERS or not rights.allowed(kind):
        return []
    like = _like(query)
    digits = query.removeprefix("T-").removeprefix("t-")
    db = rights.db
    ids: list[int]
    if kind == "ticket":
        stmt = select(Ticket.number).where(Ticket.area_id.in_(rights.ticket_areas))
        cond: Any = Ticket.subject.ilike(like)
        if digits.isdigit():
            cond = or_(cond, Ticket.number == int(digits))
        ids = list(db.scalars(stmt.where(cond).order_by(Ticket.number.desc()).limit(SEARCH_HITS)))
    elif kind == "hardware":
        ids = list(
            db.scalars(
                select(InventoryHardware.id)
                .where(
                    or_(
                        InventoryHardware.name.ilike(like),
                        InventoryHardware.inventory_no.ilike(like),
                        InventoryHardware.hostname.ilike(like),
                        InventoryHardware.serial.ilike(like),
                    )
                )
                .order_by(InventoryHardware.status, InventoryHardware.name)
                .limit(SEARCH_HITS)
            )
        )
    elif kind == "stelle":
        ids = list(
            db.scalars(
                select(InventoryPosition.id)
                .where(
                    or_(
                        InventoryPosition.number.ilike(like),
                        InventoryPosition.name.ilike(like),
                        InventoryPosition.person_name.ilike(like),
                    )
                )
                .order_by(InventoryPosition.number)
                .limit(SEARCH_HITS)
            )
        )
    elif kind == "arbeitsplatz":
        ids = list(
            db.scalars(
                select(InventoryWorkplace.id)
                .where(InventoryWorkplace.number.ilike(like))
                .order_by(InventoryWorkplace.number)
                .limit(SEARCH_HITS)
            )
        )
    elif kind == "raum":
        ids = list(
            db.scalars(
                select(InventoryRoom.id)
                .where(InventoryRoom.name.ilike(like))
                .order_by(InventoryRoom.name)
                .limit(SEARCH_HITS)
            )
        )
    elif kind == "projekt":
        ids = list(
            db.scalars(
                select(Project.id)
                .where(Project.name.ilike(like))
                .order_by(Project.name)
                .limit(SEARCH_HITS)
            )
        )
    else:
        ids = list(
            db.scalars(
                select(BudgetContract.id)
                .where(or_(BudgetContract.title.ilike(like), BudgetContract.number.ilike(like)))
                .order_by(BudgetContract.title)
                .limit(SEARCH_HITS)
            )
        )
    return resolve(rights, [(kind, str(i)) for i in ids])


# --- Live-Bausteine ------------------------------------------------------------------------


@dataclass
class LiveOut:
    kind: str
    allowed: bool
    title: str = ""
    rows: list[dict[str, Any]] | None = None
    project: dict[str, Any] | None = None
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def live_data(rights: Rights, attrs: dict[str, Any]) -> LiveOut:
    """Daten eines Live-Bausteins mit den Rechten der lesenden Person."""
    kind = str(attrs.get("kind") or "")
    if kind not in LIVE_KINDS:
        return LiveOut(kind, False, note="Unbekannter Baustein.")
    if not rights.allowed(kind):
        return LiveOut(kind, False)
    if kind == "tickets":
        return _live_tickets(rights, attrs)
    if kind == "geraete":
        return _live_devices(rights, attrs)
    if kind == "projekt":
        return _live_project(rights, attrs)
    return _live_contracts(rights, attrs)


def _live_tickets(rights: Rights, attrs: dict[str, Any]) -> LiveOut:
    from werkbank.modules.tickets.models import OPEN_STATUSES, Ticket, TicketArea

    areas = rights.ticket_areas
    area = _int_or_none(attrs.get("area"))
    if area is not None:
        areas = areas & {area}
    stmt = select(Ticket).where(Ticket.area_id.in_(areas))
    if attrs.get("status") != "alle":
        stmt = stmt.where(Ticket.status.in_(OPEN_STATUSES))
    query = str(attrs.get("q") or "").strip()[:60]
    if query:
        stmt = stmt.where(Ticket.subject.ilike(_like(query)))
    rows = rights.db.scalars(stmt.order_by(Ticket.updated_at.desc()).limit(LIVE_ROWS)).all()
    names = _pairs(rights.db.execute(select(TicketArea.id, TicketArea.name)).tuples())
    parts = [names.get(area, "Bereich") if area else "alle deine Bereiche"]
    parts.append("alle Status" if attrs.get("status") == "alle" else "offen")
    if query:
        parts.append(f"Stichwort „{query}“")
    return LiveOut(
        "tickets",
        True,
        " · ".join(parts),
        [
            {
                "number": f"T-{t.number}",
                "title": t.subject,
                "status": TICKET_STATUS.get(t.status, t.status),
                "who": t.assignee_name,
                "href": f"/tickets/{t.number}",
            }
            for t in rows
        ],
    )


def _room_name(paths: dict[int, tuple[str, int]], room: int | None) -> str:
    return paths[room][0].split(SEP)[-1] if room and room in paths else "ohne Standort"


def _live_devices(rights: Rights, attrs: dict[str, Any]) -> LiveOut:
    from werkbank.modules.inventory.models import (
        InventoryHardware,
        InventoryKind,
        InventoryRoom,
        InventoryWorkplace,
    )

    db = rights.db
    room = _int_or_none(attrs.get("room"))
    floor = _int_or_none(attrs.get("floor"))
    hw_kind = _int_or_none(attrs.get("hwkind"))
    rooms: set[int] | None = None
    if room is not None:
        rooms = {room}
    elif floor is not None:
        rooms = set(db.scalars(select(InventoryRoom.id).where(InventoryRoom.floor_id == floor)))
    stmt = (
        select(InventoryHardware, InventoryKind.name, InventoryWorkplace.room_id)
        .join(InventoryKind, InventoryKind.id == InventoryHardware.kind_id)
        .outerjoin(InventoryWorkplace, InventoryWorkplace.id == InventoryHardware.workplace_id)
        .where(InventoryHardware.status == "aktiv")
    )
    if rooms is not None:
        stmt = stmt.where(
            or_(InventoryHardware.room_id.in_(rooms), InventoryWorkplace.room_id.in_(rooms))
        )
    if hw_kind is not None:
        stmt = stmt.where(InventoryHardware.kind_id == hw_kind)
    rows = db.execute(stmt.order_by(InventoryHardware.name).limit(LIVE_ROWS)).all()
    paths = room_paths(db, {r for h, _, w in rows for r in (h.room_id, w) if r})
    title_parts: list[str] = []
    if room is not None and room in paths:
        title_parts.append(paths[room][0])
    elif floor is not None:
        floor_path = next((p for p, f in paths.values() if f == floor), "")
        title_parts.append(floor_path.rsplit(SEP, 1)[0] if floor_path else "eine Etage")
    if hw_kind is not None:
        kind_name = db.scalar(select(InventoryKind.name).where(InventoryKind.id == hw_kind))
        title_parts.append(kind_name or "eine Art")
    return LiveOut(
        "geraete",
        True,
        " · ".join(title_parts) or "alle Geräte",
        [
            {
                "number": h.inventory_no or h.hostname or f"#{h.id}",
                "title": h.name,
                "status": kind_name,
                "who": _room_name(paths, h.room_id or w),
                "href": f"/bestand/hardware/{h.id}",
            }
            for h, kind_name, w in rows
        ],
    )


def _live_project(rights: Rights, attrs: dict[str, Any]) -> LiveOut:
    from werkbank.modules.projects.models import Project, ProjectTask

    project_id = _int_or_none(attrs.get("project"))
    project = rights.db.get(Project, project_id) if project_id else None
    if project is None:
        return LiveOut("projekt", True, note="Kein Projekt gewählt oder das Projekt gibt es nicht.")
    done, total, meeting = _project_state(rights.db, [project.id])[project.id]
    open_tasks = rights.db.scalars(
        select(ProjectTask)
        .where(ProjectTask.project_id == project.id, ProjectTask.done.is_(False))
        .order_by(ProjectTask.due_on.is_(None), ProjectTask.due_on, ProjectTask.id)
        .limit(5)
    ).all()
    return LiveOut(
        "projekt",
        True,
        project.name,
        project={
            "status": PROJECT_STATUS.get(project.status, project.status),
            "done": done,
            "total": total,
            "meeting": meeting.isoformat() if meeting else None,
            "href": f"/projekte/{project.id}",
            "tasks": [
                {"text": t.text, "due": t.due_on.isoformat() if t.due_on else None}
                for t in open_tasks
            ],
        },
    )


def _live_contracts(rights: Rights, attrs: dict[str, Any]) -> LiveOut:
    from werkbank.modules.budget.contracts import notice_deadline
    from werkbank.modules.budget.models import BudgetContract, BudgetPartner

    months = int(attrs["months"]) if attrs.get("months") in LIVE_MONTHS else 6
    today = now_utc().date()
    until = today + timedelta(days=31 * int(months))
    rows = []
    for contract, partner in rights.db.execute(
        select(BudgetContract, BudgetPartner.name).join(
            BudgetPartner, BudgetPartner.id == BudgetContract.partner_id
        )
    ):
        deadline = notice_deadline(contract, today)
        if deadline is not None and today <= deadline <= until:
            rows.append((deadline, contract, partner))
    rows.sort(key=lambda item: item[0])
    return LiveOut(
        "vertraege",
        True,
        f"Kündigungstermine der nächsten {months} Monate",
        [
            {
                "number": f"{deadline:%d.%m.%Y}",
                "title": contract.title,
                "status": f"in {(deadline - today).days} Tagen",
                "who": partner,
                "href": f"/budget/vertraege/{contract.id}",
            }
            for deadline, contract, partner in rows[:LIVE_ROWS]
        ],
    )


def live_options(rights: Rights) -> dict[str, Any]:
    """Auswahl für die Einstellungen der Live-Bausteine, je nach Rechten."""
    from werkbank.modules.inventory.models import (
        InventoryFloor,
        InventoryKind,
        InventoryRoom,
        InventorySection,
        InventorySite,
    )
    from werkbank.modules.projects.models import Project
    from werkbank.modules.tickets.models import TicketArea

    db = rights.db
    result: dict[str, Any] = {"areas": [], "floors": [], "kinds": [], "projects": []}
    if rights.ticket_areas:
        result["areas"] = [
            {"id": i, "name": n}
            for i, n in db.execute(
                select(TicketArea.id, TicketArea.name)
                .where(TicketArea.id.in_(rights.ticket_areas))
                .order_by(TicketArea.name)
            ).tuples()
        ]
    if rights.inventory:
        rooms: dict[int, list[dict[str, Any]]] = {}
        for room_id, floor_id, name in db.execute(
            select(InventoryRoom.id, InventoryRoom.floor_id, InventoryRoom.name).order_by(
                InventoryRoom.name
            )
        ):
            rooms.setdefault(floor_id, []).append({"id": room_id, "name": name})
        result["floors"] = [
            {"id": fid, "name": SEP.join((site, section, floor)), "rooms": rooms.get(fid, [])}
            for fid, floor, section, site in db.execute(
                select(
                    InventoryFloor.id,
                    InventoryFloor.name,
                    InventorySection.name,
                    InventorySite.name,
                )
                .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
                .join(InventorySite, InventorySite.id == InventorySection.site_id)
                .order_by(InventorySite.name, InventorySection.name, InventoryFloor.name)
            )
        ]
        result["kinds"] = [
            {"id": i, "name": n}
            for i, n in db.execute(
                select(InventoryKind.id, InventoryKind.name).order_by(InventoryKind.name)
            ).tuples()
        ]
    if rights.projects:
        result["projects"] = [
            {"id": i, "name": n}
            for i, n in db.execute(select(Project.id, Project.name).order_by(Project.name)).tuples()
        ]
    return result


# --- Rückverweise --------------------------------------------------------------------------


def referencing_pages(db: Session, kind: str, ref_id: str) -> list[uuid.UUID]:
    """Seiten (nicht im Papierkorb), die auf das Objekt verweisen; ein Projekt auch über den
    Live-Baustein „Projektstand“. Rechte prüft der Aufrufer."""
    from werkbank.modules.doku.models import DokuPage

    if kind not in RESOLVERS or not valid_ref_id(ref_id):
        return []
    path = '$.** ? (@.type == "werkbankRef" && @.attrs.kind == $kind && @.attrs.id == $id)'
    variables: dict[str, Any] = {"kind": kind, "id": ref_id}
    exists = func.jsonb_path_exists(
        DokuPage.content, cast(literal(path), JSONPATH), literal(variables, type_=JSONB)
    )
    cond: Any = exists
    if kind == "projekt":
        live = (
            '$.** ? (@.type == "liveBlock" && @.attrs.kind == "projekt" && @.attrs.project == $n)'
        )
        cond = or_(
            exists,
            func.jsonb_path_exists(
                DokuPage.content,
                cast(literal(live), JSONPATH),
                literal({"n": int(ref_id)}, type_=JSONB),
            ),
        )
    return list(
        db.scalars(
            select(DokuPage.id)
            .where(DokuPage.deleted_at.is_(None), cond)
            .order_by(DokuPage.updated_at.desc())
            .limit(200)
        )
    )
