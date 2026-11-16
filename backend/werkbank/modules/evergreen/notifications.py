"""Benachrichtigungen des Bereichs Evergreen."""

import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import WorkflowEvent, WorkflowInstance
from werkbank.core.notifications import Event
from werkbank.modules.evergreen.models import EvItem, EvMessage, MessageStatus
from werkbank.modules.evergreen.workflow import evergreen_workflow

# Kommentare und Beschlüsse, die jünger sind als das, werden gemeldet
RECENT_DAYS = 7
# Rollout-Termin: Erinnerung, sobald höchstens so viele Tage fehlen (die engste Stufe zählt)
ROLLOUT_STEPS = (3, 7, 14)
DECISION_STEP = "betriebsrat"


def _item_link(item: EvItem) -> str:
    return f"/evergreen/{item.id}"


def evergreen_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Wartende Schritte, Kommentare und Beschlüsse, nahe Rollouts, Meldungen mit Frist."""
    flow = evergreen_workflow()
    rows = db.execute(
        select(EvItem, WorkflowInstance)
        .join(WorkflowInstance, WorkflowInstance.id == EvItem.workflow_instance_id)
        .where(~WorkflowInstance.finished)
    ).all()
    newest = select(func.max(WorkflowEvent.id)).group_by(WorkflowEvent.instance_id)
    last_events = {
        instance_id: (event_id, user_id)
        for instance_id, event_id, user_id in db.execute(
            select(WorkflowEvent.instance_id, WorkflowEvent.id, WorkflowEvent.user_id).where(
                WorkflowEvent.id.in_(newest)
            )
        )
    }
    today = now.date()
    for item, instance in rows:
        step = flow.steps.get(instance.step)
        if step is not None and any(not action.automatic for action in step.actions):
            event_id, actor = last_events.get(instance.id, (0, None))
            yield Event(
                kind="evergreen.schritt",
                key=f"{instance.id}:{event_id}",
                title=f"{flow.title_of(instance.step)}: {item.title}",
                link=_item_link(item),
                roles=step.roles,
                # Wer den Vorgang gerade weitergegeben hat, weiß es schon
                exclude=frozenset({actor}) if actor else frozenset(),
            )
        if item.rollout_date is not None:
            left = (item.rollout_date - today).days
            reached = [days for days in ROLLOUT_STEPS if 0 <= left <= days]
            if reached:
                yield Event(
                    kind="evergreen.rollout",
                    key=f"{item.id}:{item.rollout_date.isoformat()}:{reached[0]}",
                    title=(
                        f"Rollout heute: {item.title}"
                        if left == 0
                        else f"Rollout in {left} {'Tag' if left == 1 else 'Tagen'}: {item.title}"
                    ),
                    link=_item_link(item),
                )

    recent = db.execute(
        select(WorkflowEvent, EvItem)
        .join(EvItem, EvItem.workflow_instance_id == WorkflowEvent.instance_id)
        .where(
            WorkflowEvent.occurred_at >= now - timedelta(days=RECENT_DAYS),
            (WorkflowEvent.comment.is_not(None) & (WorkflowEvent.comment != ""))
            | (WorkflowEvent.step == DECISION_STEP),
            WorkflowEvent.user_id.is_not(None),
        )
    ).all()
    if recent:
        instance_ids = {event.instance_id for event, _ in recent}
        involved: dict[int, set[uuid.UUID]] = {}
        for instance_id, user_id in db.execute(
            select(WorkflowEvent.instance_id, WorkflowEvent.user_id)
            .where(WorkflowEvent.instance_id.in_(instance_ids), WorkflowEvent.user_id.is_not(None))
            .distinct()
        ):
            involved.setdefault(instance_id, set()).add(user_id)
        for event, item in recent:
            people = set(involved.get(event.instance_id, set()))
            if item.created_by is not None:
                people.add(item.created_by)
            decision = event.step == DECISION_STEP
            action = flow.steps[event.step].action(event.action) if decision else None
            yield Event(
                kind="evergreen.kommentar",
                key=str(event.id),
                title=(
                    f"Betriebsrat: {action.title if action else event.action}: {item.title}"
                    if decision
                    else f"Neuer Kommentar: {item.title}"
                ),
                link=_item_link(item),
                user_ids=frozenset(people),
                exclude=frozenset({event.user_id}) if event.user_id else frozenset(),
            )

    for message in db.scalars(
        select(EvMessage).where(
            EvMessage.status == MessageStatus.NEW, EvMessage.action_required_by.is_not(None)
        )
    ):
        due = message.action_required_by
        yield Event(
            kind="evergreen.meldung",
            key=message.message_id,
            title=f"Handeln bis {due:%d.%m.%Y}: {message.title}" if due else message.title,
            link="/evergreen/eingang",
        )
