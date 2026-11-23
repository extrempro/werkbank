"""Abruf der technischen Daten aus Lenovo PSREF: einmal am Tag für fällige Lenovo-Modelle.

Ein Modell ist fällig, wenn es noch nie abgefragt wurde, nach 30 Tagen (gefunden) oder nach
7 Tagen (nicht gefunden oder Fehler). Je Lauf höchstens ``MODELS_PER_RUN`` Modelle, mit Pause
zwischen den Anfragen. Ausgeschaltet ist der Abruf, solange er in der Verwaltung nicht
eingeschaltet ist.
"""

import logging
import time
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import NINJA_KEY, get_setting
from werkbank.core.deps import DbDep
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.api import Editor, HardwareOut, ObjectId, _audit, hardware_out
from werkbank.modules.inventory.models import (
    InventoryHardware,
    InventoryKind,
    InventoryMaker,
    InventoryModel,
)
from werkbank.modules.inventory.psref import (
    REFRESH_FAILED,
    REFRESH_OK,
    USER_AGENT,
    Fetcher,
    PsrefError,
    fetch,
    is_mtm,
    valid_user_agent,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inventory")

PSREF_SYNC = "bestand.psref"
PSREF_SYNC_INTERVAL = timedelta(hours=24)
MODELS_PER_RUN = 40
PAUSE_SECONDS = 0.5
STATUS_OK = "ok"
STATUS_NOT_FOUND = "nicht_gefunden"
STATUS_ERROR = "fehler"


def psref_enabled(db: Session) -> bool:
    stored: Any = get_setting(db, NINJA_KEY)
    return isinstance(stored, dict) and stored.get("psref_enabled") is True


def psref_user_agent(db: Session) -> str:
    """Absenderkennung für PSREF aus der Verwaltung; ohne Eintrag die der Werkbank."""
    stored: Any = get_setting(db, NINJA_KEY)
    value = stored.get("psref_user_agent") if isinstance(stored, dict) else None
    return value if isinstance(value, str) and valid_user_agent(value) else USER_AGENT


def lookup_for(db: Session, model: InventoryModel) -> tuple[str, str] | None:
    """Art des Abrufs für ein Modell: („modell“, MTM), („monitor“, Modell) oder None."""
    maker = db.get(InventoryMaker, model.maker_id)
    if maker is None or maker.name.casefold() != "lenovo":
        return None
    name = model.name.strip()
    if is_mtm(name):
        return "modell", name.upper()
    monitor = db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .join(InventoryKind, InventoryKind.id == InventoryHardware.kind_id)
        .where(InventoryHardware.model_id == model.id, func.lower(InventoryKind.name) == "monitor")
    )
    return ("monitor", name) if monitor else None


def refresh_model(
    db: Session, model: InventoryModel, fetcher: Fetcher, now: datetime
) -> str | None:
    """Fragt PSREF für ein Modell ab und speichert das Ergebnis; None, wenn nicht passend."""
    lookup = lookup_for(db, model)
    if lookup is None:
        return None
    try:
        result = fetcher(*lookup, psref_user_agent(db))
    except PsrefError as exc:
        logger.warning("PSREF für Modell %s: %s", model.id, exc)
        model.psref_status = STATUS_ERROR
        model.psref_error = str(exc)[:300]
        model.psref_checked_at = now
        return STATUS_ERROR
    model.psref_error = ""
    model.psref_checked_at = now
    model.psref_url = result.url[:300]
    if not result.specs:
        model.psref_status = STATUS_NOT_FOUND
        return STATUS_NOT_FOUND
    model.psref_status = STATUS_OK
    model.psref_key = result.key[:120]
    model.psref_name = result.name[:160]
    model.psref_specs = [
        {"group": spec.group, "name": spec.name, "value": spec.value} for spec in result.specs
    ]
    return STATUS_OK


def due(model: InventoryModel, now: datetime) -> bool:
    if model.psref_checked_at is None:
        return True
    wait = REFRESH_OK if model.psref_status == STATUS_OK else REFRESH_FAILED
    return model.psref_checked_at <= now - wait


def run_psref(db: Session, fetcher: Fetcher = fetch, pause: float = PAUSE_SECONDS) -> int:
    """Ein Lauf; liefert die Zahl der abgefragten Modelle."""
    if not psref_enabled(db):
        return 0
    now = now_utc()
    used = select(InventoryHardware.model_id).where(InventoryHardware.model_id.is_not(None))
    candidates = db.scalars(
        select(InventoryModel)
        .join(InventoryMaker, InventoryMaker.id == InventoryModel.maker_id)
        .where(func.lower(InventoryMaker.name) == "lenovo", InventoryModel.id.in_(used))
        .order_by(InventoryModel.psref_checked_at.asc().nulls_first(), InventoryModel.id)
    ).all()
    asked = 0
    for model in candidates:
        if asked >= MODELS_PER_RUN:
            break
        if not due(model, now):
            continue
        if refresh_model(db, model, fetcher, now) is None:
            continue
        db.commit()
        asked += 1
        if pause:
            time.sleep(pause)
    return asked


def psref_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    run_psref(db)


def get_psref_fetcher() -> Fetcher:
    """In Tests ersetzbar."""
    return fetch


@router.post("/hardware/{hardware_id}/psref")
def refresh_psref(
    request: Request,
    hardware_id: ObjectId,
    user: Editor,
    db: DbDep,
    fetcher: Annotated[Fetcher, Depends(get_psref_fetcher)],
) -> HardwareOut:
    """Fragt PSREF für das Modell dieses Geräts sofort neu ab."""
    row = db.get(InventoryHardware, hardware_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if not psref_enabled(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Der Abruf aus Lenovo PSREF ist in der Verwaltung ausgeschaltet.",
        )
    model = db.get(InventoryModel, row.model_id) if row.model_id else None
    result = refresh_model(db, model, fetcher, now_utc()) if model else None
    if model is None or result is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Für dieses Gerät gibt es keine Daten in PSREF (nur Lenovo-Rechner mit "
            "Maschinentyp und Lenovo-Monitore).",
        )
    details: dict[str, Any] = {"ergebnis": result}
    if model.psref_error:
        details["grund"] = model.psref_error
    _audit(db, request, user, "psref_abgerufen", "modell", model.id, details)
    db.commit()
    return hardware_out(db, row)
