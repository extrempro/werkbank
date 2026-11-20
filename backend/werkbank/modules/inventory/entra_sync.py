"""Abgleich der Personen im IT-Bestand mit Entra, jede Stunde.

Geprüft werden die Personen, die eine Stelle besetzen oder einen offenen Verleih haben.
- Konto aktiv: Name und Anmeldename werden nachgezogen (mit Verlaufseintrag); war die Person
  vorher inaktiv, schließen sich offene Vorgänge „Person nicht mehr aktiv“ von selbst.
- Konto deaktiviert oder gelöscht: je Stelle und je offenem Verleih ein Vorgang „Person nicht
  mehr aktiv“, einmal je Zeitraum der Inaktivität.
Lässt sich Entra nicht erreichen, ändert der Lauf nichts.
"""

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryEvent,
    InventoryLoan,
    InventoryLoanItem,
    InventoryPersonState,
    InventoryPosition,
)
from werkbank.modules.inventory.people import (
    PeopleError,
    Person,
    PersonLookup,
    graph_person_lookup,
)
from werkbank.modules.inventory.sync import (
    CASE_PERSON,
    OPEN_STATES,
    STATE_DONE,
    _event,
    _new_case,
)

logger = logging.getLogger(__name__)

ENTRA_SYNC = "bestand.entra"
ENTRA_SYNC_INTERVAL = timedelta(hours=1)
PEOPLE_MAX = 2000
STATE_ACTIVE = "aktiv"
STATE_DISABLED = "deaktiviert"
STATE_DELETED = "geloescht"
REASON_LABELS = {
    STATE_DISABLED: "in Entra deaktiviert",
    STATE_DELETED: "in Entra nicht mehr vorhanden",
}


def _staff_event(db: Session, position_id: int, text: str) -> None:
    db.add(
        InventoryEvent(
            position_id=position_id, user_id=None, occurred_at=now_utc(), text=text[:400]
        )
    )


def _open_loans(db: Session) -> list[InventoryLoan]:
    return list(
        db.scalars(
            select(InventoryLoan)
            .where(InventoryLoan.returned_on.is_(None))
            .order_by(InventoryLoan.id)
        ).all()
    )


def person_cases(db: Session, oid: str) -> list[InventoryCase]:
    return list(
        db.scalars(
            select(InventoryCase)
            .where(
                InventoryCase.kind == CASE_PERSON,
                InventoryCase.facts["person_oid"].astext == oid,
            )
            .order_by(InventoryCase.id)
        ).all()
    )


def _sync_names(
    db: Session,
    person: Person,
    positions: list[InventoryPosition],
    loans: list[InventoryLoan],
) -> int:
    """Name und Anmeldename aus Entra übernehmen; liefert die Zahl der Änderungen."""
    changed = 0
    name = person.name or person.upn
    for position in positions:
        if (position.person_name, position.person_upn) == (name, person.upn):
            continue
        _staff_event(
            db,
            position.id,
            f"Angaben aus Entra: {position.person_name} ({position.person_upn or 'ohne'}) → "
            f"{name} ({person.upn or 'ohne'})",
        )
        position.person_name = name[:200]
        position.person_upn = person.upn[:200]
        changed += 1
    for loan in loans:
        if (loan.person_name, loan.person_upn, loan.person_mail) == (
            name,
            person.upn,
            person.mail,
        ):
            continue
        if (loan.person_name, loan.person_upn) != (name, person.upn):
            for item in db.scalars(
                select(InventoryLoanItem).where(
                    InventoryLoanItem.loan_id == loan.id, InventoryLoanItem.returned_on.is_(None)
                )
            ).all():
                _event(
                    db,
                    f"Verleih {loan.number}: Angaben aus Entra: {loan.person_name} → {name}",
                    hardware_id=item.hardware_id,
                )
        loan.person_name = name[:200]
        loan.person_upn = person.upn[:200]
        loan.person_mail = person.mail[:200]
        changed += 1
    return changed


def _reactivated(db: Session, oid: str, name: str) -> None:
    for case in person_cases(db, oid):
        if case.status not in OPEN_STATES:
            continue
        case.decision = "wieder_aktiv"
        case.status = STATE_DONE
        case.closed_at = now_utc()
        _event(db, f"Erledigt: Das Konto von {name} ist in Entra wieder aktiv", case_id=case.id)


def _inactive_cases(
    db: Session,
    oid: str,
    state: InventoryPersonState,
    positions: list[InventoryPosition],
    loans: list[InventoryLoan],
) -> int:
    """Je Stelle und Verleih ein Vorgang, falls es seit Beginn der Inaktivität noch keinen gibt."""
    since = state.inactive_since or now_utc()
    existing = [case for case in person_cases(db, oid) if case.created_at >= since]
    reason = REASON_LABELS.get(state.state, state.state)
    created = 0
    base: dict[str, Any] = {
        "person_oid": oid,
        "person": state.name,
        "upn": state.upn,
        "reason": state.state,
    }
    for position in positions:
        if any(case.facts.get("position_id") == position.id for case in existing):
            continue
        _new_case(
            db,
            CASE_PERSON,
            f"Person nicht mehr aktiv: {state.name} (Stelle {position.number})",
            {
                **base,
                "position_id": position.id,
                "position_number": position.number,
                "position_name": position.name,
            },
            f"{state.name} ist {reason}",
        )
        _staff_event(db, position.id, f"{state.name} ist {reason}")
        created += 1
    for loan in loans:
        if any(case.facts.get("loan_id") == loan.id for case in existing):
            continue
        _new_case(
            db,
            CASE_PERSON,
            f"Person nicht mehr aktiv: {state.name} (Verleih {loan.number})",
            {**base, "loan_id": loan.id, "loan_number": loan.number},
            f"{state.name} ist {reason}",
        )
        created += 1
    return created


def run_entra_sync(
    db: Session, lookup: PersonLookup, now: datetime | None = None
) -> tuple[int, int]:
    """Ein Lauf; liefert (geänderte Angaben, neue Vorgänge). Bei Fehlern in Entra: nichts."""
    now = now or now_utc()
    positions: dict[str, list[InventoryPosition]] = {}
    for position in db.scalars(
        select(InventoryPosition)
        .where(InventoryPosition.person_oid.is_not(None))
        .order_by(InventoryPosition.id)
    ).all():
        if position.person_oid:
            positions.setdefault(position.person_oid, []).append(position)
    loans: dict[str, list[InventoryLoan]] = {}
    for loan in _open_loans(db):
        loans.setdefault(loan.person_oid, []).append(loan)
    oids = sorted(set(positions) | set(loans))[:PEOPLE_MAX]

    found: dict[str, Person | None] = {}
    try:
        for oid in oids:
            found[oid] = lookup(oid)
    except PeopleError as exc:
        logger.warning("Abgleich mit Entra abgebrochen: %s", exc)
        return 0, 0

    changed = created = 0
    for oid in oids:
        person = found[oid]
        own_positions = positions.get(oid, [])
        own_loans = loans.get(oid, [])
        state = db.get(InventoryPersonState, oid)
        if state is None:
            first = (own_positions[0].person_name if own_positions else "") or (
                own_loans[0].person_name if own_loans else ""
            )
            state = InventoryPersonState(oid=oid, name=first, upn="", state=STATE_ACTIVE)
            db.add(state)
        state.checked_at = now
        if person is not None and person.enabled:
            changed += _sync_names(db, person, own_positions, own_loans)
            state.name = (person.name or person.upn)[:200]
            state.upn = person.upn[:200]
            if state.state != STATE_ACTIVE:
                _reactivated(db, oid, state.name)
            state.state = STATE_ACTIVE
            state.inactive_since = None
        else:
            new_state = STATE_DELETED if person is None else STATE_DISABLED
            if person is not None:
                state.name = (person.name or person.upn or state.name)[:200]
                state.upn = person.upn[:200]
            if state.state == STATE_ACTIVE or state.inactive_since is None:
                state.inactive_since = now
            state.state = new_state
            db.flush()
            created += _inactive_cases(db, oid, state, own_positions, own_loans)
        db.commit()
    return changed, created


def entra_sync_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    try:
        lookup = graph_person_lookup(settings)
    except PeopleError:
        # Entra nicht eingerichtet: nichts zu tun
        return
    run_entra_sync(db, lookup)
