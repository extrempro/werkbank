"""Berichtsdaten für Zabbix: Ausfallzeiten je Host und Tag, Auslöser je Monat, Ausfälle.

Erzeugt wird jeder abgeschlossene Tag einmal, ab dem Tag, an dem die Werkbank die Berichte
zum ersten Mal sieht (nicht rückwirkend). Grundlage:

- Ausfall: Probleme mit Tag ``scope: availability`` ab Schweregrad Hoch (``event.get``),
  überlappende zählen einmal.
- Wartung: eigene Beobachtung, jede Minute aus dem Zustand der Hosts (``mon_zbx_maint_log``).
  Zabbix liefert wiederkehrende Wartungsfenster nicht als Zeiten, deshalb nicht aus
  ``maintenance.get``.
- Überwacht: ein Host zählt an einem Tag, wenn er beim Erzeugen in Zabbix überwacht ist.

Verfügbarkeit = 1 - Ausfall / (überwachte Zeit - Wartung).
"""

from collections.abc import Iterable
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.modules.inventory.models import InventoryCity, InventorySite
from werkbank.modules.monitoring.zabbix.client import ZabbixClient
from werkbank.modules.monitoring.zabbix.models import (
    ZbxDowntime,
    ZbxHost,
    ZbxMaintLog,
    ZbxOutage,
    ZbxReportDay,
    ZbxStatus,
    ZbxTriggerStat,
)

# Tage beginnen und enden in dieser Zeitzone
REPORT_TZ = ZoneInfo("Europe/Berlin")
# So weit zurück sucht die Werkbank nach Ausfällen, die vor dem Tag begonnen haben
LOOKBACK = timedelta(days=90)
# Höchstens so viele Tage je Lauf (nach einer Pause holt die Werkbank in Schritten auf)
DAYS_PER_RUN = 7
KEEP_YEARS = 3
KEEP_MAINT_LOG = timedelta(days=40)
# Zwei Beobachtungen mit kleinerem Abstand gehören zur selben Wartung
MAINT_GAP = timedelta(minutes=3)
NO_HOST = "0"

Interval = tuple[int, int]


def merge(intervals: Iterable[Interval]) -> list[Interval]:
    """Vereinigt überlappende oder aneinanderstoßende Zeiträume."""
    out: list[Interval] = []
    for start, end in sorted(item for item in intervals if item[1] > item[0]):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def subtract(base: list[Interval], cut: list[Interval]) -> list[Interval]:
    """base ohne cut; beide vereinigt und sortiert."""
    out: list[Interval] = []
    for start, end in base:
        current = start
        for cut_start, cut_end in cut:
            if cut_end <= current or cut_start >= end:
                continue
            if cut_start > current:
                out.append((current, cut_start))
            current = max(current, cut_end)
            if current >= end:
                break
        if current < end:
            out.append((current, end))
    return out


def total(intervals: Iterable[Interval]) -> int:
    return sum(end - start for start, end in intervals)


def day_bounds(day: date) -> tuple[int, int]:
    """Beginn und Ende eines Tages als Unix-Zeit (23 oder 25 Stunden bei der Zeitumstellung)."""
    start = datetime.combine(day, time(0), REPORT_TZ)
    end = datetime.combine(day + timedelta(days=1), time(0), REPORT_TZ)
    return int(start.timestamp()), int(end.timestamp())


def local_day(moment: datetime) -> date:
    return moment.astimezone(REPORT_TZ).date()


def site_names(db: Session) -> dict[int, str]:
    rows = db.execute(
        select(InventorySite.id, InventorySite.name, InventoryCity.name).join(
            InventoryCity, InventoryCity.id == InventorySite.city_id
        )
    )
    return {site_id: f"{name} ({city})" for site_id, name, city in rows}


def group_names(host: ZbxHost) -> list[str]:
    return sorted(
        str(group.get("name"))[:255]
        for group in host.groups or []
        if isinstance(group, dict) and group.get("name")
    )


# ---------- Beobachtung der Wartungen (jede Minute) ----------


def observe_maintenance(db: Session, hosts: Iterable[ZbxHost], now: datetime) -> None:
    """Verlängert die Wartung jedes Hosts, der gerade in Wartung ist, bis jetzt."""
    in_maintenance = {host.hostid for host in hosts if host.in_maintenance and host.monitored}
    if not in_maintenance:
        return
    open_logs = {
        log.hostid: log
        for log in db.scalars(
            select(ZbxMaintLog)
            .where(ZbxMaintLog.ended_at >= now - MAINT_GAP)
            .order_by(ZbxMaintLog.ended_at)
        )
    }
    for hostid in in_maintenance:
        log = open_logs.get(hostid)
        if log is None:
            db.add(ZbxMaintLog(hostid=hostid, started_at=now, ended_at=now))
        else:
            log.ended_at = now


# ---------- Erzeugen der Tage ----------


def pending_days(db: Session, today: date) -> list[date]:
    """Abgeschlossene Tage ab dem Beginn der Berichte, die noch fehlen."""
    status = db.get(ZbxStatus, 1)
    if status is None or status.reports_since is None:
        return []
    last = db.scalar(select(func.max(ZbxReportDay.day)))
    first = (
        status.reports_since
        if last is None
        else max(last + timedelta(days=1), status.reports_since)
    )
    days: list[date] = []
    day = first
    while day < today and len(days) < DAYS_PER_RUN:
        days.append(day)
        day += timedelta(days=1)
    return days


def process_day(db: Session, client: ZabbixClient, day: date, now: datetime) -> None:
    """Erzeugt die Berichtsdaten eines abgeschlossenen Tages."""
    start, end = day_bounds(day)
    hosts = {host.hostid: host for host in db.scalars(select(ZbxHost))}
    sites = site_names(db)

    def site_of(hostid: str) -> str | None:
        host = hosts.get(hostid)
        return sites.get(host.site_id) if host is not None and host.site_id else None

    # Ausfälle, die den Tag berühren
    lookback = start - int(LOOKBACK.total_seconds())
    outages = client.problem_events(lookback, end - 1, availability=True)
    ends = client.event_clocks(sorted({e.r_eventid for e in outages if e.r_eventid != "0"}))
    per_host: dict[str, list[Interval]] = {}
    for event in outages:
        ended = ends.get(event.r_eventid) if event.r_eventid != "0" else None
        if ended is not None and ended <= start:
            continue
        clipped = (max(event.clock, start), min(ended if ended is not None else end, end))
        known = [hostid for hostid in event.hostids if hostid in hosts]
        for hostid in known:
            per_host.setdefault(hostid, []).append(clipped)
        if not known:
            continue
        row = db.get(ZbxOutage, event.eventid)
        if row is None:
            row = ZbxOutage(eventid=event.eventid)
            db.add(row)
        row.hostid = known[0]
        row.host = hosts[known[0]].name[:255]
        row.site = site_of(known[0])
        row.name = event.name[:255]
        row.started_at = datetime.fromtimestamp(event.clock, REPORT_TZ)
        row.ended_at = datetime.fromtimestamp(ended, REPORT_TZ) if ended is not None else None

    # Wartungen des Tages (eigene Beobachtung)
    maintenance: dict[str, list[Interval]] = {}
    for log in db.scalars(
        select(ZbxMaintLog).where(
            ZbxMaintLog.ended_at >= datetime.fromtimestamp(start, REPORT_TZ),
            ZbxMaintLog.started_at < datetime.fromtimestamp(end, REPORT_TZ),
        )
    ):
        maintenance.setdefault(log.hostid, []).append(
            (max(int(log.started_at.timestamp()), start), min(int(log.ended_at.timestamp()), end))
        )

    db.execute(delete(ZbxDowntime).where(ZbxDowntime.day == day))
    for hostid, host in hosts.items():
        maint = merge(maintenance.get(hostid, []))
        down = subtract(merge(per_host.get(hostid, [])), maint)
        monitored = host.monitored
        db.add(
            ZbxDowntime(
                day=day,
                hostid=hostid,
                host=host.name[:255],
                site=site_of(hostid),
                groups=group_names(host),
                monitored_s=end - start if monitored else 0,
                maintenance_s=total(maint) if monitored else 0,
                downtime_s=total(down) if monitored else 0,
            )
        )

    # Alle Probleme, die an dem Tag begonnen haben: Anzahl und Dauer je Trigger und Host
    started = client.problem_events(start, end - 1)
    ends = client.event_clocks(sorted({e.r_eventid for e in started if e.r_eventid != "0"}))
    month = day.replace(day=1)
    now_ts = int(now.timestamp())
    for event in started:
        ended = ends.get(event.r_eventid) if event.r_eventid != "0" else None
        duration = max((ended if ended is not None else now_ts) - event.clock, 0)
        for hostid in event.hostids or [NO_HOST]:
            stat = db.get(ZbxTriggerStat, (month, event.triggerid, hostid))
            if stat is None:
                stat = ZbxTriggerStat(
                    month=month, triggerid=event.triggerid, hostid=hostid, count=0, duration_s=0
                )
                db.add(stat)
            owner = hosts.get(hostid)
            stat.name = event.name[:255]
            stat.host = owner.name[:255] if owner is not None else ""
            stat.count += 1
            stat.duration_s += duration
    db.add(ZbxReportDay(day=day, processed_at=now))


def cleanup(db: Session, now: datetime) -> None:
    oldest = local_day(now).replace(year=local_day(now).year - KEEP_YEARS)
    db.execute(delete(ZbxDowntime).where(ZbxDowntime.day < oldest))
    db.execute(delete(ZbxReportDay).where(ZbxReportDay.day < oldest))
    db.execute(delete(ZbxTriggerStat).where(ZbxTriggerStat.month < oldest.replace(day=1)))
    db.execute(
        delete(ZbxOutage).where(ZbxOutage.started_at < datetime.combine(oldest, time(0), REPORT_TZ))
    )
    db.execute(delete(ZbxMaintLog).where(ZbxMaintLog.ended_at < now - KEEP_MAINT_LOG))


def run_reports(db: Session, client: ZabbixClient, now: datetime) -> dict[str, int]:
    """Erzeugt fehlende Tage. Beim ersten Lauf beginnt die Sammlung mit dem heutigen Tag."""
    today = local_day(now)
    status = db.get(ZbxStatus, 1)
    if status is None:
        status = ZbxStatus(id=1, account={})
        db.add(status)
    if status.reports_since is None:
        status.reports_since = today
        db.commit()
    days = pending_days(db, today)
    for day in days:
        process_day(db, client, day, now)
        # Jeder Tag für sich: ein Fehler an einem späteren Tag verwirft die früheren nicht
        db.commit()
    cleanup(db, now)
    return {"tage": len(days)}
