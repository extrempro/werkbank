"""Workflow-Engine (spec.md 6.3).

Ein Workflow wird in YAML beschrieben: Schritte, zuständige Rollen und Aktionen mit Ziel.
Der Status eines Objekts ist sein aktueller Schritt. Er ändert sich nur über eine definierte
Aktion der zuständigen Rolle oder über eine automatische Aktion des Systems. Jede Aktion
erzeugt einen unveränderlichen Protokolleintrag.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.models import WorkflowEvent, WorkflowInstance
from werkbank.core.roles import KNOWN_ROLES
from werkbank.core.sessions import CurrentUser, now_utc

COMMENT_MAX_LENGTH = 4000


class WorkflowDefinitionError(ValueError):
    """Die Beschreibung eines Workflows ist fehlerhaft."""


class WorkflowError(Exception):
    """Eine Aktion ist nicht zulässig. code: forbidden, conflict oder invalid."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Action:
    id: str
    title: str
    target: str
    comment_required: bool = False
    # nur das System darf diese Aktion auslösen (z. B. Soll/Ist-Abgleich)
    automatic: bool = False


@dataclass(frozen=True)
class Step:
    id: str
    title: str
    roles: tuple[str, ...]
    # Rollen, die eine Entscheidung stellvertretend erfassen dürfen
    on_behalf_roles: tuple[str, ...] = ()
    actions: tuple[Action, ...] = ()

    def action(self, action_id: str) -> Action | None:
        return next((item for item in self.actions if item.id == action_id), None)


@dataclass(frozen=True)
class WorkflowDefinition:
    name: str
    start: str
    steps: dict[str, Step]
    # Endzustände: Kennung -> Anzeigename
    end_states: dict[str, str] = field(default_factory=dict)

    def title_of(self, state: str) -> str:
        if state in self.steps:
            return self.steps[state].title
        return self.end_states.get(state, state)


@dataclass(frozen=True)
class AvailableAction:
    action: Action
    # wahr: Die Person erfasst die Entscheidung im Auftrag der zuständigen Rolle
    on_behalf: bool


def _text(data: dict[str, Any], key: str, where: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise WorkflowDefinitionError(f"{where}: Angabe „{key}“ fehlt")
    return value.strip()


def _roles(data: dict[str, Any], key: str, where: str) -> tuple[str, ...]:
    value = data.get(key) or []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise WorkflowDefinitionError(f"{where}: „{key}“ muss eine Liste von Rollen sein")
    unknown = [item for item in value if item not in KNOWN_ROLES]
    if unknown:
        raise WorkflowDefinitionError(f"{where}: unbekannte Rolle {unknown[0]}")
    return tuple(value)


def parse_workflow(data: Any) -> WorkflowDefinition:
    """Prüft eine Workflow-Beschreibung und baut daraus die Definition."""
    if not isinstance(data, dict):
        raise WorkflowDefinitionError("Workflow-Beschreibung muss ein Objekt sein")
    name = _text(data, "workflow", "Workflow")
    end_states = data.get("endzustaende") or {}
    if not isinstance(end_states, dict) or not end_states:
        raise WorkflowDefinitionError("Workflow: „endzustaende“ fehlt")
    raw_steps = data.get("schritte")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise WorkflowDefinitionError("Workflow: „schritte“ fehlt")

    steps: dict[str, Step] = {}
    for raw in raw_steps:
        if not isinstance(raw, dict):
            raise WorkflowDefinitionError("Schritt muss ein Objekt sein")
        step_id = _text(raw, "id", "Schritt")
        where = f"Schritt {step_id}"
        if step_id in steps or step_id in end_states:
            raise WorkflowDefinitionError(f"{where}: Kennung doppelt vergeben")
        actions: list[Action] = []
        for raw_action in raw.get("aktionen") or []:
            if not isinstance(raw_action, dict):
                raise WorkflowDefinitionError(f"{where}: Aktion muss ein Objekt sein")
            action_id = _text(raw_action, "id", where)
            if any(item.id == action_id for item in actions):
                raise WorkflowDefinitionError(f"{where}: Aktion {action_id} doppelt")
            actions.append(
                Action(
                    id=action_id,
                    title=_text(raw_action, "titel", f"{where}, Aktion {action_id}"),
                    target=_text(raw_action, "ziel", f"{where}, Aktion {action_id}"),
                    comment_required=raw_action.get("kommentar") == "pflicht",
                    automatic=bool(raw_action.get("automatisch", False)),
                )
            )
        if not actions:
            raise WorkflowDefinitionError(f"{where}: keine Aktion, der Schritt wäre eine Sackgasse")
        steps[step_id] = Step(
            id=step_id,
            title=_text(raw, "titel", where),
            roles=_roles(raw, "rollen", where),
            on_behalf_roles=_roles(raw, "im_auftrag", where),
            actions=tuple(actions),
        )

    start = _text(data, "start", "Workflow")
    if start not in steps:
        raise WorkflowDefinitionError("Workflow: „start“ ist kein Schritt")
    for step in steps.values():
        for action in step.actions:
            if action.target not in steps and action.target not in end_states:
                raise WorkflowDefinitionError(
                    f"Schritt {step.id}, Aktion {action.id}: unbekanntes Ziel {action.target}"
                )
        if not step.roles and not all(action.automatic for action in step.actions):
            raise WorkflowDefinitionError(f"Schritt {step.id}: keine zuständige Rolle")
    return WorkflowDefinition(
        name=name,
        start=start,
        steps=steps,
        end_states={str(key): str(value) for key, value in end_states.items()},
    )


def load_workflow(path: Path) -> WorkflowDefinition:
    """Liest eine Workflow-Beschreibung aus einer YAML-Datei."""
    return parse_workflow(yaml.safe_load(path.read_text(encoding="utf-8")))


def start_workflow(
    db: Session, definition: WorkflowDefinition, object_type: str, object_id: str
) -> WorkflowInstance:
    """Legt den Ablauf für ein Objekt an. Der Aufrufer entscheidet über das Commit."""
    instance = WorkflowInstance(
        workflow=definition.name,
        object_type=object_type,
        object_id=object_id,
        step=definition.start,
        finished=False,
    )
    db.add(instance)
    db.flush()
    return instance


def available_actions(
    definition: WorkflowDefinition, instance: WorkflowInstance, user: CurrentUser
) -> list[AvailableAction]:
    """Aktionen, die die Person im aktuellen Schritt auslösen darf."""
    step = definition.steps.get(instance.step)
    if instance.finished or step is None:
        return []
    if user.has_any_role(*step.roles):
        on_behalf = False
    elif user.has_any_role(*step.on_behalf_roles):
        on_behalf = True
    else:
        return []
    return [
        AvailableAction(action=action, on_behalf=on_behalf)
        for action in step.actions
        if not action.automatic
    ]


def _transition(
    db: Session,
    definition: WorkflowDefinition,
    instance: WorkflowInstance,
    action: Action,
    *,
    user: CurrentUser | None,
    comment: str | None,
    on_behalf_of: str | None,
    details: dict[str, Any] | None,
    ip: str | None,
) -> WorkflowEvent:
    previous = instance.step
    now = now_utc()
    event = WorkflowEvent(
        instance_id=instance.id,
        step=previous,
        action=action.id,
        target=action.target,
        comment=comment,
        user_id=user.user_id if user else None,
        on_behalf_of=on_behalf_of,
        details=details,
        occurred_at=now,
    )
    db.add(event)
    instance.step = action.target
    instance.finished = action.target in definition.end_states
    instance.updated_at = now
    write_audit(
        db,
        module=definition.name,
        action=f"workflow.{action.id}",
        user_id=user.user_id if user else None,
        object_type=instance.object_type,
        object_id=instance.object_id,
        ip=ip,
        details={
            "von": previous,
            "nach": action.target,
            "im_auftrag_von": on_behalf_of,
            "automatisch": user is None,
        },
    )
    db.flush()
    return event


def _locked(db: Session, instance_id: int) -> WorkflowInstance:
    instance = db.execute(
        select(WorkflowInstance).where(WorkflowInstance.id == instance_id).with_for_update()
    ).scalar_one_or_none()
    if instance is None:
        raise WorkflowError("conflict", "Der Ablauf existiert nicht")
    return instance


def perform_action(
    db: Session,
    definition: WorkflowDefinition,
    instance_id: int,
    action_id: str,
    user: CurrentUser,
    *,
    comment: str | None = None,
    expected_step: str | None = None,
    details: dict[str, Any] | None = None,
    ip: str | None = None,
) -> WorkflowEvent:
    """Führt eine Aktion der angemeldeten Person aus. Der Aufrufer entscheidet über das Commit.

    expected_step schützt vor Entscheidungen auf veraltetem Stand: Hat sich der Schritt
    inzwischen geändert, wird die Aktion abgewiesen.
    """
    instance = _locked(db, instance_id)
    if instance.finished:
        raise WorkflowError("conflict", "Der Vorgang ist bereits abgeschlossen")
    if expected_step is not None and expected_step != instance.step:
        raise WorkflowError("conflict", "Der Vorgang wurde inzwischen weiterbearbeitet")
    step = definition.steps.get(instance.step)
    action = step.action(action_id) if step else None
    if step is None or action is None or action.automatic:
        raise WorkflowError("invalid", "Diese Aktion gibt es in diesem Schritt nicht")
    if user.has_any_role(*step.roles):
        on_behalf_of = None
    elif user.has_any_role(*step.on_behalf_roles):
        on_behalf_of = step.title
    else:
        raise WorkflowError("forbidden", "Für diesen Schritt ist eine andere Rolle zuständig")
    text = (comment or "").strip() or None
    if text is not None and len(text) > COMMENT_MAX_LENGTH:
        raise WorkflowError("invalid", "Der Kommentar ist zu lang")
    if action.comment_required and text is None:
        raise WorkflowError("invalid", "Für diese Aktion ist ein Kommentar nötig")
    return _transition(
        db,
        definition,
        instance,
        action,
        user=user,
        comment=text,
        on_behalf_of=on_behalf_of,
        details=details,
        ip=ip,
    )


def perform_automatic(
    db: Session,
    definition: WorkflowDefinition,
    instance_id: int,
    action_id: str,
    *,
    comment: str | None = None,
    details: dict[str, Any] | None = None,
) -> WorkflowEvent | None:
    """Löst eine automatische Aktion aus. None, wenn sie im aktuellen Schritt nicht passt."""
    instance = _locked(db, instance_id)
    step = definition.steps.get(instance.step)
    action = step.action(action_id) if step and not instance.finished else None
    if action is None or not action.automatic:
        return None
    return _transition(
        db,
        definition,
        instance,
        action,
        user=None,
        comment=comment,
        on_behalf_of=None,
        details=details,
        ip=None,
    )
