"""API des Moduls M365-Konfiguration: Einstellungen, Verlauf, Änderungen, Abrufe (spec.md 7)."""

import json
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, func, or_, select

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import Job, JobStatus, User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.m365_config.collector import (
    MODULE,
    MONTHLY_RESOURCE_LIMIT,
    resources_used_this_month,
)
from werkbank.modules.m365_config.jobs import COLLECT
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingMeta,
    CfgSettingMetaHistory,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeStatus,
    Criticality,
)
from werkbank.modules.m365_config.versioning import same_value
from werkbank.worker.jobs import enqueue

router = APIRouter(prefix="/api/m365-config")

Reader = Annotated[CurrentUser, Depends(require_roles(Role.CONFIG_READER, Role.CONFIG_REVIEWER))]
Reviewer = Annotated[CurrentUser, Depends(require_roles(Role.CONFIG_REVIEWER))]
Admin = Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))]

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0, le=1_000_000)]

COMMENT_MAX_LENGTH = 2000
TEXT_MAX_LENGTH = 4000
TARGET_MAX_LENGTH = 20_000
REVIEW_MAX_ITEMS = 200


class SnapshotOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    source_status: dict[str, Any]
    change_count: int
    resource_count: int


class OverviewOut(BaseModel):
    collector_configured: bool
    collect_pending: bool
    last_snapshot: SnapshotOut | None
    settings_total: int
    open_changes: int
    deviations: int
    resources_this_month: int
    monthly_limit: int
    workloads: list[str]


class SettingOut(BaseModel):
    id: int
    path: str
    workload: str
    area: str
    object_id: str
    object_name: str | None
    property: str
    source: str
    active: bool
    value: Any
    valid_from: datetime | None
    criticality: str | None
    deviates: bool


class MetaOut(BaseModel):
    description: str | None
    reasoning: str | None
    criticality: str | None
    owner: str | None
    learn_url: str | None
    target_set: bool
    target_value: Any
    target_source: str | None


class MetaHistoryOut(BaseModel):
    id: int
    field: str
    old_value: Any
    new_value: Any
    user: str | None
    changed_at: datetime


class MetaIn(BaseModel):
    """Nur die mitgeschickten Felder werden geändert."""

    description: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    reasoning: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    criticality: Literal["niedrig", "mittel", "hoch"] | None = None
    owner: str | None = Field(default=None, max_length=256)
    learn_url: str | None = Field(default=None, max_length=500)
    target_set: bool | None = None
    target_value: Any = None

    @field_validator("learn_url")
    @classmethod
    def _only_https(cls, value: str | None) -> str | None:
        if value and value.strip() and not value.strip().startswith("https://"):
            raise ValueError("Der Link muss mit https:// beginnen")
        return value


class SettingListOut(BaseModel):
    entries: list[SettingOut]
    has_more: bool


class VersionOut(BaseModel):
    id: int
    value: Any
    valid_from: datetime
    valid_to: datetime | None


class ChangeOut(BaseModel):
    id: int
    setting_id: int
    path: str
    object_name: str | None
    property: str
    kind: str
    status: str
    detected_at: datetime
    old_value: Any
    new_value: Any
    changed_by: str | None
    reviewed_by: str | None
    reviewed_at: datetime | None
    comment: str | None


class ChangeListOut(BaseModel):
    entries: list[ChangeOut]
    has_more: bool


class SettingDetailOut(BaseModel):
    setting: SettingOut
    meta: MetaOut
    meta_history: list[MetaHistoryOut]
    versions: list[VersionOut]
    changes: list[ChangeOut]


class ReviewIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=REVIEW_MAX_ITEMS)
    status: Literal["offen", "gewollt", "ungewollt"]
    comment: str | None = Field(default=None, max_length=COMMENT_MAX_LENGTH)


class ReviewOut(BaseModel):
    updated: int


class CollectOut(BaseModel):
    queued: bool


def _snapshot_out(snapshot: CfgSnapshot) -> SnapshotOut:
    return SnapshotOut(
        id=snapshot.id,
        started_at=snapshot.started_at,
        finished_at=snapshot.finished_at,
        status=snapshot.status,
        source_status=snapshot.source_status,
        change_count=snapshot.change_count,
        resource_count=snapshot.resource_count,
    )


def _deviates(
    setting: CfgSetting, version: CfgSettingVersion | None, meta: CfgSettingMeta | None
) -> bool:
    """Soll/Ist (spec.md 7.6): Es gibt einen Soll-Wert und der aktuelle Wert weicht davon ab."""
    if meta is None or not meta.target_set or not setting.active or version is None:
        return False
    return not same_value(version.value, meta.target_value)


def _meta_out(meta: CfgSettingMeta | None) -> MetaOut:
    return MetaOut(
        description=meta.description if meta else None,
        reasoning=meta.reasoning if meta else None,
        criticality=meta.criticality if meta else None,
        owner=meta.owner if meta else None,
        learn_url=meta.learn_url if meta else None,
        target_set=meta.target_set if meta else False,
        target_value=meta.target_value if meta and meta.target_set else None,
        target_source=meta.target_source if meta and meta.target_set else None,
    )


def _setting_out(
    setting: CfgSetting, version: CfgSettingVersion | None, meta: CfgSettingMeta | None
) -> SettingOut:
    return SettingOut(
        id=setting.id,
        path=setting.path,
        workload=setting.workload,
        area=setting.area,
        object_id=setting.object_id,
        object_name=setting.object_name,
        property=setting.property,
        source=setting.source,
        active=setting.active,
        value=version.value if version else None,
        valid_from=version.valid_from if version else None,
        criticality=meta.criticality if meta else None,
        deviates=_deviates(setting, version, meta),
    )


# Bedingung in SQL, passend zu _deviates (jsonb vergleicht unabhängig von der Schlüsselfolge)
DEVIATION = and_(
    CfgSetting.active,
    CfgSettingMeta.target_set,
    CfgSettingVersion.value != CfgSettingMeta.target_value,
)
CURRENT_VERSION = and_(
    CfgSettingVersion.setting_id == CfgSetting.id, CfgSettingVersion.valid_to.is_(None)
)


def _change_out(change: CfgChange, setting: CfgSetting, reviewer: str | None) -> ChangeOut:
    return ChangeOut(
        id=change.id,
        setting_id=setting.id,
        path=setting.path,
        object_name=setting.object_name,
        property=setting.property,
        kind=change.kind,
        status=change.status,
        detected_at=change.detected_at,
        old_value=change.old_value,
        new_value=change.new_value,
        changed_by=change.changed_by,
        reviewed_by=reviewer,
        reviewed_at=change.reviewed_at,
        comment=change.comment,
    )


def _collect_pending(db: DbDep) -> bool:
    pending = db.scalar(
        select(Job.id)
        .where(
            Job.type == COLLECT,
            Job.status.in_((JobStatus.PLANNED, JobStatus.RUNNING)),
            Job.scheduled_at <= now_utc(),
        )
        .limit(1)
    )
    return pending is not None


@router.get("/overview")
def overview(user: Reader, db: DbDep, settings: SettingsDep) -> OverviewOut:
    """Stand des Moduls: letzter Abruf, offene Änderungen, Verbrauch des Monatskontingents."""
    last = db.scalars(select(CfgSnapshot).order_by(CfgSnapshot.id.desc()).limit(1)).first()
    workloads = db.scalars(select(CfgSetting.workload).distinct().order_by(CfgSetting.workload))
    return OverviewOut(
        collector_configured=settings.collector_configured,
        collect_pending=_collect_pending(db),
        last_snapshot=_snapshot_out(last) if last else None,
        settings_total=db.scalar(
            select(func.count()).select_from(CfgSetting).where(CfgSetting.active)
        )
        or 0,
        open_changes=db.scalar(
            select(func.count()).select_from(CfgChange).where(CfgChange.status == ChangeStatus.OPEN)
        )
        or 0,
        deviations=db.scalar(
            select(func.count())
            .select_from(CfgSetting)
            .join(CfgSettingVersion, CURRENT_VERSION)
            .join(CfgSettingMeta, CfgSettingMeta.setting_id == CfgSetting.id)
            .where(DEVIATION)
        )
        or 0,
        resources_this_month=resources_used_this_month(db, now_utc()),
        monthly_limit=MONTHLY_RESOURCE_LIMIT,
        workloads=list(workloads),
    )


@router.post("/collect", status_code=status.HTTP_202_ACCEPTED)
def start_collect(request: Request, user: Admin, db: DbDep, settings: SettingsDep) -> CollectOut:
    """Stößt einen Abruf außer der Reihe an (nur Admin). Der Worker führt ihn aus."""
    if not settings.collector_configured:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Der Abruf ist nicht eingerichtet"
        )
    if _collect_pending(db):
        return CollectOut(queued=False)
    # Ein für später geplanter Lauf wird vorgezogen, sonst entsteht ein neuer Auftrag.
    planned = db.scalars(
        select(Job).where(Job.type == COLLECT, Job.status == JobStatus.PLANNED).limit(1)
    ).first()
    if planned is not None:
        planned.scheduled_at = now_utc()
    else:
        enqueue(db, COLLECT)
    write_audit(
        db,
        module=MODULE,
        action="abruf.angestossen",
        user_id=user.user_id,
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return CollectOut(queued=True)


@router.get("/snapshots")
def list_snapshots(user: Reader, db: DbDep, limit: Limit = 50) -> list[SnapshotOut]:
    """Abrufe, neueste zuerst."""
    rows = db.scalars(select(CfgSnapshot).order_by(CfgSnapshot.id.desc()).limit(limit)).all()
    return [_snapshot_out(row) for row in rows]


@router.get("/settings")
def list_settings(
    user: Reader,
    db: DbDep,
    search: Annotated[str | None, Query(max_length=200)] = None,
    workload: Annotated[str | None, Query(max_length=64)] = None,
    include_removed: bool = False,
    only_deviating: bool = False,
    limit: Limit = 50,
    offset: Offset = 0,
) -> SettingListOut:
    """Einstellungen mit ihrem aktuellen Wert, sortiert nach Pfad."""
    query = (
        select(CfgSetting, CfgSettingVersion, CfgSettingMeta)
        .outerjoin(CfgSettingVersion, CURRENT_VERSION)
        .outerjoin(CfgSettingMeta, CfgSettingMeta.setting_id == CfgSetting.id)
    )
    if only_deviating:
        query = query.where(DEVIATION)
    if not include_removed:
        query = query.where(CfgSetting.active)
    if workload:
        query = query.where(CfgSetting.workload == workload)
    if search:
        query = query.where(
            or_(
                CfgSetting.path.icontains(search, autoescape=True),
                CfgSetting.object_name.icontains(search, autoescape=True),
            )
        )
    rows = db.execute(query.order_by(CfgSetting.path).limit(limit + 1).offset(offset)).all()
    entries = [_setting_out(row[0], row[1], row[2]) for row in rows[:limit]]
    return SettingListOut(entries=entries, has_more=len(rows) > limit)


def _changes_query() -> Any:
    return (
        select(CfgChange, CfgSetting, User.display_name)
        .join(CfgSetting, CfgSetting.id == CfgChange.setting_id)
        .outerjoin(User, User.id == CfgChange.reviewed_by)
    )


@router.get("/settings/{setting_id}")
def get_setting(
    user: Reader, db: DbDep, setting_id: Annotated[int, Path(ge=1)]
) -> SettingDetailOut:
    """Eine Einstellung mit Verlauf ihrer Werte und den erkannten Änderungen."""
    setting = db.get(CfgSetting, setting_id)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    versions = db.scalars(
        select(CfgSettingVersion)
        .where(CfgSettingVersion.setting_id == setting_id)
        .order_by(CfgSettingVersion.id.desc())
        .limit(200)
    ).all()
    current = next((version for version in versions if version.valid_to is None), None)
    changes = db.execute(
        _changes_query()
        .where(CfgChange.setting_id == setting_id)
        .order_by(CfgChange.id.desc())
        .limit(200)
    ).all()
    meta = db.get(CfgSettingMeta, setting_id)
    history = db.execute(
        select(CfgSettingMetaHistory, User.display_name)
        .outerjoin(User, User.id == CfgSettingMetaHistory.user_id)
        .where(CfgSettingMetaHistory.setting_id == setting_id)
        .order_by(CfgSettingMetaHistory.id.desc())
        .limit(200)
    ).all()
    return SettingDetailOut(
        setting=_setting_out(setting, current, meta),
        meta=_meta_out(meta),
        meta_history=[
            MetaHistoryOut(
                id=row[0].id,
                field=row[0].field,
                old_value=row[0].old_value,
                new_value=row[0].new_value,
                user=row[1],
                changed_at=row[0].changed_at,
            )
            for row in history
        ],
        versions=[
            VersionOut(
                id=version.id,
                value=version.value,
                valid_from=version.valid_from,
                valid_to=version.valid_to,
            )
            for version in versions
        ],
        changes=[_change_out(row[0], row[1], row[2]) for row in changes],
    )


@router.get("/changes")
def list_changes(
    user: Reader,
    db: DbDep,
    status_filter: Annotated[
        Literal["offen", "gewollt", "ungewollt"] | None, Query(alias="status")
    ] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> ChangeListOut:
    """Erkannte Änderungen, neueste zuerst."""
    query = _changes_query()
    if status_filter:
        query = query.where(CfgChange.status == status_filter)
    rows = db.execute(query.order_by(CfgChange.id.desc()).limit(limit + 1).offset(offset)).all()
    entries = [_change_out(row[0], row[1], row[2]) for row in rows[:limit]]
    return ChangeListOut(entries=entries, has_more=len(rows) > limit)


@router.post("/changes/review")
def review_changes(request: Request, body: ReviewIn, user: Reviewer, db: DbDep) -> ReviewOut:
    """Bewertet eine oder mehrere Änderungen mit einem gemeinsamen Kommentar (spec.md 7.4).

    Kommentarregeln: „ungewollt“ braucht immer einen Kommentar, „gewollt“ bei Kritikalität
    „Hoch“. „offen“ setzt eine Bewertung zurück.
    """
    comment = (body.comment or "").strip() or None
    if body.status == "ungewollt" and comment is None:
        raise HTTPException(
            status_code=422,
            detail="Für „ungewollt“ ist ein Kommentar nötig",
        )
    ids = sorted(set(body.ids))
    if body.status == "gewollt" and comment is None:
        critical = db.scalar(
            select(func.count())
            .select_from(CfgChange)
            .join(CfgSettingMeta, CfgSettingMeta.setting_id == CfgChange.setting_id)
            .where(CfgChange.id.in_(ids), CfgSettingMeta.criticality == Criticality.HIGH)
        )
        if critical:
            raise HTTPException(
                status_code=422,
                detail="Bei Kritikalität „Hoch“ ist auch für „gewollt“ ein Kommentar nötig",
            )
    changes = db.scalars(select(CfgChange).where(CfgChange.id.in_(ids)).with_for_update()).all()
    if len(changes) != len(ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Änderung nicht gefunden")
    now = now_utc()
    reset = body.status == "offen"
    for change in changes:
        previous = change.status
        change.status = body.status
        change.comment = None if reset else comment
        change.reviewed_by = None if reset else user.user_id
        change.reviewed_at = None if reset else now
        write_audit(
            db,
            module=MODULE,
            action="aenderung.zurueckgesetzt" if reset else "aenderung.bewertet",
            user_id=user.user_id,
            object_type="change",
            object_id=str(change.id),
            ip=request.client.host if request.client else None,
            details={"vorher": previous, "bewertung": body.status, "kommentar": bool(comment)},
        )
    db.commit()
    return ReviewOut(updated=len(changes))


TEXT_FIELDS = ("description", "reasoning", "criticality", "owner", "learn_url")
# Namen der Felder im Verlauf und im Audit-Log
FIELD_NAMES = {
    "description": "beschreibung",
    "reasoning": "begruendung",
    "criticality": "kritikalitaet",
    "owner": "verantwortlich",
    "learn_url": "learn_url",
}
TARGET_FIELD = "soll_wert"


@router.put("/settings/{setting_id}/meta")
def update_meta(
    request: Request,
    body: MetaIn,
    user: Reviewer,
    db: DbDep,
    setting_id: Annotated[int, Path(ge=1)],
) -> MetaOut:
    """Pflegt Beschreibung, Begründung, Kritikalität, Verantwortliche, Link und Soll-Wert.

    Jedes geänderte Feld erhält einen Eintrag im Verlauf; die Änderung steht im Audit-Log.
    """
    setting = db.get(CfgSetting, setting_id, with_for_update=True)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    meta = db.get(CfgSettingMeta, setting_id)
    if meta is None:
        meta = CfgSettingMeta(setting_id=setting_id, target_set=False, target_value=None)
        db.add(meta)
    changed: list[str] = []

    def record(field: str, old: Any, new: Any) -> None:
        db.add(
            CfgSettingMetaHistory(
                setting_id=setting_id,
                field=field,
                old_value=old,
                new_value=new,
                user_id=user.user_id,
                changed_at=now_utc(),
            )
        )
        changed.append(field)

    sent = body.model_fields_set
    for name in TEXT_FIELDS:
        if name not in sent:
            continue
        raw = getattr(body, name)
        new = raw.strip() or None if isinstance(raw, str) else None
        old = getattr(meta, name)
        if new != old:
            setattr(meta, name, new)
            record(FIELD_NAMES[name], old, new)

    if "target_set" in sent or "target_value" in sent:
        new_set = meta.target_set if body.target_set is None else body.target_set
        new_value = body.target_value if "target_value" in sent else meta.target_value
        if not new_set:
            new_value = None
        elif len(json.dumps(new_value)) > TARGET_MAX_LENGTH:
            raise HTTPException(status_code=422, detail="Der Soll-Wert ist zu groß")
        before = {"wert": meta.target_value} if meta.target_set else None
        after = {"wert": new_value} if new_set else None
        if (before is None) != (after is None) or not same_value(before, after):
            meta.target_set = new_set
            meta.target_value = new_value
            meta.target_source = "manuell" if new_set else None
            record(TARGET_FIELD, before, after)

    if changed:
        write_audit(
            db,
            module=MODULE,
            action="metadaten.geaendert",
            user_id=user.user_id,
            object_type="setting",
            object_id=str(setting_id),
            ip=request.client.host if request.client else None,
            details={"felder": changed},
        )
    db.commit()
    return _meta_out(meta)
