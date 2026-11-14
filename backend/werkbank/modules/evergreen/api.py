"""API des Moduls Evergreen: Vorgänge, Aktionen im Ablauf, Protokoll (spec.md 8)."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.models import User, WorkflowEvent, WorkflowInstance
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.workflow import WorkflowError, available_actions, perform_action
from werkbank.modules.evergreen.models import EvItem
from werkbank.modules.evergreen.service import (
    ALL_ROLES,
    EDITOR_ROLES,
    MODULE,
    OBJECT_TYPE,
    actionable_steps,
    create_item,
    visibility,
)
from werkbank.modules.evergreen.workflow import evergreen_workflow

router = APIRouter(prefix="/api/evergreen")

Member = Annotated[CurrentUser, Depends(require_roles(*ALL_ROLES))]
Editor = Annotated[CurrentUser, Depends(require_roles(*EDITOR_ROLES))]
ItemId = Annotated[int, Path(ge=1)]

TEXT_MAX_LENGTH = 8000
ERROR_STATUS = {"forbidden": 403, "conflict": 409, "invalid": 422}


class ItemOut(BaseModel):
    id: int
    number: str
    title: str
    service: str | None
    source: str
    major_change: bool
    rollout_date: date | None
    step: str
    step_title: str
    finished: bool
    waiting_for_me: bool
    created_at: datetime


class ItemListOut(BaseModel):
    entries: list[ItemOut]
    has_more: bool
    can_create: bool


class StepOut(BaseModel):
    id: str
    title: str


class ActionOut(BaseModel):
    id: str
    title: str
    comment_required: bool
    on_behalf: bool


class EventOut(BaseModel):
    id: int
    occurred_at: datetime
    step_title: str
    action_title: str
    target_title: str
    user: str | None
    on_behalf_of: str | None
    comment: str | None
    session_date: str | None


class ItemDetailOut(BaseModel):
    item: ItemOut
    summary: str | None
    departments_feedback: str | None
    not_controllable: bool
    steps: list[StepOut]
    actions: list[ActionOut]
    events: list[EventOut]
    can_edit: bool


class ItemCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    service: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    rollout_date: date | None = None
    major_change: bool = False


class ItemUpdateIn(BaseModel):
    """Nur die mitgeschickten Felder werden geändert."""

    title: str | None = Field(default=None, min_length=3, max_length=300)
    service: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    departments_feedback: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    rollout_date: date | None = None
    major_change: bool | None = None
    not_controllable: bool | None = None


class ActionIn(BaseModel):
    action: str = Field(min_length=1, max_length=64)
    comment: str | None = Field(default=None, max_length=4000)
    # Schritt, den die Person gesehen hat (Schutz vor Entscheidungen auf veraltetem Stand)
    expected_step: str = Field(min_length=1, max_length=64)
    # Datum der Sitzung, wenn ein Beschluss im Auftrag erfasst wird
    session_date: date | None = None


def _clean(value: str | None) -> str | None:
    return (value or "").strip() or None


def _item_out(item: EvItem, instance: WorkflowInstance, waiting_steps: list[str]) -> ItemOut:
    return ItemOut(
        id=item.id,
        number=item.number,
        title=item.title,
        service=item.service,
        source=item.source,
        major_change=item.major_change,
        rollout_date=item.rollout_date,
        step=instance.step,
        step_title=evergreen_workflow().title_of(instance.step),
        finished=instance.finished,
        waiting_for_me=not instance.finished and instance.step in waiting_steps,
        created_at=item.created_at,
    )


def _load(db: DbDep, user: CurrentUser, item_id: int) -> tuple[EvItem, WorkflowInstance]:
    """Vorgang samt Ablauf, sofern die Person ihn sehen darf. Sonst 404 (kein Hinweis)."""
    row = db.execute(
        select(EvItem, WorkflowInstance)
        .join(WorkflowInstance, WorkflowInstance.id == EvItem.workflow_instance_id)
        .where(EvItem.id == item_id, visibility(user))
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return row[0], row[1]


@router.get("/items")
def list_items(
    user: Member,
    db: DbDep,
    view: Annotated[Literal["offen", "meine", "abgeschlossen", "alle"], Query()] = "offen",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
) -> ItemListOut:
    """Vorgänge, die die Person sehen darf. Offene nach Rollout-Datum, sonst neueste zuerst."""
    waiting = actionable_steps(user)
    query = (
        select(EvItem, WorkflowInstance)
        .join(WorkflowInstance, WorkflowInstance.id == EvItem.workflow_instance_id)
        .where(visibility(user))
    )
    if view == "offen":
        query = query.where(~WorkflowInstance.finished)
    elif view == "meine":
        query = query.where(~WorkflowInstance.finished, WorkflowInstance.step.in_(waiting))
    elif view == "abgeschlossen":
        query = query.where(WorkflowInstance.finished)
    if view in ("offen", "meine"):
        query = query.order_by(EvItem.rollout_date.asc().nulls_last(), EvItem.id.desc())
    else:
        query = query.order_by(EvItem.id.desc())
    rows = db.execute(query.limit(limit + 1).offset(offset)).all()
    return ItemListOut(
        entries=[_item_out(row[0], row[1], waiting) for row in rows[:limit]],
        has_more=len(rows) > limit,
        can_create=user.has_any_role(*EDITOR_ROLES),
    )


@router.post("/items", status_code=status.HTTP_201_CREATED)
def create(request: Request, body: ItemCreateIn, user: Editor, db: DbDep) -> ItemOut:
    """Legt einen Vorgang von Hand an (z. B. Hinweis aus der Fachpresse)."""
    item = create_item(
        db,
        title=body.title.strip(),
        service=_clean(body.service),
        summary=_clean(body.summary),
        rollout_date=body.rollout_date,
        major_change=body.major_change,
        created_by=user.user_id,
    )
    write_audit(
        db,
        module=MODULE,
        action="vorgang.angelegt",
        user_id=user.user_id,
        object_type=OBJECT_TYPE,
        object_id=item.number,
        ip=request.client.host if request.client else None,
        details={"quelle": item.source},
    )
    instance = db.get(WorkflowInstance, item.workflow_instance_id)
    db.commit()
    if instance is None:  # pragma: no cover - der Ablauf wurde eben angelegt
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return _item_out(item, instance, actionable_steps(user))


def _detail(
    db: DbDep, user: CurrentUser, item: EvItem, instance: WorkflowInstance
) -> ItemDetailOut:
    flow = evergreen_workflow()
    events = db.execute(
        select(WorkflowEvent, User.display_name)
        .outerjoin(User, User.id == WorkflowEvent.user_id)
        .where(WorkflowEvent.instance_id == instance.id)
        .order_by(WorkflowEvent.id)
    ).all()

    def action_title(step_id: str, action_id: str) -> str:
        step = flow.steps.get(step_id)
        action = step.action(action_id) if step else None
        return action.title if action else action_id

    return ItemDetailOut(
        item=_item_out(item, instance, actionable_steps(user)),
        summary=item.summary,
        departments_feedback=item.departments_feedback,
        not_controllable=item.not_controllable,
        steps=[StepOut(id=step.id, title=step.title) for step in flow.steps.values()],
        actions=[
            ActionOut(
                id=entry.action.id,
                title=entry.action.title,
                comment_required=entry.action.comment_required or entry.on_behalf,
                on_behalf=entry.on_behalf,
            )
            for entry in available_actions(flow, instance, user)
        ],
        events=[
            EventOut(
                id=event.id,
                occurred_at=event.occurred_at,
                step_title=flow.title_of(event.step),
                action_title=action_title(event.step, event.action),
                target_title=flow.title_of(event.target),
                user=name,
                on_behalf_of=event.on_behalf_of,
                comment=event.comment,
                session_date=(event.details or {}).get("sitzung"),
            )
            for event, name in events
        ],
        can_edit=user.has_any_role(*EDITOR_ROLES) and not instance.finished,
    )


@router.get("/items/{item_id}")
def get_item(user: Member, db: DbDep, item_id: ItemId) -> ItemDetailOut:
    """Ein Vorgang mit Schritten, möglichen Aktionen und Protokoll."""
    item, instance = _load(db, user, item_id)
    return _detail(db, user, item, instance)


@router.patch("/items/{item_id}")
def update_item(
    request: Request, body: ItemUpdateIn, user: Editor, db: DbDep, item_id: ItemId
) -> ItemDetailOut:
    """Pflegt die Inhalte eines offenen Vorgangs (nicht seinen Status)."""
    item, instance = _load(db, user, item_id)
    if instance.finished:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Vorgang ist abgeschlossen"
        )
    sent = body.model_fields_set
    changed: list[str] = []

    def apply(name: str, value: Any) -> None:
        if getattr(item, name) != value:
            setattr(item, name, value)
            changed.append(name)

    if "title" in sent and body.title is not None:
        apply("title", body.title.strip())
    for name in ("service", "summary", "departments_feedback"):
        if name in sent:
            apply(name, _clean(getattr(body, name)))
    if "rollout_date" in sent:
        apply("rollout_date", body.rollout_date)
    for name in ("major_change", "not_controllable"):
        value = getattr(body, name)
        if name in sent and value is not None:
            apply(name, value)
    if changed:
        write_audit(
            db,
            module=MODULE,
            action="vorgang.geaendert",
            user_id=user.user_id,
            object_type=OBJECT_TYPE,
            object_id=item.number,
            ip=request.client.host if request.client else None,
            details={"felder": changed},
        )
    db.commit()
    return _detail(db, user, item, instance)


@router.post("/items/{item_id}/actions")
def act(
    request: Request, body: ActionIn, user: Member, db: DbDep, item_id: ItemId
) -> ItemDetailOut:
    """Führt eine Aktion im Ablauf aus (z. B. zustimmen). Den Status setzt nur der Ablauf."""
    item, instance = _load(db, user, item_id)
    flow = evergreen_workflow()
    offered = {entry.action.id: entry for entry in available_actions(flow, instance, user)}
    entry = offered.get(body.action)
    details: dict[str, Any] | None = None
    if entry is not None and entry.on_behalf:
        # Beschluss aus einem Sitzungsprotokoll: Datum und Inhalt sind Pflicht (spec.md 8.6)
        if body.session_date is None or not _clean(body.comment):
            raise HTTPException(
                status_code=422,
                detail="Im Auftrag erfasst: Sitzungsdatum und Inhalt des Beschlusses sind nötig",
            )
        if body.session_date > now_utc().date():
            raise HTTPException(status_code=422, detail="Das Sitzungsdatum liegt in der Zukunft")
        details = {"sitzung": body.session_date.isoformat()}
    try:
        perform_action(
            db,
            flow,
            instance.id,
            body.action,
            user,
            comment=body.comment,
            expected_step=body.expected_step,
            details=details,
            ip=request.client.host if request.client else None,
        )
    except WorkflowError as error:
        db.rollback()
        raise HTTPException(
            status_code=ERROR_STATUS.get(error.code, 400), detail=error.message
        ) from error
    db.commit()
    db.refresh(instance)
    return _detail(db, user, item, instance)
