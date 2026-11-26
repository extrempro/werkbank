"""Erfolge: eigene Einstellungen und Stufen, Vitrine, Einblendung und Ansicht für andere.

Freiwillig und Standard aus. Ausschalten löscht alles Gesammelte. Andere sehen nur die
Gesamtstufe und die Vitrine (Kategorie und Stufe, keine Zahlen), und nur, wenn die Person
„Mitglieder meiner Bereiche“ gewählt hat und beide mindestens einen Bereich teilen.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets import achievements as ach
from werkbank.modules.tickets.access import (
    AccessDep,
    GroupSource,
    GroupSourceDep,
    TicketAccess,
    area_roles,
    not_found,
)
from werkbank.modules.tickets.models import TicketAchievementProfile

router = APIRouter(prefix="/api/tickets/erfolge")

Style = Literal["wappen", "neon", "fantasy", "pixel", "flach", "rang", "karte"]
NAMES = {c.id: c.name for c in ach.CATEGORIES} | {ach.ALLROUNDER: "Allrounder"}


class CategoryOut(BaseModel):
    id: str
    name: str
    count: int
    level: int
    # Schwelle der erreichten Stufe und der nächsten (None bei Stufe 30)
    current_at: int
    next_at: int | None


class LevelOut(BaseModel):
    id: str
    name: str
    level: int


class MeOut(BaseModel):
    enabled: bool
    audience: Literal["me", "areas"]
    toast: bool
    style: Style
    showcase: list[str]
    categories: list[CategoryOut]
    allrounder: int
    # Je Rang, wie viele Kategorien ihn erreicht haben (Meisterkranz bei 6)
    wreaths: list[int]
    # Summe der Stufen aller Kategorien
    total: int
    # Neue Stufen seit dem letzten „gesehen“ (nur mit eingeschalteter Einblendung)
    new: list[LevelOut]


class SettingsIn(BaseModel):
    enabled: bool
    audience: Literal["me", "areas"] = "me"
    toast: bool = True
    style: Style = "wappen"


class ShowcaseIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("ids")
    @classmethod
    def _known(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Jeder Erfolg nur einmal.")
        if any(v not in NAMES for v in value):
            raise ValueError("Unbekannter Erfolg.")
        return value


class PeekOut(BaseModel):
    total: int
    showcase: list[LevelOut]


def _oid(access: TicketAccess) -> str:
    if not access.oid or not access.visible_areas:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Erfolge gibt es nur für Mitglieder eines Ticket-Bereichs.",
        )
    return access.oid


def _profile(db: Session, oid: str) -> TicketAchievementProfile:
    found = db.get(TicketAchievementProfile, oid)
    if found is None:
        found = TicketAchievementProfile(
            oid=oid, enabled=False, audience="me", toast=True, style="wappen", showcase=[], seen={}
        )
        db.add(found)
    return found


def _all_levels(db: Session, oid: str) -> dict[str, int]:
    levels = ach.levels(db, oid)
    return levels | {ach.ALLROUNDER: ach.allrounder(levels)}


def _me(db: Session, profile: TicketAchievementProfile) -> MeOut:
    counts = ach.counts(db, profile.oid) if profile.enabled else dict.fromkeys(ach.CATEGORY_IDS, 0)
    levels = {c: ach.level_of(c, n) for c, n in counts.items()}
    every = levels | {ach.ALLROUNDER: ach.allrounder(levels)}
    seen = profile.seen or {}
    new = (
        [
            LevelOut(id=key, name=NAMES[key], level=lv)
            for key, lv in every.items()
            if lv > int(seen.get(key, 0))
        ]
        if profile.enabled and profile.toast
        else []
    )
    categories = []
    for c in ach.CATEGORIES:
        steps = ach.THRESHOLDS[c.id]
        lv = levels[c.id]
        categories.append(
            CategoryOut(
                id=c.id,
                name=c.name,
                count=counts[c.id],
                level=lv,
                current_at=steps[lv],
                next_at=steps[lv + 1] if lv < ach.LEVELS else None,
            )
        )
    return MeOut(
        enabled=profile.enabled,
        audience="areas" if profile.audience == "areas" else "me",
        toast=profile.toast,
        style=profile.style if profile.style in ach.STYLES else "wappen",  # type: ignore[arg-type]
        showcase=[s for s in (profile.showcase or []) if every.get(s, 0) > 0],
        categories=categories,
        allrounder=every[ach.ALLROUNDER],
        wreaths=ach.wreaths(levels),
        total=sum(levels.values()),
        new=new,
    )


@router.get("")
def read_me(access: AccessDep, db: DbDep) -> MeOut:
    """Eigene Erfolge und Einstellungen (ausgeschaltet: alles 0)."""
    oid = _oid(access)
    profile = db.get(TicketAchievementProfile, oid) or TicketAchievementProfile(
        oid=oid, enabled=False, audience="me", toast=True, style="wappen", showcase=[], seen={}
    )
    return _me(db, profile)


@router.put("")
def save_settings(body: SettingsIn, access: AccessDep, db: DbDep) -> MeOut:
    """Ein- und ausschalten, Sichtbarkeit, Einblendung und Stil. Ausschalten löscht alles."""
    oid = _oid(access)
    profile = _profile(db, oid)
    if body.enabled and not profile.enabled:
        profile.enabled_at = now_utc()
        profile.seen = {}
    if not body.enabled and profile.enabled:
        ach.forget(db, oid)
        profile.showcase = []
        profile.seen = {}
        profile.enabled_at = None
    profile.enabled = body.enabled
    profile.audience = body.audience
    profile.toast = body.toast
    profile.style = body.style
    db.commit()
    return _me(db, profile)


@router.put("/vitrine")
def save_showcase(body: ShowcaseIn, access: AccessDep, db: DbDep) -> MeOut:
    """Bis zu drei erreichte Erfolge für die Vitrine."""
    oid = _oid(access)
    profile = _profile(db, oid)
    if not profile.enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Erfolge sind ausgeschaltet."
        )
    every = _all_levels(db, oid)
    if any(every.get(i, 0) == 0 for i in body.ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="In die Vitrine kommen nur erreichte Erfolge.",
        )
    profile.showcase = body.ids
    db.commit()
    return _me(db, profile)


@router.post("/gesehen")
def mark_seen(access: AccessDep, db: DbDep) -> MeOut:
    """Neue Stufen wurden angezeigt: Einblendung bis zur nächsten Stufe still."""
    oid = _oid(access)
    profile = _profile(db, oid)
    if profile.enabled:
        profile.seen = _all_levels(db, oid)
        db.commit()
    return _me(db, profile)


def _shares_area(
    db: Session, settings: Settings, source: GroupSource, access: TicketAccess, oid: str
) -> bool:
    theirs = set(area_roles(db, settings, source, oid))
    return bool(theirs & set(access.visible_areas))


@router.get("/personen/{oid}")
def peek(
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
    source: GroupSourceDep,
    oid: str = Path(min_length=1, max_length=64),
) -> PeekOut:
    """Vitrine einer anderen Person: nur bei „Mitglieder meiner Bereiche“ und gemeinsamem
    Bereich; sonst 404 (auch ob die Person Erfolge nutzt, bleibt verborgen)."""
    me = _oid(access)
    oid = oid.lower()
    profile = db.get(TicketAchievementProfile, oid)
    visible = profile is not None and profile.enabled and profile.audience == "areas"
    if oid != me and not (visible and _shares_area(db, settings, source, access, oid)):
        raise not_found()
    if profile is None or not profile.enabled:
        raise not_found()
    every = _all_levels(db, oid)
    return PeekOut(
        total=sum(v for k, v in every.items() if k != ach.ALLROUNDER),
        showcase=[
            LevelOut(id=s, name=NAMES[s], level=every[s])
            for s in (profile.showcase or [])
            if every.get(s, 0) > 0
        ],
    )
