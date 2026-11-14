"""Vorgänge anlegen und nach Rolle sichtbar machen (spec.md 4 und 8)."""

from datetime import date
from typing import Any

from sqlalchemy import ColumnElement, exists, false, func, or_, select, text, true
from sqlalchemy.orm import Session

from werkbank.core.models import WorkflowEvent, WorkflowInstance
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.workflow import start_workflow
from werkbank.modules.evergreen.models import EvItem, ItemSource
from werkbank.modules.evergreen.workflow import evergreen_workflow

MODULE = "evergreen"
OBJECT_TYPE = "vorgang"
# Sperre für die Vergabe der laufenden Nummer (beliebige, feste Zahl)
NUMBER_LOCK = 3_650_001

# Rollen, die alle Vorgänge sehen und pflegen
EDITOR_ROLES = (Role.EVERGREEN_IT, Role.EVERGREEN_TEAM)
ALL_ROLES = (*EDITOR_ROLES, Role.EVERGREEN_BETRIEBSRAT, Role.EVERGREEN_GF)
# Betriebsrat und Geschäftsführung sehen einen Vorgang erst, wenn er sie erreicht hat
REACHED_BY = {
    Role.EVERGREEN_BETRIEBSRAT: "betriebsrat",
    Role.EVERGREEN_GF: "geschaeftsfuehrung",
}


def create_item(
    db: Session,
    *,
    title: str,
    service: str | None = None,
    summary: str | None = None,
    rollout_date: date | None = None,
    major_change: bool = False,
    source: str = ItemSource.MANUAL,
    source_ref: str | None = None,
    created_by: Any = None,
) -> EvItem:
    """Legt einen Vorgang mit Nummer und Ablauf an. Der Aufrufer entscheidet über das Commit."""
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": NUMBER_LOCK})
    year = now_utc().year
    last = db.scalar(select(func.max(EvItem.sequence)).where(EvItem.year == year)) or 0
    sequence = last + 1
    instance = start_workflow(db, evergreen_workflow(), OBJECT_TYPE, f"EV-{year}-{sequence:03d}")
    item = EvItem(
        year=year,
        sequence=sequence,
        title=title,
        service=service,
        summary=summary,
        rollout_date=rollout_date,
        major_change=major_change,
        source=source,
        source_ref=source_ref,
        workflow_instance_id=instance.id,
        created_by=created_by,
    )
    db.add(item)
    db.flush()
    return item


def visibility(user: CurrentUser) -> ColumnElement[bool]:
    """Bedingung: Vorgänge, die die Person sehen darf."""
    if user.has_any_role(*EDITOR_ROLES):
        return true()
    conditions = [
        exists().where(
            WorkflowEvent.instance_id == EvItem.workflow_instance_id,
            WorkflowEvent.target == step,
        )
        for role, step in REACHED_BY.items()
        if user.has_any_role(role)
    ]
    return or_(*conditions) if conditions else false()


def actionable_steps(user: CurrentUser) -> list[str]:
    """Schritte, in denen die Person selbst oder im Auftrag etwas entscheiden kann."""
    return [
        step.id
        for step in evergreen_workflow().steps.values()
        if any(not action.automatic for action in step.actions)
        and user.has_any_role(*step.roles, *step.on_behalf_roles)
    ]


def own_steps(user: CurrentUser) -> list[str]:
    """Schritte, für die die Person selbst zuständig ist (ohne Vertretung)."""
    return [
        step.id
        for step in evergreen_workflow().steps.values()
        if any(not action.automatic for action in step.actions) and user.has_any_role(*step.roles)
    ]


def count_waiting(db: Session, user: CurrentUser, step: str) -> int:
    """Zahl der sichtbaren, offenen Vorgänge in einem Schritt."""
    count = db.scalar(
        select(func.count())
        .select_from(EvItem)
        .join(WorkflowInstance, WorkflowInstance.id == EvItem.workflow_instance_id)
        .where(visibility(user), WorkflowInstance.step == step, ~WorkflowInstance.finished)
    )
    return int(count or 0)
