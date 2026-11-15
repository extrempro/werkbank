"""API für Empfehlungen aus Microsoft Secure Score und ihre Zuordnung zu Einstellungen."""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.m365_config.models import (
    CfgRecommendation,
    CfgRecommendationLink,
    CfgSetting,
)

router = APIRouter(prefix="/api/m365-config")

Reader = Annotated[CurrentUser, Depends(require_roles(Role.CONFIG_READER, Role.CONFIG_REVIEWER))]
Reviewer = Annotated[CurrentUser, Depends(require_roles(Role.CONFIG_REVIEWER))]

MODULE = "m365_config"
MAX_LINKS = 200
RecommendationId = Annotated[int, Path(ge=1)]


class RecommendationOut(BaseModel):
    id: int
    control_id: str
    title: str
    category: str | None
    service: str | None
    user_impact: str | None
    implementation_cost: str | None
    rank: int | None
    score: float | None
    max_score: float
    # Volle Punktzahl erreicht
    fulfilled: bool
    status_text: str | None
    deprecated: bool
    active: bool
    linked_settings: int


class RecommendationListOut(BaseModel):
    # False: Der Abruf ist in dieser Installation nicht eingeschaltet.
    enabled: bool
    fetched_at: datetime | None
    score: float
    max_score: float
    open_count: int
    fulfilled_count: int
    entries: list[RecommendationOut]


class LinkedSettingOut(BaseModel):
    id: int
    path: str
    workload: str
    object_name: str | None
    property: str
    active: bool


class RecommendationDetailOut(BaseModel):
    recommendation: RecommendationOut
    remediation: str | None
    action_url: str | None
    action_type: str | None
    fetched_at: datetime
    settings: list[LinkedSettingOut]


class LinkIn(BaseModel):
    setting_id: int = Field(ge=1)


def is_fulfilled(row: CfgRecommendation) -> bool:
    return row.score is not None and row.max_score > 0 and row.score >= row.max_score


def recommendation_out(row: CfgRecommendation, linked: int = 0) -> RecommendationOut:
    return RecommendationOut(
        id=row.id,
        control_id=row.control_id,
        title=row.title,
        category=row.category,
        service=row.service,
        user_impact=row.user_impact,
        implementation_cost=row.implementation_cost,
        rank=row.rank,
        score=row.score,
        max_score=row.max_score,
        fulfilled=is_fulfilled(row),
        status_text=row.status_text,
        deprecated=row.deprecated,
        active=row.active,
        linked_settings=linked,
    )


def _link_counts(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(CfgRecommendationLink.recommendation_id, func.count()).group_by(
            CfgRecommendationLink.recommendation_id
        )
    ).all()
    return {int(row[0]): int(row[1]) for row in rows}


def _get(db: Session, recommendation_id: int) -> CfgRecommendation:
    row: CfgRecommendation | None = db.get(CfgRecommendation, recommendation_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return row


def _detail(db: Session, row: CfgRecommendation) -> RecommendationDetailOut:
    settings = db.scalars(
        select(CfgSetting)
        .join(CfgRecommendationLink, CfgRecommendationLink.setting_id == CfgSetting.id)
        .where(CfgRecommendationLink.recommendation_id == row.id)
        .order_by(CfgSetting.path)
    ).all()
    return RecommendationDetailOut(
        recommendation=recommendation_out(row, len(settings)),
        remediation=row.remediation,
        action_url=row.action_url,
        action_type=row.action_type,
        fetched_at=row.fetched_at,
        settings=[
            LinkedSettingOut(
                id=setting.id,
                path=setting.path,
                workload=setting.workload,
                object_name=setting.object_name,
                property=setting.property,
                active=setting.active,
            )
            for setting in settings
        ],
    )


@router.get("/recommendations")
def list_recommendations(
    user: Reader,
    db: DbDep,
    settings: SettingsDep,
    view: Annotated[Literal["offen", "erfuellt", "alle"], Query()] = "offen",
) -> RecommendationListOut:
    """Empfehlungen von Microsoft Secure Score. Offene zuerst nach Microsofts Rangfolge."""
    rows = db.scalars(
        select(CfgRecommendation)
        .where(CfgRecommendation.active, ~CfgRecommendation.deprecated)
        .order_by(CfgRecommendation.rank.asc().nulls_last(), CfgRecommendation.title)
    ).all()
    counts = _link_counts(db)
    fulfilled = [row for row in rows if is_fulfilled(row)]
    shown = (
        rows
        if view == "alle"
        else fulfilled
        if view == "erfuellt"
        else [row for row in rows if not is_fulfilled(row)]
    )
    return RecommendationListOut(
        enabled=settings.secure_score_enabled and settings.collector_configured,
        fetched_at=max((row.fetched_at for row in rows), default=None),
        score=sum(row.score or 0.0 for row in rows),
        max_score=sum(row.max_score for row in rows),
        open_count=len(rows) - len(fulfilled),
        fulfilled_count=len(fulfilled),
        entries=[recommendation_out(row, counts.get(row.id, 0)) for row in shown],
    )


@router.get("/recommendations/{recommendation_id}")
def get_recommendation(
    user: Reader, db: DbDep, recommendation_id: RecommendationId
) -> RecommendationDetailOut:
    """Eine Empfehlung mit Hinweisen zur Umsetzung und den zugeordneten Einstellungen."""
    return _detail(db, _get(db, recommendation_id))


@router.post("/recommendations/{recommendation_id}/links")
def add_link(
    request: Request,
    body: LinkIn,
    user: Reviewer,
    db: DbDep,
    recommendation_id: RecommendationId,
) -> RecommendationDetailOut:
    """Ordnet der Empfehlung eine Einstellung zu."""
    row = _get(db, recommendation_id)
    setting = db.get(CfgSetting, body.setting_id)
    if setting is None:
        raise HTTPException(status_code=422, detail="Diese Einstellung gibt es nicht.")
    key = (recommendation_id, body.setting_id)
    if db.get(CfgRecommendationLink, key) is None:
        existing = db.scalar(
            select(func.count())
            .select_from(CfgRecommendationLink)
            .where(CfgRecommendationLink.recommendation_id == recommendation_id)
        )
        if int(existing or 0) >= MAX_LINKS:
            raise HTTPException(
                status_code=422,
                detail=f"Höchstens {MAX_LINKS} Einstellungen je Empfehlung.",
            )
        db.add(
            CfgRecommendationLink(
                recommendation_id=recommendation_id,
                setting_id=body.setting_id,
                created_by=user.user_id,
                created_at=now_utc(),
            )
        )
        write_audit(
            db,
            module=MODULE,
            action="empfehlung.zugeordnet",
            user_id=user.user_id,
            object_type="empfehlung",
            object_id=row.control_id,
            ip=request.client.host if request.client else None,
            details={"einstellung": setting.path},
        )
        db.commit()
    return _detail(db, row)


@router.delete("/recommendations/{recommendation_id}/links/{setting_id}")
def remove_link(
    request: Request,
    user: Reviewer,
    db: DbDep,
    recommendation_id: RecommendationId,
    setting_id: Annotated[int, Path(ge=1)],
) -> RecommendationDetailOut:
    """Löst die Zuordnung einer Einstellung."""
    row = _get(db, recommendation_id)
    link = db.get(CfgRecommendationLink, (recommendation_id, setting_id))
    if link is not None:
        setting = db.get(CfgSetting, setting_id)
        db.delete(link)
        write_audit(
            db,
            module=MODULE,
            action="empfehlung.zuordnung_geloest",
            user_id=user.user_id,
            object_type="empfehlung",
            object_id=row.control_id,
            ip=request.client.host if request.client else None,
            details={"einstellung": setting.path if setting else str(setting_id)},
        )
        db.commit()
    return _detail(db, row)


def recommendations_for_setting(db: Session, setting_id: int) -> list[RecommendationOut]:
    """Empfehlungen, die dieser Einstellung zugeordnet sind (für die Detailseite)."""
    rows = db.scalars(
        select(CfgRecommendation)
        .join(
            CfgRecommendationLink,
            CfgRecommendationLink.recommendation_id == CfgRecommendation.id,
        )
        .where(CfgRecommendationLink.setting_id == setting_id, CfgRecommendation.active)
        .order_by(CfgRecommendation.rank.asc().nulls_last(), CfgRecommendation.title)
    ).all()
    return [recommendation_out(row) for row in rows]
