"""API des Moduls Evergreen: Vorgänge, Aktionen im Ablauf, Protokoll (spec.md 8)."""

import json
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.models import User, WorkflowEvent, WorkflowInstance
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.workflow import WorkflowError, available_actions, perform_action
from werkbank.modules.evergreen.implementation import (
    IMPLEMENTATION_STEP,
    PlanRow,
    apply_target,
    evaluate,
    load_plan,
)
from werkbank.modules.evergreen.message_center import adopt
from werkbank.modules.evergreen.models import EvItem, EvMessage, EvPlan, MessageStatus
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
from werkbank.modules.m365_config.models import CfgSetting, CfgSettingVersion

router = APIRouter(prefix="/api/evergreen")

Member = Annotated[CurrentUser, Depends(require_roles(*ALL_ROLES))]
Editor = Annotated[CurrentUser, Depends(require_roles(*EDITOR_ROLES))]
# Technische Umsetzung (Soll-Werte, Verknüpfung mit Einstellungen) pflegt nur die IT
Technician = Annotated[CurrentUser, Depends(require_roles(Role.EVERGREEN_IT))]
ItemId = Annotated[int, Path(ge=1)]

TEXT_MAX_LENGTH = 8000
ERROR_STATUS = {"forbidden": 403, "conflict": 409, "invalid": 422}
TARGET_MAX_LENGTH = 20_000
URGENT_DAYS = 21


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


class MessageOut(BaseModel):
    id: int
    message_id: str
    title: str
    services: list[str]
    category: str | None
    major_change: bool
    action_required_by: datetime | None
    published_at: datetime | None
    modified_at: datetime | None
    body: str | None
    status: str
    item_id: int | None


class MessageListOut(BaseModel):
    entries: list[MessageOut]
    has_more: bool
    new_count: int


class PlanOut(BaseModel):
    id: int
    label: str
    target_value: Any
    instruction: str | None
    provisional: bool
    # erfuellt, offen (überwachte Einstellung) bzw. bestaetigt, unbestaetigt (ohne Überwachung)
    status: str
    monitored: bool
    confirmed_by: str | None
    confirmed_at: datetime | None
    # nur für die IT: technische Angaben zur Einstellung
    setting_id: int | None
    setting_path: str | None
    current_value: Any


class SettingChoiceOut(BaseModel):
    id: int
    path: str
    title: str
    value: Any


class PlanIn(BaseModel):
    label: str = Field(min_length=3, max_length=300)
    target_value: Any = None
    instruction: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    provisional: bool = False
    setting_id: int | None = Field(default=None, ge=1)


class ConfirmIn(BaseModel):
    done: bool


class ItemDetailOut(BaseModel):
    item: ItemOut
    plan: list[PlanOut]
    can_plan: bool
    # wahr: Rollout steht kurz bevor, es gibt noch keinen Beschluss und keine vorläufige Sperre
    provisional_hint: bool
    # Meldung von Microsoft, aus der der Vorgang entstanden ist
    message: MessageOut | None
    # wahr: Microsoft hat die Meldung geändert, nachdem der Vorgang angelegt wurde
    message_updated: bool
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


def _message_out(message: EvMessage) -> MessageOut:
    return MessageOut(
        id=message.id,
        message_id=message.message_id,
        title=message.title,
        services=list(message.services or []),
        category=message.category,
        major_change=message.major_change,
        action_required_by=message.action_required_by,
        published_at=message.published_at,
        modified_at=message.modified_at,
        body=message.body,
        status=message.status,
        item_id=message.item_id,
    )


def _plan_out(row: PlanRow, names: dict[Any, str], technical: bool) -> PlanOut:
    entry = row.entry
    monitored = entry.setting_id is not None and row.setting is not None
    return PlanOut(
        id=entry.id,
        label=entry.label,
        target_value=entry.target_value,
        instruction=entry.instruction,
        provisional=entry.provisional,
        status=row.status,
        monitored=monitored,
        confirmed_by=names.get(entry.confirmed_by) if entry.confirmed_by else None,
        confirmed_at=entry.confirmed_at,
        setting_id=entry.setting_id if technical and monitored else None,
        setting_path=row.setting.path if technical and row.setting else None,
        current_value=row.version.value if technical and row.version else None,
    )


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

    message = db.execute(select(EvMessage).where(EvMessage.item_id == item.id)).scalar_one_or_none()
    technical = user.has_any_role(Role.EVERGREEN_IT)
    plan = load_plan(db, item.id)
    names = dict(
        db.execute(
            select(User.id, User.display_name).where(
                User.id.in_([row.entry.confirmed_by for row in plan if row.entry.confirmed_by])
            )
        ).all()
    )
    days_left = (item.rollout_date - now_utc().date()).days if item.rollout_date else None
    decided = instance.finished or instance.step == IMPLEMENTATION_STEP
    return ItemDetailOut(
        item=_item_out(item, instance, actionable_steps(user)),
        plan=[_plan_out(row, names, technical) for row in plan],
        can_plan=technical and not instance.finished,
        provisional_hint=(
            not decided
            and not item.not_controllable
            and days_left is not None
            and days_left <= URGENT_DAYS
            and not any(row.entry.provisional for row in plan)
        ),
        message=_message_out(message) if message else None,
        message_updated=bool(
            message and message.modified_at and message.modified_at > item.created_at
        ),
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
    db.flush()
    evaluate(db, item, instance)
    db.commit()
    db.refresh(instance)
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
    db.flush()
    db.refresh(instance)
    evaluate(db, item, instance)
    db.commit()
    db.refresh(instance)
    return _detail(db, user, item, instance)


MessageId = Annotated[int, Path(ge=1)]


@router.get("/messages")
def list_messages(
    user: Editor,
    db: DbDep,
    view: Annotated[Literal["neu", "ignoriert", "alle"], Query()] = "neu",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
) -> MessageListOut:
    """Eingang: Meldungen aus dem Nachrichtencenter, neueste zuerst."""
    query = select(EvMessage)
    if view != "alle":
        query = query.where(EvMessage.status == view)
    rows = db.scalars(
        query.order_by(EvMessage.published_at.desc().nulls_last(), EvMessage.id.desc())
        .limit(limit + 1)
        .offset(offset)
    ).all()
    new_count = db.scalar(
        select(func.count()).select_from(EvMessage).where(EvMessage.status == MessageStatus.NEW)
    )
    return MessageListOut(
        entries=[_message_out(row) for row in rows[:limit]],
        has_more=len(rows) > limit,
        new_count=int(new_count or 0),
    )


def _message(db: DbDep, message_id: int) -> EvMessage:
    message = db.execute(
        select(EvMessage).where(EvMessage.id == message_id).with_for_update()
    ).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return message


@router.post("/messages/{message_id}/adopt", status_code=status.HTTP_201_CREATED)
def adopt_message(request: Request, user: Editor, db: DbDep, message_id: MessageId) -> ItemOut:
    """Übernimmt eine Meldung als Vorgang."""
    message = _message(db, message_id)
    if message.item_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Zu dieser Meldung gibt es schon einen Vorgang",
        )
    item = adopt(db, message, created_by=user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="vorgang.angelegt",
        user_id=user.user_id,
        object_type=OBJECT_TYPE,
        object_id=item.number,
        ip=request.client.host if request.client else None,
        details={"quelle": item.source, "meldung": message.message_id},
    )
    instance = db.get(WorkflowInstance, item.workflow_instance_id)
    db.commit()
    if instance is None:  # pragma: no cover - der Ablauf wurde eben angelegt
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return _item_out(item, instance, actionable_steps(user))


class MessageStatusIn(BaseModel):
    status: Literal["neu", "ignoriert"]


@router.post("/messages/{message_id}/status")
def set_message_status(
    request: Request, body: MessageStatusIn, user: Editor, db: DbDep, message_id: MessageId
) -> MessageOut:
    """Legt eine Meldung beiseite („ignoriert“) oder holt sie in den Eingang zurück."""
    message = _message(db, message_id)
    if message.item_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Zu dieser Meldung gibt es schon einen Vorgang",
        )
    if message.status != body.status:
        message.status = body.status
        write_audit(
            db,
            module=MODULE,
            action="meldung.ignoriert" if body.status == "ignoriert" else "meldung.zurueckgeholt",
            user_id=user.user_id,
            object_type="meldung",
            object_id=message.message_id,
            ip=request.client.host if request.client else None,
        )
    db.commit()
    return _message_out(message)


PlanId = Annotated[int, Path(ge=1)]


def _open_item(db: DbDep, user: CurrentUser, item_id: int) -> tuple[EvItem, WorkflowInstance]:
    item, instance = _load(db, user, item_id)
    if instance.finished:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Vorgang ist abgeschlossen"
        )
    return item, instance


def _after_plan_change(
    db: DbDep, user: CurrentUser, item: EvItem, instance: WorkflowInstance
) -> ItemDetailOut:
    db.flush()
    evaluate(db, item, instance)
    db.commit()
    db.refresh(instance)
    return _detail(db, user, item, instance)


@router.get("/settings")
def search_settings(
    user: Technician,
    db: DbDep,
    search: Annotated[str, Query(min_length=2, max_length=200)],
) -> list[SettingChoiceOut]:
    """Überwachte Einstellungen zum Verknüpfen mit einem Soll-Wert (nur IT)."""
    rows = db.execute(
        select(CfgSetting, CfgSettingVersion)
        .outerjoin(
            CfgSettingVersion,
            (CfgSettingVersion.setting_id == CfgSetting.id) & CfgSettingVersion.valid_to.is_(None),
        )
        .where(
            CfgSetting.active,
            CfgSetting.path.icontains(search, autoescape=True)
            | CfgSetting.object_name.icontains(search, autoescape=True),
        )
        .order_by(CfgSetting.path)
        .limit(20)
    ).all()
    return [
        SettingChoiceOut(
            id=row[0].id,
            path=row[0].path,
            title=f"{row[0].object_name}: {row[0].property}"
            if row[0].object_name
            else row[0].property,
            value=row[1].value if row[1] else None,
        )
        for row in rows
    ]


@router.post("/items/{item_id}/plan", status_code=status.HTTP_201_CREATED)
def add_plan(
    request: Request, body: PlanIn, user: Technician, db: DbDep, item_id: ItemId
) -> ItemDetailOut:
    """Trägt einen Soll-Wert in die geplante Umsetzung ein (nur IT)."""
    item, instance = _open_item(db, user, item_id)
    if len(json.dumps(body.target_value)) > TARGET_MAX_LENGTH:
        raise HTTPException(status_code=422, detail="Der Soll-Wert ist zu groß")
    if body.setting_id is not None and db.get(CfgSetting, body.setting_id) is None:
        raise HTTPException(status_code=422, detail="Diese Einstellung gibt es nicht")
    entry = EvPlan(
        item_id=item.id,
        setting_id=body.setting_id,
        label=body.label.strip(),
        target_value=body.target_value,
        instruction=_clean(body.instruction),
        provisional=body.provisional,
        created_by=user.user_id,
    )
    db.add(entry)
    db.flush()
    if entry.provisional:
        # vorläufige Sperre gilt sofort als Soll-Wert der Einstellung
        apply_target(db, item, entry, provisional=True)
    write_audit(
        db,
        module=MODULE,
        action="umsetzung.geplant",
        user_id=user.user_id,
        object_type=OBJECT_TYPE,
        object_id=item.number,
        ip=request.client.host if request.client else None,
        details={
            "bezeichnung": entry.label,
            "vorlaeufig": entry.provisional,
            "ueberwacht": entry.setting_id is not None,
        },
    )
    return _after_plan_change(db, user, item, instance)


def _plan_entry(db: DbDep, item: EvItem, plan_id: int) -> EvPlan:
    entry = db.execute(
        select(EvPlan).where(EvPlan.id == plan_id, EvPlan.item_id == item.id).with_for_update()
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return entry


@router.delete("/items/{item_id}/plan/{plan_id}")
def remove_plan(
    request: Request, user: Technician, db: DbDep, item_id: ItemId, plan_id: PlanId
) -> ItemDetailOut:
    """Entfernt einen Eintrag aus der geplanten Umsetzung (nur IT)."""
    item, instance = _open_item(db, user, item_id)
    entry = _plan_entry(db, item, plan_id)
    label = entry.label
    db.delete(entry)
    write_audit(
        db,
        module=MODULE,
        action="umsetzung.entfernt",
        user_id=user.user_id,
        object_type=OBJECT_TYPE,
        object_id=item.number,
        ip=request.client.host if request.client else None,
        details={"bezeichnung": label},
    )
    return _after_plan_change(db, user, item, instance)


@router.post("/items/{item_id}/plan/{plan_id}/confirm")
def confirm_plan(
    request: Request,
    body: ConfirmIn,
    user: Technician,
    db: DbDep,
    item_id: ItemId,
    plan_id: PlanId,
) -> ItemDetailOut:
    """Bestätigt die Umsetzung eines Eintrags, den die Werkbank nicht selbst prüfen kann."""
    item, instance = _open_item(db, user, item_id)
    entry = _plan_entry(db, item, plan_id)
    if entry.setting_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Diese Einstellung prüft die Werkbank selbst über den Abruf aus dem Tenant",
        )
    entry.confirmed_by = user.user_id if body.done else None
    entry.confirmed_at = now_utc() if body.done else None
    write_audit(
        db,
        module=MODULE,
        action="umsetzung.bestaetigt" if body.done else "umsetzung.bestaetigung_zurueckgenommen",
        user_id=user.user_id,
        object_type=OBJECT_TYPE,
        object_id=item.number,
        ip=request.client.host if request.client else None,
        details={"bezeichnung": entry.label},
    )
    return _after_plan_change(db, user, item, instance)
