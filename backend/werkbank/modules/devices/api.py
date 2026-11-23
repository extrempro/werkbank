"""API der Gerätezuordnung (M365, Gruppe Geräte, spec.md 7c).

Alles nur mit der Rolle `Geraete.Zuordnung`. Der Import bei Microsoft läuft zusätzlich mit dem
Admin-Konto (zweite Anmeldung, siehe admin.py). Der QR-Inhalt und der deviceLink erscheinen nie
in Antworten, im Audit-Log oder im Log; gespeichert wird der deviceLink nur verschlüsselt und
nur, solange eine Freigabe aussteht.
"""

from datetime import timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import SecretKeyMissingError, decrypt_secret, encrypt_secret
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import Job, User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.devices.admin import FAKE_TOKEN, admin_token
from werkbank.modules.devices.devicelink import (
    MAX_QR_LENGTH,
    DeviceLinkError,
    ScannedDevice,
    scan_to_device,
)
from werkbank.modules.devices.graph import GraphError, explain
from werkbank.modules.devices.models import AssociationStatus, DeviceAssociation
from werkbank.modules.devices.service import (
    MODULE,
    OBJECT_TYPE,
    PENDING_HOURS,
    GraphApi,
    app_graph,
    delegated_graph,
    refresh_entry,
)
from werkbank.modules.inventory.search import escape_like

router = APIRouter(prefix="/api/devices")
Member = Annotated[CurrentUser, Depends(require_roles(Role.DEVICES_ASSOCIATION))]
EntryId = Annotated[int, Path(ge=1)]
JOB_TYPE = "geraete.status"
KEY_MISSING = (
    "Der Schlüssel für verschlüsselte Daten fehlt (Docker-Secret settings_key). "
    "Bitte die Verwaltung informieren."
)


def get_graph_factory(settings: SettingsDep) -> Any:
    """Token → Graph. In Tests ersetzbar; mit dem Test-Token die nachgestellte Graph-API."""

    def factory(token: str) -> GraphApi:
        if (
            token == FAKE_TOKEN
            and settings.enable_test_login
            and settings.environment in ("test", "development")
        ):
            from werkbank.modules.devices.fake_graph import FakeDeviceGraph

            return FakeDeviceGraph()
        return delegated_graph(token)

    return factory


def get_app_graph(settings: SettingsDep) -> GraphApi | None:
    return app_graph(settings)


GraphFactoryDep = Annotated[Any, Depends(get_graph_factory)]
AppGraphDep = Annotated[GraphApi | None, Depends(get_app_graph)]


class QrIn(BaseModel):
    qr: str = Field(min_length=10, max_length=MAX_QR_LENGTH)


class SubmitIn(QrIn):
    policy_id: str | None = Field(default=None, max_length=64)


class ApproveIn(BaseModel):
    policy_id: str | None = Field(default=None, max_length=64)


class PolicyOut(BaseModel):
    id: str
    name: str


class DuplicateOut(BaseModel):
    graph_id: str
    association_state: str
    entry_id: int | None


class ScanOut(BaseModel):
    serial_number: str
    manufacturer: str
    model: str
    link_id: str
    generated_at: str
    admin_connected: bool
    admin_upn: str | None
    tenant_name: str | None
    policies: list[PolicyOut]
    duplicate: DuplicateOut | None
    # Fehler beim Lesen von Microsoft (z. B. Admin-Konto ohne Intune-Rolle)
    problem: dict[str, Any] | None


class EntryOut(BaseModel):
    id: int
    serial_number: str
    manufacturer: str
    model: str
    status: str
    association_state: str | None
    policy_name: str | None
    scanned_by: str | None
    scanned_at: str
    approved_by: str | None
    approved_admin: str | None
    approved_at: str | None
    associated_at: str | None
    enrolled_at: str | None
    link_expires_at: str | None
    request_id: str | None
    last_error: str | None
    device_name: str | None
    compliance: str | None
    user_principal_name: str | None
    managed_device_id: str | None
    last_checked_at: str | None


class CountsOut(BaseModel):
    freigabe: int
    vorab: int
    zugeordnet: int
    registriert: int
    nicht_abgeschlossen: int


class ListOut(BaseModel):
    entries: list[EntryOut]
    # Treffer insgesamt; die Liste zeigt höchstens LIST_MAX, die neuesten zuerst
    total: int
    counts: CountsOut
    last_run: str | None
    monitor: bool


class ResultOut(BaseModel):
    """Ergebnis von Import oder Freigabe: Eintrag, Duplikat oder Fehler mit request-id."""

    ok: bool
    entry: EntryOut | None = None
    duplicate: DuplicateOut | None = None
    error: dict[str, Any] | None = None


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _names(db: Session, rows: list[DeviceAssociation]) -> dict[Any, str]:
    ids = {r.scanned_by for r in rows} | {r.approved_by for r in rows}
    ids.discard(None)
    if not ids:
        return {}
    return dict(
        db.execute(select(User.id, User.display_name).where(User.id.in_(ids))).tuples().all()
    )


def _out(row: DeviceAssociation, names: dict[Any, str]) -> EntryOut:
    return EntryOut(
        id=row.id,
        serial_number=row.serial_number,
        manufacturer=row.manufacturer,
        model=row.model,
        status=row.status,
        association_state=row.association_state,
        policy_name=row.policy_name,
        scanned_by=names.get(row.scanned_by),
        scanned_at=row.scanned_at.isoformat(),
        approved_by=names.get(row.approved_by),
        approved_admin=row.approved_admin,
        approved_at=_iso(row.approved_at),
        associated_at=_iso(row.associated_at),
        enrolled_at=_iso(row.enrolled_at),
        link_expires_at=_iso(row.link_expires_at),
        request_id=row.request_id,
        last_error=row.last_error,
        device_name=row.device_name,
        compliance=row.compliance,
        user_principal_name=row.user_principal_name,
        managed_device_id=row.managed_device_id,
        last_checked_at=_iso(row.last_checked_at),
    )


def _one(db: Session, row: DeviceAssociation) -> EntryOut:
    return _out(row, _names(db, [row]))


def _entry(db: Session, entry_id: int) -> DeviceAssociation:
    row = db.get(DeviceAssociation, entry_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return row


def _scan(qr: str) -> ScannedDevice:
    try:
        return scan_to_device(qr)
    except DeviceLinkError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _admin_graph(
    db: Session, settings: Settings, user: CurrentUser, factory: Any
) -> tuple[GraphApi, str] | None:
    found = admin_token(db, settings, user)
    if found is None:
        return None
    token, upn = found
    return factory(token), upn


def _require_admin(
    db: Session, settings: Settings, user: CurrentUser, factory: Any
) -> tuple[GraphApi, str]:
    found = _admin_graph(db, settings, user, factory)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bitte zuerst mit dem Admin-Konto anmelden.",
        )
    return found


def _audit(
    db: Session,
    request: Request,
    user: CurrentUser,
    action: str,
    device: ScannedDevice | DeviceAssociation,
    result: str = "ok",
    **details: Any,
) -> None:
    serial = device.serial_number
    write_audit(
        db,
        module=MODULE,
        action=action,
        user_id=user.user_id,
        object_type=OBJECT_TYPE,
        object_id=serial[:128],
        result=result,
        ip=request.client.host if request.client else None,
        details={
            "seriennummer": serial,
            "hersteller": device.manufacturer,
            "modell": device.model,
            **{key: value for key, value in details.items() if value is not None},
        },
    )


def _duplicate(db: Session, graph: GraphApi, serial: str) -> DuplicateOut | None:
    found = graph.find_by_serial(serial)
    if not found:
        return None
    local = db.scalar(
        select(DeviceAssociation.id)
        .where(DeviceAssociation.graph_id == found[0].id)
        .order_by(DeviceAssociation.id.desc())
        .limit(1)
    )
    if local is None:
        local = db.scalar(
            select(DeviceAssociation.id)
            .where(
                func.lower(DeviceAssociation.serial_number) == serial.casefold(),
                DeviceAssociation.status != AssociationStatus.PENDING,
            )
            .order_by(DeviceAssociation.id.desc())
            .limit(1)
        )
    return DuplicateOut(
        graph_id=found[0].id, association_state=found[0].association_state, entry_id=local
    )


def _policy(graph: GraphApi, policy_id: str | None) -> tuple[str | None, str | None]:
    """Richtlinie nur aus der Liste von Microsoft übernehmen (Name nicht vom Browser)."""
    if not policy_id:
        return None, None
    for policy in graph.list_policies():
        if policy.id == policy_id:
            return policy.id, policy.name
    raise HTTPException(status_code=422, detail="Unbekannte Richtlinie")


def _import(
    db: Session,
    request: Request,
    user: CurrentUser,
    graph: GraphApi,
    admin_upn: str,
    device: ScannedDevice | DeviceAssociation,
    device_link: str,
    policy_id: str | None,
    row: DeviceAssociation | None,
) -> ResultOut:
    """Duplikat prüfen, importieren, auf „vorab zugeordnet“ warten. Ein Eintrag entsteht nur
    bei Erfolg (Sofortfreigabe) bzw. der wartende Eintrag wird fortgeschrieben."""
    try:
        policy, policy_name = _policy(graph, policy_id)
        duplicate = _duplicate(db, graph, device.serial_number)
        if duplicate is not None:
            _audit(
                db, request, user, "geraet.import_gesperrt", device, "abgelehnt", grund="doppelt"
            )
            db.commit()
            return ResultOut(ok=False, duplicate=duplicate)
        imported = graph.import_device(device_link, policy)
        confirmed = graph.confirm(imported.id) if imported.id else imported
    except GraphError as error:
        info = {**explain(error), "request_id": error.request_id}
        _audit(
            db,
            request,
            user,
            "geraet.freigabe_fehlgeschlagen",
            device,
            "fehler",
            admin_konto=admin_upn,
            status=error.status,
            request_id=error.request_id,
        )
        if row is not None:
            row.last_error = str(info["title"])[:500]
            row.request_id = error.request_id
        db.commit()
        return ResultOut(ok=False, error=info)
    now = now_utc()
    if row is None:
        if not isinstance(device, ScannedDevice):  # pragma: no cover - nur mit Eintrag aufgerufen
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
        row = DeviceAssociation(
            serial_number=device.serial_number[:128],
            manufacturer=device.manufacturer[:256],
            model=device.model[:256],
            link_id=device.link_id,
            qr_created_at=device.generated_at,
            scanned_by=user.user_id,
            scanned_at=now,
        )
        db.add(row)
    row.status = (
        AssociationStatus.ASSOCIATED
        if confirmed.association_state == "associated"
        else AssociationStatus.PREASSOCIATED
    )
    row.association_state = confirmed.association_state
    row.graph_id = confirmed.id or imported.id
    row.policy_id, row.policy_name = policy, policy_name
    row.approved_by, row.approved_admin, row.approved_at = user.user_id, admin_upn, now
    row.associated_at = now if row.status == AssociationStatus.ASSOCIATED else None
    row.request_id, row.last_error = None, None
    # Gerätedaten werden nach dem Import nicht mehr gebraucht
    row.device_link_enc, row.link_expires_at = None, None
    row.last_checked_at = now
    _audit(
        db,
        request,
        user,
        "geraet.freigegeben",
        row,
        admin_konto=admin_upn,
        richtlinie=policy_name,
        ergebnis=row.association_state,
    )
    db.commit()
    return ResultOut(ok=True, entry=_one(db, row))


@router.post("/scan")
def scan(
    body: QrIn, user: Member, db: DbDep, settings: SettingsDep, factory: GraphFactoryDep
) -> ScanOut:
    """QR-Code prüfen: Gerätedaten, Ziel-Tenant, Richtlinien und Duplikat (mit Admin-Konto)."""
    device = _scan(body.qr)
    found = _admin_graph(db, settings, user, factory)
    tenant, policies, duplicate, problem = None, [], None, None
    if found is not None:
        graph, _ = found
        try:
            tenant = graph.organization() or None
            policies = [PolicyOut(id=p.id, name=p.name) for p in graph.list_policies()]
            duplicate = _duplicate(db, graph, device.serial_number)
        except GraphError as error:
            problem = {**explain(error), "request_id": error.request_id}
    return ScanOut(
        serial_number=device.serial_number,
        manufacturer=device.manufacturer,
        model=device.model,
        link_id=device.link_id,
        generated_at=device.generated_at.isoformat(),
        admin_connected=found is not None,
        admin_upn=found[1] if found else None,
        tenant_name=tenant,
        policies=policies,
        duplicate=duplicate,
        problem=problem,
    )


@router.get("/policies")
def policies(user: Member, db: DbDep, settings: SettingsDep, factory: GraphFactoryDep) -> Any:
    graph, _ = _require_admin(db, settings, user, factory)
    try:
        return {
            "tenant_name": graph.organization() or None,
            "policies": [PolicyOut(id=p.id, name=p.name) for p in graph.list_policies()],
            "problem": None,
        }
    except GraphError as error:
        return {
            "tenant_name": None,
            "policies": [],
            "problem": {**explain(error), "request_id": error.request_id},
        }


@router.post("/entries/import")
def import_now(
    request: Request,
    body: SubmitIn,
    user: Member,
    db: DbDep,
    settings: SettingsDep,
    factory: GraphFactoryDep,
) -> ResultOut:
    """Scannen und sofort freigeben (Admin-Konto verbunden)."""
    device = _scan(body.qr)
    graph, upn = _require_admin(db, settings, user, factory)
    _audit(db, request, user, "geraet.gescannt", device)
    return _import(db, request, user, graph, upn, device, device.device_link, body.policy_id, None)


@router.post("/entries/pending", status_code=status.HTTP_201_CREATED)
def send_for_approval(
    request: Request, body: SubmitIn, user: Member, db: DbDep, settings: SettingsDep
) -> EntryOut:
    """„Zur Freigabe senden“: Gerätedaten verschlüsselt ablegen, höchstens 24 Stunden."""
    device = _scan(body.qr)
    waiting = db.scalar(
        select(DeviceAssociation.id).where(
            DeviceAssociation.status == AssociationStatus.PENDING,
            DeviceAssociation.serial_number == device.serial_number,
        )
    )
    if waiting is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Dieses Gerät wartet schon auf Freigabe.",
        )
    now = now_utc()
    try:
        encrypted = encrypt_secret(settings, device.device_link)
    except SecretKeyMissingError as error:
        raise HTTPException(status_code=503, detail=KEY_MISSING) from error
    row = DeviceAssociation(
        serial_number=device.serial_number[:128],
        manufacturer=device.manufacturer[:256],
        model=device.model[:256],
        link_id=device.link_id,
        qr_created_at=device.generated_at,
        status=AssociationStatus.PENDING,
        device_link_enc=encrypted,
        link_expires_at=now + timedelta(hours=PENDING_HOURS),
        # Nur die Kennung merken; den Namen holt die Freigabe von Microsoft
        policy_id=body.policy_id,
        scanned_by=user.user_id,
        scanned_at=now,
    )
    db.add(row)
    _audit(db, request, user, "geraet.zur_freigabe_gesendet", device)
    db.commit()
    return _one(db, row)


@router.post("/entries/{entry_id}/approve")
def approve(
    request: Request,
    entry_id: EntryId,
    body: ApproveIn,
    user: Member,
    db: DbDep,
    settings: SettingsDep,
    factory: GraphFactoryDep,
) -> ResultOut:
    """Wartendes Gerät freigeben, auch durch eine andere Person mit Admin-Konto."""
    row = _entry(db, entry_id)
    if row.status != AssociationStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Wartet nicht auf Freigabe"
        )
    graph, upn = _require_admin(db, settings, user, factory)
    if row.device_link_enc is None or (row.link_expires_at and row.link_expires_at < now_utc()):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Die Gerätedaten sind abgelaufen. Bitte neu scannen.",
        )
    link = decrypt_secret(settings, row.device_link_enc)
    if not link:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Gerätedaten nicht lesbar")
    return _import(db, request, user, graph, upn, row, link, body.policy_id or row.policy_id, row)


@router.delete("/entries/{entry_id}")
def discard(request: Request, entry_id: EntryId, user: Member, db: DbDep) -> dict[str, bool]:
    """„Verwerfen“: wartenden Eintrag samt Gerätedaten löschen."""
    row = _entry(db, entry_id)
    if row.status != AssociationStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Nur Geräte, die auf Freigabe warten, lassen sich verwerfen.",
        )
    _audit(db, request, user, "geraet.verworfen", row)
    db.delete(row)
    db.commit()
    return {"ok": True}


def _status_graph(
    db: Session, settings: Settings, user: CurrentUser, factory: Any, app: GraphApi | None
) -> GraphApi:
    """Lesen geht mit der Collector-App; ohne sie mit dem Admin-Konto, falls verbunden."""
    if app is not None:
        return app
    found = _admin_graph(db, settings, user, factory)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Status lässt sich gerade nicht prüfen: Hintergrundprüfung ist aus. "
            "Mit dem Admin-Konto anmelden, dann geht es.",
        )
    return found[0]


@router.post("/entries/{entry_id}/refresh")
def refresh(
    entry_id: EntryId,
    user: Member,
    db: DbDep,
    settings: SettingsDep,
    factory: GraphFactoryDep,
    app: AppGraphDep,
) -> EntryOut:
    row = _entry(db, entry_id)
    if row.status == AssociationStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Noch nicht freigegeben")
    graph = _status_graph(db, settings, user, factory, app)
    try:
        refresh_entry(row, graph)
    except GraphError as error:
        db.rollback()
        raise HTTPException(status_code=502, detail=explain(error)["title"]) from error
    db.commit()
    return _one(db, row)


@router.post("/refresh")
def refresh_all(
    user: Member, db: DbDep, settings: SettingsDep, factory: GraphFactoryDep, app: AppGraphDep
) -> dict[str, int]:
    """„Alle aktualisieren“: offene Einträge und „Nicht abgeschlossen“."""
    graph = _status_graph(db, settings, user, factory, app)
    checked = 0
    rows = db.scalars(
        select(DeviceAssociation).where(
            DeviceAssociation.status.in_(
                (
                    AssociationStatus.PREASSOCIATED,
                    AssociationStatus.ASSOCIATED,
                    AssociationStatus.STALE,
                )
            )
        )
    ).all()
    for row in rows:
        try:
            refresh_entry(row, graph)
            checked += 1
        except GraphError:
            continue
    db.commit()
    return {"checked": checked}


# Höchstens so viele Einträge je Abruf; darüber hinaus grenzen Suche und Filter ein
LIST_MAX = 500

FILTERS: dict[str, tuple[str, ...]] = {
    "freigabe": (AssociationStatus.PENDING,),
    "offen": (AssociationStatus.PREASSOCIATED, AssociationStatus.ASSOCIATED),
    "abgeschlossen": (AssociationStatus.ENROLLED,),
    "nicht_abgeschlossen": (AssociationStatus.STALE,),
}


@router.get("/entries")
def list_entries(
    user: Member,
    db: DbDep,
    settings: SettingsDep,
    view: Annotated[
        Literal["alle", "freigabe", "offen", "abgeschlossen", "nicht_abgeschlossen"], Query()
    ] = "alle",
    q: Annotated[str, Query(max_length=100)] = "",
) -> ListOut:
    query = select(DeviceAssociation)
    if view != "alle":
        query = query.where(DeviceAssociation.status.in_(FILTERS[view]))
    term = q.strip().casefold()
    if term:
        pattern = f"%{escape_like(term)}%"
        query = query.where(
            or_(
                func.lower(DeviceAssociation.serial_number).like(pattern, escape="\\"),
                func.lower(DeviceAssociation.model).like(pattern, escape="\\"),
                func.lower(DeviceAssociation.manufacturer).like(pattern, escape="\\"),
                func.lower(func.coalesce(DeviceAssociation.device_name, "")).like(
                    pattern, escape="\\"
                ),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(DeviceAssociation.scanned_at.desc()).limit(LIST_MAX)).all()
    counts = dict(
        db.execute(
            select(DeviceAssociation.status, func.count()).group_by(DeviceAssociation.status)
        )
        .tuples()
        .all()
    )
    last_run = db.scalar(select(func.max(Job.finished_at)).where(Job.type == JOB_TYPE))
    names = _names(db, list(rows))
    return ListOut(
        entries=[_out(row, names) for row in rows],
        total=total,
        counts=CountsOut(**{key.value: int(counts.get(key, 0)) for key in AssociationStatus}),
        last_run=_iso(last_run),
        monitor=bool(settings.collector_configured and settings.devices_monitor_enabled),
    )


@router.get("/entries/{entry_id}")
def read_entry(entry_id: EntryId, user: Member, db: DbDep) -> EntryOut:
    return _one(db, _entry(db, entry_id))
