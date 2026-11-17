"""API des Moduls Tenant: Lizenzen, Benutzerzahlen, Zugangsdaten und Dienststatus."""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select

from werkbank.core.app_settings import warn_days
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.tenant.credentials import ATTENTION_LEVELS, days_left, level_for
from werkbank.modules.tenant.health import SERVICES
from werkbank.modules.tenant.models import (
    TenantCredential,
    TenantLicense,
    TenantLicenseSample,
    TenantServiceHealth,
    TenantServiceIssue,
    TenantUserSample,
)
from werkbank.modules.tenant.names import license_name

router = APIRouter(prefix="/api/tenant")

Reader = Annotated[CurrentUser, Depends(require_roles(Role.TENANT_READER))]
LicenseId = Annotated[int, Path(ge=1)]
# Zeitraum des Verlaufs in Tagen
Days = Annotated[int, Query(ge=30, le=1095)]


class LicenseOut(BaseModel):
    id: int
    sku_id: str
    part_number: str
    name: str
    applies_to: str | None
    capability_status: str | None
    total: int
    consumed: int
    # Kann negativ sein, wenn mehr zugewiesen als gekauft ist.
    free: int
    warning: int
    suspended: int
    locked_out: int
    next_lifecycle: datetime | None
    trial: bool
    active: bool


class LicenseListOut(BaseModel):
    # False: Der Abruf ist in dieser Installation nicht eingeschaltet.
    enabled: bool
    fetched_at: datetime | None
    total: int
    consumed: int
    entries: list[LicenseOut]


class LicenseSampleOut(BaseModel):
    day: date
    total: int
    consumed: int


class LicenseDetailOut(BaseModel):
    license: LicenseOut
    fetched_at: datetime
    samples: list[LicenseSampleOut]


class UserSampleOut(BaseModel):
    day: date
    total: int
    members: int
    guests: int
    # Aktive Konten (nicht deaktiviert)
    enabled: int
    disabled: int
    guests_disabled: int
    licensed: int | None


class UsersOut(BaseModel):
    enabled: bool
    fetched_at: datetime | None
    current: UserSampleOut | None
    samples: list[UserSampleOut]


def license_out(row: TenantLicense) -> LicenseOut:
    return LicenseOut(
        id=row.id,
        sku_id=row.sku_id,
        part_number=row.part_number,
        name=license_name(row.part_number),
        applies_to=row.applies_to,
        capability_status=row.capability_status,
        total=row.total,
        consumed=row.consumed,
        free=row.total - row.consumed,
        warning=row.warning,
        suspended=row.suspended,
        locked_out=row.locked_out,
        next_lifecycle=row.next_lifecycle,
        trial=row.trial,
        active=row.active,
    )


def user_sample_out(row: TenantUserSample) -> UserSampleOut:
    return UserSampleOut(
        day=row.day,
        total=row.total,
        members=row.total - row.guests,
        guests=row.guests,
        enabled=row.total - row.disabled,
        disabled=row.disabled,
        guests_disabled=row.guests_disabled,
        licensed=row.licensed,
    )


def _since(days: int) -> date:
    return now_utc().date() - timedelta(days=days)


@router.get("/licenses")
def list_licenses(user: Reader, db: DbDep, settings: SettingsDep) -> LicenseListOut:
    rows = db.scalars(select(TenantLicense).where(TenantLicense.active.is_(True))).all()
    entries = sorted(
        (license_out(row) for row in rows), key=lambda entry: (entry.name.lower(), entry.sku_id)
    )
    fetched_at = db.scalar(select(func.max(TenantLicense.fetched_at)))
    return LicenseListOut(
        enabled=settings.tenant_monitor_enabled and settings.collector_configured,
        fetched_at=fetched_at,
        total=sum(entry.total for entry in entries),
        consumed=sum(entry.consumed for entry in entries),
        entries=entries,
    )


@router.get("/licenses/{license_id}")
def get_license(
    user: Reader, db: DbDep, license_id: LicenseId, days: Days = 90
) -> LicenseDetailOut:
    row: TenantLicense | None = db.get(TenantLicense, license_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    samples = db.scalars(
        select(TenantLicenseSample)
        .where(TenantLicenseSample.license_id == row.id, TenantLicenseSample.day >= _since(days))
        .order_by(TenantLicenseSample.day)
    ).all()
    return LicenseDetailOut(
        license=license_out(row),
        fetched_at=row.fetched_at,
        samples=[
            LicenseSampleOut(day=sample.day, total=sample.total, consumed=sample.consumed)
            for sample in samples
        ],
    )


@router.get("/users")
def get_users(user: Reader, db: DbDep, settings: SettingsDep, days: Days = 90) -> UsersOut:
    samples = db.scalars(
        select(TenantUserSample)
        .where(TenantUserSample.day >= _since(days))
        .order_by(TenantUserSample.day)
    ).all()
    latest = db.scalars(
        select(TenantUserSample).order_by(TenantUserSample.day.desc()).limit(1)
    ).first()
    return UsersOut(
        enabled=settings.tenant_monitor_enabled and settings.collector_configured,
        fetched_at=latest.fetched_at if latest else None,
        current=user_sample_out(latest) if latest else None,
        samples=[user_sample_out(sample) for sample in samples],
    )


class CredentialOut(BaseModel):
    id: int
    # „app“: App-Registrierung; „sso“: Unternehmensanwendung mit Signaturzertifikat
    owner_kind: str
    owner_name: str
    app_id: str | None
    # „secret“ oder „zertifikat“
    kind: str
    name: str | None
    starts_at: datetime | None
    expires_at: datetime | None
    # Ganze Tage bis zum Ablauf; negativ, wenn abgelaufen
    days_left: int | None
    # abgelaufen, dringend, warnung, hinweis oder ok
    level: str


class CredentialListOut(BaseModel):
    enabled: bool
    fetched_at: datetime | None
    # Vorlauf in Tagen: Hinweis, Warnung, dringend
    warn_days: list[int]
    total: int
    attention: int
    entries: list[CredentialOut]


@router.get("/credentials")
def list_credentials(user: Reader, db: DbDep, settings: SettingsDep) -> CredentialListOut:
    levels = warn_days(db)
    now = now_utc()
    rows = db.scalars(select(TenantCredential).where(TenantCredential.active.is_(True))).all()
    entries = []
    for row in rows:
        left = days_left(row.expires_at, now)
        entries.append(
            CredentialOut(
                id=row.id,
                owner_kind=row.owner_kind,
                owner_name=row.owner_name,
                app_id=row.app_id,
                kind=row.kind,
                name=row.name,
                starts_at=row.starts_at,
                expires_at=row.expires_at,
                days_left=left,
                level=level_for(left, levels),
            )
        )
    # Was zuerst abläuft, steht oben; Einträge ohne Ablaufdatum am Ende.
    entries.sort(
        key=lambda entry: (
            entry.days_left is None,
            entry.days_left or 0,
            entry.owner_name.lower(),
            entry.id,
        )
    )
    return CredentialListOut(
        enabled=settings.tenant_credentials_enabled and settings.collector_configured,
        fetched_at=db.scalar(select(func.max(TenantCredential.fetched_at))),
        warn_days=list(levels),
        total=len(entries),
        attention=sum(1 for entry in entries if entry.level in ATTENTION_LEVELS),
        entries=entries,
    )


# --- Dienststatus ---

IssueId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,32}$")]
RECENT_DAYS = 30
STATS_YEARS = 3
# Zeitleiste: Tage bis heute; Monatsauswertung: Monate bis zum laufenden
TIMELINE_DAYS = 90
MONTHS = 36
# Status, mit denen eine Meldung beendet ist, auch wenn Microsoft „isResolved“ noch nicht setzt
CLOSED_STATUSES = frozenset(
    {
        "servicerestored",
        "postincidentreviewpublished",
        "falsepositive",
        "resolved",
        "resolvedexternal",
        "mitigated",
        "mitigatedexternal",
        "investigationsuspended",
    }
)
FALSE_POSITIVE = "falsepositive"


def is_open(row: TenantServiceIssue) -> bool:
    """Ob eine Meldung noch läuft."""
    return not row.resolved and row.status.lower() not in CLOSED_STATUSES


def counts(row: TenantServiceIssue) -> bool:
    """Fehlalarme zählen in keiner Auswertung."""
    return row.status.lower() != FALSE_POSITIVE


class ReasonOut(BaseModel):
    issue_id: str
    title: str
    # „incident“ (Störung) oder „advisory“ (Hinweis)
    classification: str


class ServiceOut(BaseModel):
    service_id: str
    name: str
    # Status laut Übersicht von Microsoft (nur zur Information)
    status: str
    # Aus den offenen Meldungen: stoerung (offene Störung), hinweis (nur Hinweise) oder ok
    level: str
    open_incidents: int
    open_advisories: int
    # Die offenen Meldungen des Dienstes, Störungen zuerst: der Grund für den Zustand
    reasons: list[ReasonOut]


class IssueOut(BaseModel):
    issue_id: str
    service_id: str
    service_name: str
    title: str
    # „incident“ (Störung) oder „advisory“ (Hinweis)
    classification: str
    status: str
    feature_group: str | None
    feature: str | None
    impact: str | None
    resolved: bool
    start_at: datetime | None
    end_at: datetime | None
    modified_at: datetime | None


class PostOut(BaseModel):
    at: datetime | None
    type: str
    text: str


class IssueDetailOut(IssueOut):
    posts: list[PostOut]


class OutageStat(BaseModel):
    year: int
    service_id: str
    service_name: str
    incidents: int
    advisories: int
    # Summe der Dauer aller Störungen in Stunden (laufende bis jetzt)
    incident_hours: float


class MonthStat(BaseModel):
    # Monat des Beginns als JJJJ-MM
    month: str
    service_id: str
    incidents: int


class ServiceTimeline(BaseModel):
    service_id: str
    service_name: str
    # Ein Eintrag je Tag (ältester zuerst): „stoerung“, „hinweis“ oder „ok“
    days: list[str]


class HealthOut(BaseModel):
    # False: Der Abruf ist in dieser Installation nicht eingeschaltet.
    enabled: bool
    fetched_at: datetime | None
    services: list[ServiceOut]
    open: list[IssueOut]
    # In den letzten 30 Tagen beendet
    recent: list[IssueOut]
    stats: list[OutageStat]
    months: list[MonthStat]
    # Tage als JJJJ-MM-TT, ältester zuerst; passend zu ServiceTimeline.days
    timeline_days: list[str]
    timeline: list[ServiceTimeline]
    # Alle Meldungen, die in diesen Tagen liefen, neueste zuerst (ohne Fehlalarme)
    timeline_issues: list["IssueOut"]


def _issue_end(row: TenantServiceIssue, now: datetime) -> datetime:
    """Ende einer Störung; laufende bis jetzt."""
    return row.end_at or (row.modified_at if row.resolved else None) or now


def _month_keys(today: date, count: int) -> list[str]:
    """Die letzten count Monate als JJJJ-MM, ältester zuerst, der laufende zuletzt."""
    keys = []
    year, month = today.year, today.month
    for _ in range(count):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return keys[::-1]


def _months(issues: list[TenantServiceIssue], today: date) -> list[MonthStat]:
    """Störungen je Monat des Beginns und Dienst."""
    keys = _month_keys(today, MONTHS)
    counts = {(key, service_id): 0 for key in keys for service_id in SERVICES}
    for row in issues:
        if row.classification != "incident" or row.start_at is None or not counts(row):
            continue
        key = (row.start_at.strftime("%Y-%m"), row.service_id)
        if key in counts:
            counts[key] += 1
    return [
        MonthStat(month=month, service_id=service_id, incidents=count)
        for (month, service_id), count in counts.items()
    ]


def _timeline(
    issues: list[TenantServiceIssue], now: datetime
) -> tuple[list[str], list[ServiceTimeline]]:
    """Je Dienst und Tag die schwerste Meldung, die an dem Tag lief (Tage in UTC)."""
    today = now.date()
    first = today - timedelta(days=TIMELINE_DAYS - 1)
    days = [first + timedelta(days=offset) for offset in range(TIMELINE_DAYS)]
    rank = {"ok": 0, "hinweis": 1, "stoerung": 2}
    levels = {service_id: ["ok"] * TIMELINE_DAYS for service_id in SERVICES}
    for row in issues:
        if row.start_at is None or row.service_id not in levels or not counts(row):
            continue
        level = "stoerung" if row.classification == "incident" else "hinweis"
        start = max(row.start_at.astimezone(UTC).date(), first)
        end = min(_issue_end(row, now).astimezone(UTC).date(), today)
        day = start
        while day <= end:
            index = (day - first).days
            if rank[level] > rank[levels[row.service_id][index]]:
                levels[row.service_id][index] = level
            day += timedelta(days=1)
    return (
        [day.isoformat() for day in days],
        [
            ServiceTimeline(service_id=service_id, service_name=name, days=levels[service_id])
            for service_id, name in SERVICES.items()
        ],
    )


def _issue_out(row: TenantServiceIssue) -> IssueOut:
    return IssueOut(
        issue_id=row.issue_id,
        service_id=row.service_id,
        service_name=SERVICES.get(row.service_id, row.service_name),
        title=row.title,
        classification=row.classification,
        status=row.status,
        feature_group=row.feature_group,
        feature=row.feature,
        impact=row.impact,
        resolved=row.resolved,
        start_at=row.start_at,
        end_at=row.end_at,
        modified_at=row.modified_at,
    )


def incident_hours_by_year(
    issues: list[TenantServiceIssue], now: datetime
) -> dict[tuple[int, str], float]:
    """Stunden mit Störung je (Jahr, Dienst).

    Gleichzeitig laufende Störungen eines Dienstes zählen nur einmal (Zeiträume werden
    zusammengelegt); eine Störung über den Jahreswechsel zählt anteilig in beiden Jahren.
    Fehlalarme zählen nicht.
    """
    spans: dict[str, list[tuple[datetime, datetime]]] = {}
    for row in issues:
        if row.classification != "incident" or row.start_at is None or not counts(row):
            continue
        end = _issue_end(row, now)
        if end > row.start_at:
            spans.setdefault(row.service_id, []).append((row.start_at, end))
    hours: dict[tuple[int, str], float] = {}
    for service_id, entries in spans.items():
        merged: list[list[datetime]] = []
        for start, end in sorted(entries):
            if merged and start <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        for start, end in merged:
            cursor = start
            while cursor < end:
                boundary = datetime(cursor.year + 1, 1, 1, tzinfo=UTC)
                piece_end = min(end, boundary)
                key = (cursor.year, service_id)
                hours[key] = hours.get(key, 0.0) + (piece_end - cursor).total_seconds() / 3600
                cursor = piece_end
    return hours


def _level(open_rows: list[TenantServiceIssue]) -> str:
    if any(row.classification == "incident" for row in open_rows):
        return "stoerung"
    return "hinweis" if open_rows else "ok"


def _status_rank(level: str, status_text: str) -> int:
    """Reihenfolge der Kacheln: Unterbrechung, Störung, Hinweis, in Ordnung."""
    if level == "stoerung":
        return 0 if "interruption" in status_text.lower() else 1
    return 2 if level == "hinweis" else 3


@router.get("/health")
def service_health(user: Reader, db: DbDep, settings: SettingsDep) -> HealthOut:
    """Zustand der beobachteten Dienste, offene und kürzlich beendete Störungen, Auswertung."""
    now = now_utc()
    issues = db.scalars(select(TenantServiceIssue)).all()
    open_rows = [row for row in issues if is_open(row)]
    recent_rows = [
        row
        for row in issues
        if not is_open(row)
        and (row.end_at or row.modified_at or now) >= now - timedelta(days=RECENT_DAYS)
    ]
    services = []
    for row in db.scalars(select(TenantServiceHealth)).all():
        mine = sorted(
            (issue for issue in open_rows if issue.service_id == row.service_id),
            key=lambda issue: (
                issue.classification != "incident",
                -(issue.start_at or now).timestamp(),
            ),
        )
        services.append(
            ServiceOut(
                service_id=row.service_id,
                name=SERVICES.get(row.service_id, row.service_name),
                status=row.status,
                level=_level(mine),
                open_incidents=sum(1 for issue in mine if issue.classification == "incident"),
                open_advisories=sum(1 for issue in mine if issue.classification != "incident"),
                reasons=[
                    ReasonOut(
                        issue_id=issue.issue_id,
                        title=issue.title,
                        classification=issue.classification,
                    )
                    for issue in mine
                ],
            )
        )
    order = list(SERVICES)
    services.sort(
        key=lambda entry: (
            _status_rank(entry.level, entry.status),
            order.index(entry.service_id) if entry.service_id in order else len(order),
        )
    )

    def newest_first(rows: list[TenantServiceIssue]) -> list[IssueOut]:
        rows.sort(
            key=lambda row: row.start_at or row.modified_at or datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )
        return [_issue_out(row) for row in rows]

    # Störungen offen vor Hinweisen, darin die neuesten zuerst
    open_out = newest_first(open_rows)
    open_out.sort(key=lambda entry: entry.classification != "incident")

    stats: dict[tuple[int, str], OutageStat] = {}
    first_year = now.year - STATS_YEARS + 1
    for year in range(first_year, now.year + 1):
        for service_id, name in SERVICES.items():
            stats[(year, service_id)] = OutageStat(
                year=year,
                service_id=service_id,
                service_name=name,
                incidents=0,
                advisories=0,
                incident_hours=0.0,
            )
    for counted in issues:
        if counted.start_at is None or not counts(counted):
            continue
        entry = stats.get((counted.start_at.year, counted.service_id))
        if entry is None:
            continue
        if counted.classification == "incident":
            entry.incidents += 1
        else:
            entry.advisories += 1
    for key, value in incident_hours_by_year(list(issues), now).items():
        if key in stats:
            stats[key].incident_hours = round(value, 1)

    timeline_days, timeline = _timeline(list(issues), now)
    window_start = now - timedelta(days=TIMELINE_DAYS)
    in_window = [
        row
        for row in issues
        if row.start_at is not None
        and counts(row)
        and row.service_id in SERVICES
        and _issue_end(row, now) >= window_start
    ]
    return HealthOut(
        enabled=settings.tenant_health_enabled and settings.collector_configured,
        fetched_at=db.scalar(select(func.max(TenantServiceHealth.fetched_at))),
        services=services,
        open=open_out,
        recent=newest_first(recent_rows),
        stats=sorted(
            stats.values(),
            key=lambda entry: (-entry.year, order.index(entry.service_id)),
        ),
        months=_months(list(issues), now.date()),
        timeline_days=timeline_days,
        timeline=timeline,
        timeline_issues=newest_first(in_window),
    )


@router.get("/health/issues/{issue_id}")
def service_issue(user: Reader, db: DbDep, issue_id: IssueId) -> IssueDetailOut:
    """Eine Störung oder ein Hinweis mit allen Mitteilungen von Microsoft."""
    row = db.get(TenantServiceIssue, issue_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    posts = []
    for post in row.posts or []:
        if not isinstance(post, dict) or not isinstance(post.get("text"), str):
            continue
        at = post.get("at")
        posts.append(
            PostOut(
                at=datetime.fromisoformat(at) if isinstance(at, str) else None,
                type=str(post.get("type") or "regular"),
                text=post["text"],
            )
        )
    return IssueDetailOut(**_issue_out(row).model_dump(), posts=posts)
