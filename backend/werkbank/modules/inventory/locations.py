"""Standorte im IT-Bestand: Stadt, Standort, Gebäudeabschnitt, Etage und Raum.

Grundrisse sind Bilder (PNG, JPEG, WebP) je Etage. Räume liegen als Rechteck in Prozent des
Grundrisses darauf, damit sie bei jeder Bildgröße passen.
"""

import hashlib
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Request, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from werkbank.core.branding import ImageError
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.api import Editor, Reader, _audit, single_line
from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryFloor,
    InventoryFloorPlan,
    InventoryHardware,
    InventoryRoom,
    InventorySection,
    InventorySite,
)
from werkbank.modules.inventory.plans import inspect_plan

router = APIRouter(prefix="/api/inventory")

ObjectId = Annotated[int, Path(ge=1)]
# Kleinstes Rechteck eines Raums in Prozent
ROOM_MIN = 1.0


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


# --- Schemas ------------------------------------------------------------------------------


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def plain(cls, value: str) -> str:
        value = single_line(value)
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


class SiteIn(NameIn):
    city_id: int = Field(ge=1)


class SectionIn(NameIn):
    site_id: int = Field(ge=1)


class FloorIn(NameIn):
    section_id: int = Field(ge=1)
    position: int = Field(default=0, ge=-20, le=200)


class RoomIn(NameIn):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    w: float = Field(ge=ROOM_MIN, le=100)
    h: float = Field(ge=ROOM_MIN, le=100)

    @model_validator(mode="after")
    def inside(self) -> "RoomIn":
        # Kleine Rundungsfehler der Oberfläche zulassen
        if self.x + self.w > 100.01 or self.y + self.h > 100.01:
            raise ValueError("Der Raum muss ganz auf dem Grundriss liegen")
        return self


class RoomBrief(BaseModel):
    id: int
    name: str


class FloorBrief(BaseModel):
    id: int
    name: str
    position: int
    has_plan: bool
    rooms: list[RoomBrief]


class SectionNode(BaseModel):
    id: int
    name: str
    floors: list[FloorBrief]


class SiteNode(BaseModel):
    id: int
    name: str
    sections: list[SectionNode]


class CityNode(BaseModel):
    id: int
    name: str
    sites: list[SiteNode]


class LocationsOut(BaseModel):
    cities: list[CityNode]


class PlanOut(BaseModel):
    url: str
    width: int
    height: int


class RoomOut(BaseModel):
    id: int
    name: str
    x: float
    y: float
    w: float
    h: float
    hardware: int


class FloorOut(BaseModel):
    id: int
    name: str
    position: int
    section_id: int
    section: str
    site_id: int
    site: str
    city_id: int
    city: str
    plan: PlanOut | None
    rooms: list[RoomOut]


# --- Lesen -------------------------------------------------------------------------------


def plan_url(floor_id: int, etag: str) -> str:
    return f"/api/inventory/floors/{floor_id}/plan?v={etag}"


def locations(db: Session) -> LocationsOut:
    """Der ganze Baum mit Räumen (nur Name), sortiert nach Name bzw. Reihenfolge."""
    rooms: dict[int, list[RoomBrief]] = {}
    for room in db.scalars(
        select(InventoryRoom).order_by(func.lower(InventoryRoom.name), InventoryRoom.id)
    ).all():
        rooms.setdefault(room.floor_id, []).append(RoomBrief(id=room.id, name=room.name))
    planned = set(db.scalars(select(InventoryFloorPlan.floor_id)).all())
    floors: dict[int, list[FloorBrief]] = {}
    for floor in db.scalars(
        select(InventoryFloor).order_by(
            InventoryFloor.position, func.lower(InventoryFloor.name), InventoryFloor.id
        )
    ).all():
        floors.setdefault(floor.section_id, []).append(
            FloorBrief(
                id=floor.id,
                name=floor.name,
                position=floor.position,
                has_plan=floor.id in planned,
                rooms=rooms.get(floor.id, []),
            )
        )
    sections: dict[int, list[SectionNode]] = {}
    for section in db.scalars(
        select(InventorySection).order_by(func.lower(InventorySection.name), InventorySection.id)
    ).all():
        sections.setdefault(section.site_id, []).append(
            SectionNode(id=section.id, name=section.name, floors=floors.get(section.id, []))
        )
    sites: dict[int, list[SiteNode]] = {}
    for site in db.scalars(
        select(InventorySite).order_by(func.lower(InventorySite.name), InventorySite.id)
    ).all():
        sites.setdefault(site.city_id, []).append(
            SiteNode(id=site.id, name=site.name, sections=sections.get(site.id, []))
        )
    return LocationsOut(
        cities=[
            CityNode(id=city.id, name=city.name, sites=sites.get(city.id, []))
            for city in db.scalars(
                select(InventoryCity).order_by(func.lower(InventoryCity.name), InventoryCity.id)
            ).all()
        ]
    )


def floor_out(db: Session, floor: InventoryFloor) -> FloorOut:
    section = db.get(InventorySection, floor.section_id)
    site = db.get(InventorySite, section.site_id) if section else None
    city = db.get(InventoryCity, site.city_id) if site else None
    if section is None or site is None or city is None:
        raise _not_found()
    plan = db.execute(
        select(InventoryFloorPlan.etag, InventoryFloorPlan.width, InventoryFloorPlan.height).where(
            InventoryFloorPlan.floor_id == floor.id
        )
    ).first()
    counts = dict(
        db.execute(
            select(InventoryHardware.room_id, func.count())
            .join(InventoryRoom, InventoryRoom.id == InventoryHardware.room_id)
            .where(InventoryRoom.floor_id == floor.id)
            .group_by(InventoryHardware.room_id)
        ).all()
    )
    rooms = db.scalars(
        select(InventoryRoom)
        .where(InventoryRoom.floor_id == floor.id)
        .order_by(func.lower(InventoryRoom.name), InventoryRoom.id)
    ).all()
    return FloorOut(
        id=floor.id,
        name=floor.name,
        position=floor.position,
        section_id=section.id,
        section=section.name,
        site_id=site.id,
        site=site.name,
        city_id=city.id,
        city=city.name,
        plan=PlanOut(url=plan_url(floor.id, plan[0]), width=plan[1], height=plan[2])
        if plan
        else None,
        rooms=[
            RoomOut(
                id=room.id,
                name=room.name,
                x=room.x,
                y=room.y,
                w=room.w,
                h=room.h,
                hardware=counts.get(room.id, 0),
            )
            for room in rooms
        ],
    )


@router.get("/locations")
def read_locations(user: Reader, db: DbDep) -> LocationsOut:
    return locations(db)


def _floor(db: Session, floor_id: int) -> InventoryFloor:
    row = db.get(InventoryFloor, floor_id)
    if row is None:
        raise _not_found()
    return row


@router.get("/floors/{floor_id}")
def read_floor(floor_id: ObjectId, user: Reader, db: DbDep) -> FloorOut:
    return floor_out(db, _floor(db, floor_id))


@router.get("/floors/{floor_id}/plan")
def read_plan(floor_id: ObjectId, user: Reader, db: DbDep) -> Response:
    """Das Bild des Grundrisses, nur für Rollen des IT-Bestands."""
    plan = db.get(InventoryFloorPlan, floor_id)
    if plan is None:
        raise _not_found()
    return Response(
        content=plan.data,
        media_type=plan.content_type,
        headers={
            # Grundrisse sind intern: nicht im Browser-Speicher ablegen.
            "Cache-Control": "no-store",
            "ETag": f'"{plan.etag}"',
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


# --- Struktur pflegen ---------------------------------------------------------------------


def _taken(db: Session, query: Select[Any]) -> None:
    if db.scalars(query.limit(1)).first() is not None:
        raise _conflict("Diesen Namen gibt es hier schon.")


@router.post("/cities", status_code=status.HTTP_201_CREATED)
def create_city(request: Request, body: NameIn, user: Editor, db: DbDep) -> LocationsOut:
    _taken(db, select(InventoryCity).where(func.lower(InventoryCity.name) == body.name.casefold()))
    row = InventoryCity(name=body.name)
    db.add(row)
    db.flush()
    _audit(db, request, user, "stadt_angelegt", "stadt", row.id, {"name": row.name})
    db.commit()
    return locations(db)


@router.put("/cities/{city_id}")
def update_city(
    request: Request, city_id: ObjectId, body: NameIn, user: Editor, db: DbDep
) -> LocationsOut:
    row = db.get(InventoryCity, city_id)
    if row is None:
        raise _not_found()
    _taken(
        db,
        select(InventoryCity).where(
            func.lower(InventoryCity.name) == body.name.casefold(), InventoryCity.id != row.id
        ),
    )
    before, row.name = row.name, body.name
    _audit(
        db,
        request,
        user,
        "stadt_geaendert",
        "stadt",
        row.id,
        {"vorher": before, "nachher": row.name},
    )
    db.commit()
    return locations(db)


@router.delete("/cities/{city_id}")
def delete_city(request: Request, city_id: ObjectId, user: Editor, db: DbDep) -> LocationsOut:
    row = db.get(InventoryCity, city_id)
    if row is None:
        raise _not_found()
    if db.scalar(
        select(func.count()).select_from(InventorySite).where(InventorySite.city_id == row.id)
    ):
        raise _conflict("In dieser Stadt gibt es noch Standorte.")
    name = row.name
    db.delete(row)
    _audit(db, request, user, "stadt_geloescht", "stadt", city_id, {"name": name})
    db.commit()
    return locations(db)


@router.post("/sites", status_code=status.HTTP_201_CREATED)
def create_site(request: Request, body: SiteIn, user: Editor, db: DbDep) -> LocationsOut:
    if db.get(InventoryCity, body.city_id) is None:
        raise _not_found()
    _taken(
        db,
        select(InventorySite).where(
            InventorySite.city_id == body.city_id,
            func.lower(InventorySite.name) == body.name.casefold(),
        ),
    )
    row = InventorySite(city_id=body.city_id, name=body.name)
    db.add(row)
    db.flush()
    _audit(db, request, user, "standort_angelegt", "standort", row.id, {"name": row.name})
    db.commit()
    return locations(db)


@router.put("/sites/{site_id}")
def update_site(
    request: Request, site_id: ObjectId, body: NameIn, user: Editor, db: DbDep
) -> LocationsOut:
    row = db.get(InventorySite, site_id)
    if row is None:
        raise _not_found()
    _taken(
        db,
        select(InventorySite).where(
            InventorySite.city_id == row.city_id,
            func.lower(InventorySite.name) == body.name.casefold(),
            InventorySite.id != row.id,
        ),
    )
    before, row.name = row.name, body.name
    _audit(
        db,
        request,
        user,
        "standort_geaendert",
        "standort",
        row.id,
        {"vorher": before, "nachher": row.name},
    )
    db.commit()
    return locations(db)


@router.delete("/sites/{site_id}")
def delete_site(request: Request, site_id: ObjectId, user: Editor, db: DbDep) -> LocationsOut:
    row = db.get(InventorySite, site_id)
    if row is None:
        raise _not_found()
    if db.scalar(
        select(func.count()).select_from(InventorySection).where(InventorySection.site_id == row.id)
    ):
        raise _conflict("An diesem Standort gibt es noch Gebäudeabschnitte.")
    name = row.name
    db.delete(row)
    _audit(db, request, user, "standort_geloescht", "standort", site_id, {"name": name})
    db.commit()
    return locations(db)


@router.post("/sections", status_code=status.HTTP_201_CREATED)
def create_section(request: Request, body: SectionIn, user: Editor, db: DbDep) -> LocationsOut:
    if db.get(InventorySite, body.site_id) is None:
        raise _not_found()
    _taken(
        db,
        select(InventorySection).where(
            InventorySection.site_id == body.site_id,
            func.lower(InventorySection.name) == body.name.casefold(),
        ),
    )
    row = InventorySection(site_id=body.site_id, name=body.name)
    db.add(row)
    db.flush()
    _audit(db, request, user, "abschnitt_angelegt", "abschnitt", row.id, {"name": row.name})
    db.commit()
    return locations(db)


@router.put("/sections/{section_id}")
def update_section(
    request: Request, section_id: ObjectId, body: NameIn, user: Editor, db: DbDep
) -> LocationsOut:
    row = db.get(InventorySection, section_id)
    if row is None:
        raise _not_found()
    _taken(
        db,
        select(InventorySection).where(
            InventorySection.site_id == row.site_id,
            func.lower(InventorySection.name) == body.name.casefold(),
            InventorySection.id != row.id,
        ),
    )
    before, row.name = row.name, body.name
    _audit(
        db,
        request,
        user,
        "abschnitt_geaendert",
        "abschnitt",
        row.id,
        {"vorher": before, "nachher": row.name},
    )
    db.commit()
    return locations(db)


@router.delete("/sections/{section_id}")
def delete_section(request: Request, section_id: ObjectId, user: Editor, db: DbDep) -> LocationsOut:
    row = db.get(InventorySection, section_id)
    if row is None:
        raise _not_found()
    if db.scalar(
        select(func.count()).select_from(InventoryFloor).where(InventoryFloor.section_id == row.id)
    ):
        raise _conflict("In diesem Gebäudeabschnitt gibt es noch Etagen.")
    name = row.name
    db.delete(row)
    _audit(db, request, user, "abschnitt_geloescht", "abschnitt", section_id, {"name": name})
    db.commit()
    return locations(db)


@router.post("/floors", status_code=status.HTTP_201_CREATED)
def create_floor(request: Request, body: FloorIn, user: Editor, db: DbDep) -> FloorOut:
    if db.get(InventorySection, body.section_id) is None:
        raise _not_found()
    _taken(
        db,
        select(InventoryFloor).where(
            InventoryFloor.section_id == body.section_id,
            func.lower(InventoryFloor.name) == body.name.casefold(),
        ),
    )
    row = InventoryFloor(section_id=body.section_id, name=body.name, position=body.position)
    db.add(row)
    db.flush()
    _audit(db, request, user, "etage_angelegt", "etage", row.id, {"name": row.name})
    db.commit()
    return floor_out(db, row)


class FloorUpdate(NameIn):
    position: int = Field(default=0, ge=-20, le=200)


@router.put("/floors/{floor_id}")
def update_floor(
    request: Request, floor_id: ObjectId, body: FloorUpdate, user: Editor, db: DbDep
) -> FloorOut:
    row = _floor(db, floor_id)
    _taken(
        db,
        select(InventoryFloor).where(
            InventoryFloor.section_id == row.section_id,
            func.lower(InventoryFloor.name) == body.name.casefold(),
            InventoryFloor.id != row.id,
        ),
    )
    before = {"name": row.name, "reihenfolge": row.position}
    row.name = body.name
    row.position = body.position
    _audit(
        db,
        request,
        user,
        "etage_geaendert",
        "etage",
        row.id,
        {"vorher": before, "nachher": {"name": row.name, "reihenfolge": row.position}},
    )
    db.commit()
    return floor_out(db, row)


@router.delete("/floors/{floor_id}")
def delete_floor(request: Request, floor_id: ObjectId, user: Editor, db: DbDep) -> LocationsOut:
    """Löscht eine Etage samt Grundriss, solange sie keine Räume mehr hat."""
    row = _floor(db, floor_id)
    if db.scalar(
        select(func.count()).select_from(InventoryRoom).where(InventoryRoom.floor_id == row.id)
    ):
        raise _conflict("Auf dieser Etage gibt es noch Räume.")
    name = row.name
    db.delete(row)
    _audit(db, request, user, "etage_geloescht", "etage", floor_id, {"name": name})
    db.commit()
    return locations(db)


# --- Grundriss ----------------------------------------------------------------------------


@router.put("/floors/{floor_id}/plan")
async def upload_plan(
    request: Request, floor_id: ObjectId, user: Editor, db: DbDep, settings: SettingsDep
) -> FloorOut:
    """Nimmt den Grundriss an. Der Inhalt der Anfrage ist das Bild selbst."""
    row = _floor(db, floor_id)
    limit = settings.inventory_plan_max_mb * 1024 * 1024
    too_large = HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=f"Die Datei ist größer als {settings.inventory_plan_max_mb} MB.",
    )
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise too_large
    # Auch ohne ehrliche Längenangabe nie mehr als die Höchstgröße in den Speicher lesen.
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_large
        chunks.append(chunk)
    data = b"".join(chunks)
    try:
        info = inspect_plan(data)
    except ImageError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    plan = db.get(InventoryFloorPlan, row.id)
    if plan is None:
        plan = InventoryFloorPlan(floor_id=row.id)
        db.add(plan)
    plan.content_type = info.content_type
    plan.data = data
    plan.etag = hashlib.sha256(data).hexdigest()[:32]
    plan.width = info.width
    plan.height = info.height
    plan.updated_at = now_utc()
    plan.updated_by = user.user_id
    _audit(
        db,
        request,
        user,
        "grundriss_gesetzt",
        "etage",
        row.id,
        {"format": info.content_type, "breite": info.width, "hoehe": info.height, "bytes": size},
    )
    db.commit()
    return floor_out(db, row)


@router.delete("/floors/{floor_id}/plan")
def delete_plan(request: Request, floor_id: ObjectId, user: Editor, db: DbDep) -> FloorOut:
    """Entfernt den Grundriss; die Räume bleiben mit ihrer Lage erhalten."""
    row = _floor(db, floor_id)
    plan = db.get(InventoryFloorPlan, row.id)
    if plan is not None:
        db.delete(plan)
        _audit(db, request, user, "grundriss_entfernt", "etage", row.id)
        db.commit()
    return floor_out(db, row)


# --- Räume --------------------------------------------------------------------------------


def _room(db: Session, room_id: int) -> InventoryRoom:
    row = db.get(InventoryRoom, room_id)
    if row is None:
        raise _not_found()
    return row


def _room_name_free(db: Session, floor_id: int, name: str, own_id: int | None) -> None:
    query = select(InventoryRoom).where(
        InventoryRoom.floor_id == floor_id, func.lower(InventoryRoom.name) == name.casefold()
    )
    if own_id is not None:
        query = query.where(InventoryRoom.id != own_id)
    if db.scalars(query.limit(1)).first() is not None:
        raise _conflict("Diesen Raum gibt es auf dieser Etage schon.")


def _rect(body: RoomIn) -> dict[str, float]:
    return {key: round(getattr(body, key), 2) for key in ("x", "y", "w", "h")}


@router.post("/floors/{floor_id}/rooms", status_code=status.HTTP_201_CREATED)
def create_room(
    request: Request, floor_id: ObjectId, body: RoomIn, user: Editor, db: DbDep
) -> FloorOut:
    floor = _floor(db, floor_id)
    _room_name_free(db, floor.id, body.name, None)
    row = InventoryRoom(floor_id=floor.id, name=body.name, **_rect(body))
    db.add(row)
    db.flush()
    _audit(
        db, request, user, "raum_angelegt", "raum", row.id, {"name": row.name, "etage": floor.id}
    )
    db.commit()
    return floor_out(db, floor)


@router.put("/rooms/{room_id}")
def update_room(
    request: Request, room_id: ObjectId, body: RoomIn, user: Editor, db: DbDep
) -> FloorOut:
    row = _room(db, room_id)
    _room_name_free(db, row.floor_id, body.name, row.id)
    before = {"name": row.name, "x": row.x, "y": row.y, "w": row.w, "h": row.h}
    row.name = body.name
    for key, value in _rect(body).items():
        setattr(row, key, value)
    _audit(
        db,
        request,
        user,
        "raum_geaendert",
        "raum",
        row.id,
        {"vorher": before, "nachher": {"name": row.name, **_rect(body)}},
    )
    db.commit()
    return floor_out(db, _floor(db, row.floor_id))


@router.delete("/rooms/{room_id}")
def delete_room(request: Request, room_id: ObjectId, user: Editor, db: DbDep) -> FloorOut:
    row = _room(db, room_id)
    if db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .where(InventoryHardware.room_id == row.id)
    ):
        raise _conflict("In diesem Raum steht noch Hardware.")
    floor_id = row.floor_id
    name = row.name
    db.delete(row)
    _audit(db, request, user, "raum_geloescht", "raum", room_id, {"name": name})
    db.commit()
    return floor_out(db, _floor(db, floor_id))
