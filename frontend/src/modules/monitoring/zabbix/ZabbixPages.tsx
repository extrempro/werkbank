import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../../api";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import type { HelpKey } from "../../../help/terms";
import { Link } from "../../../components/Link";
import { SplitHandle, useSplit } from "../../../components/SplitHandle";
import {
  ADMIN_CONNECTIONS_PATH,
  MONITORING_ZABBIX_HOSTS_PATH,
  MONITORING_ZABBIX_MAINTENANCE_PATH,
} from "../../../navigation";
import { navigate } from "../../../router";
import { ConfirmButton } from "../../../components/ConfirmDialog";
import { hardwarePath, type LookupItem } from "../../inventory/api";
import { LookupPicker } from "../../inventory/LookupPicker";
import {
  fetchZabbixConnection,
  fetchZabbixHost,
  fetchZabbixHosts,
  fetchZabbixMaintenances,
  fetchZabbixOverview,
  fetchZabbixUnmonitored,
  linkHost,
  markUnmonitored,
  unlinkHost,
  unmarkUnmonitored,
  MAINTENANCE_STATES,
  saveZabbixOptions,
  SEVERITIES,
  severityClass,
  severityLabel,
  cellLabel,
  overviewHeadline,
  type DataState,
  type DeviceRef,
  type InventoryGap,
  type ZbxConnection,
  type ZbxHostDetail,
  type ZbxHostRow,
  type ZbxMaintenance,
  type ZbxOverview,
  type ZbxHour,
  type ZbxProblem,
  type ZbxSiteHealth,
  type ZbxUnmonitored,
} from "./api";
import { Feedback } from "../../../components/Feedback";

const MONITORING_ROLES = ["Monitoring.Reader"];
const INVENTORY_EDITOR = "Bestand.Editor";

/** Verknüpfen mit dem IT-Bestand: Monitoring sehen und den Bestand pflegen. */
function canLinkInventory(roles: readonly string[]): boolean {
  return roles.includes(INVENTORY_EDITOR) && MONITORING_ROLES.some((role) => roles.includes(role));
}

const GAP_LABELS: Record<InventoryGap, string> = {
  ohne_bestand: "kein Bestandseintrag",
  seriennummer_fehlt: "Seriennummer fehlt",
};

function deviceLabel(device: DeviceRef): string {
  return device.inventory_no ? `${device.inventory_no} ${device.name}` : device.name;
}

// Die Seiten laden ihre Daten jede Minute neu, wie der Collector abfragt
const REFRESH_MS = 60_000;

function useLoaded<T>(load: () => Promise<T>, message: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const run = () =>
      load().then(
        (value) => {
          if (active) {
            setData(value);
            setError(null);
          }
        },
        (caught: unknown) => active && setError(errorText(caught, message)),
      );
    void run();
    const timer = window.setInterval(() => void run(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, setData };
}

/** „seit 3 Std.“ und Ähnliches, grob genug für einen Blick. */
export function age(iso: string | null, now: number = Date.now()): string {
  if (!iso) {
    return "–";
  }
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) {
    return "gerade eben";
  }
  if (minutes < 60) {
    return `${minutes} Min.`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} Std.`;
  }
  return `${Math.round(hours / 24)} Tagen`;
}

function Severity({ value }: { value: number }) {
  return <span className={severityClass(value)}>{severityLabel(value)}</span>;
}

function ZabbixButton({ href, label }: { href: string | null; label?: string }) {
  if (!href) {
    return null;
  }
  return (
    <a className="button button-secondary" href={href} target="_blank" rel="noopener noreferrer">
      In Zabbix öffnen
      <span className="visually-hidden"> {label ? `(${label}) ` : ""}(neuer Tab)</span>
    </a>
  );
}

/** Stand der Daten, immer sichtbar. */
export function DataStateBar({ state }: { state: DataState }) {
  if (!state.configured) {
    return (
      <p className="hint-box">
        Zabbix ist noch nicht eingerichtet. Ein Admin trägt Adresse und Token in der Verwaltung
        unter <Link to={ADMIN_CONNECTIONS_PATH}>Verbindungen</Link> ein.
      </p>
    );
  }
  return (
    <>
      <p className="small zbx-state" role="status">
        {state.data_at ? `Stand ${formatDateTime(state.data_at)}` : "Noch keine Daten."}
        {state.next_at && ` · nächste Abfrage ${formatDateTime(state.next_at)}`}
      </p>
      {state.error && (
        <p className={state.stale ? "hint-box hint-bad" : "hint-box hint-warn"} role="alert">
          Die letzte Abfrage ist fehlgeschlagen: {state.error}
          {state.data_at ? " Angezeigt wird der letzte Stand." : ""}
        </p>
      )}
    </>
  );
}

function ZabbixHead({
  title,
  sub,
  state,
  label = "IT-Monitoring · Zabbix",
}: {
  title: string;
  sub: string;
  state?: DataState;
  label?: string;
}) {
  return (
    <header className="page-head zbx-head">
      <div>
        <p className="module-label">{label}</p>
        <h1>{title}</h1>
        <p className="page-sub">{sub}</p>
      </div>
      {state?.zabbix_url && <ZabbixButton href={state.zabbix_url} />}
    </header>
  );
}

function ProblemTable({ problems, empty }: { problems: ZbxProblem[]; empty: string }) {
  if (problems.length === 0) {
    return <p className="empty">{empty}</p>;
  }
  return (
    <div className="table-wrap card-wrap">
      <table className="table-cards zbx-problems">
        <thead>
          <tr>
            <th scope="col">Schweregrad</th>
            <th scope="col">Problem</th>
            <th scope="col">Host</th>
            <th scope="col">Seit</th>
            <th scope="col">
              <span className="visually-hidden">Aktion</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {problems.map((problem) => (
            <tr key={problem.eventid}>
              <td data-label="Schweregrad">
                <Severity value={problem.severity} />
              </td>
              <th scope="row">
                <span>{problem.name}</span>
                {(problem.acknowledged || problem.tags.length > 0) && (
                  <span className="small zbx-tags">
                    {problem.acknowledged && <span className="pill pill-neutral">quittiert</span>}
                    {problem.tags.map((tag) => (
                      <span key={tag} className="pill pill-neutral">
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </th>
              <td data-label="Host">
                {problem.hostid ? (
                  <Link to={`${MONITORING_ZABBIX_HOSTS_PATH}/${problem.hostid}`}>
                    {problem.host ?? problem.hostid}
                  </Link>
                ) : (
                  "–"
                )}
                {problem.site && <span className="small"> · {problem.site}</span>}
              </td>
              <td data-label="Seit" className="nowrap">
                <span title={formatDateTime(problem.since)}>{age(problem.since)}</span>
              </td>
              <td className="nowrap">
                <ZabbixButton href={problem.link} label={problem.name} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MaintenanceList({ items }: { items: ZbxMaintenance[] }) {
  if (items.length === 0) {
    return <p className="empty">Keine Wartungen.</p>;
  }
  return (
    <ul className="rows">
      {items.map((item) => (
        <li key={item.maintenanceid} className="row">
          <span className="row-main">
            <span className="row-title">{item.name}</span>
            <span className="small">
              {item.windows.length > 0
                ? item.windows
                    .slice(0, 3)
                    .map(([start, end]) => `${formatDateTime(start)} bis ${formatDateTime(end)}`)
                    .join(" · ")
                : item.recurring.join(" · ") ||
                  `${formatDateTime(item.active_since)} bis ${formatDateTime(item.active_till)}`}
              {" · "}
              {item.hosts === 1 ? "1 Host" : `${item.hosts} Hosts`}
              {item.with_data ? "" : " · ohne Datensammlung"}
            </span>
          </span>
          <span className={item.state === "laeuft" ? "pill pill-todo" : "pill pill-neutral"}>
            {MAINTENANCE_STATES[item.state]}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Übersicht ----------

function TodoRow({
  title,
  term,
  text,
  count,
  to,
}: {
  title: string;
  term: HelpKey;
  text: string;
  count: number;
  to: string;
}) {
  return (
    <li className="row">
      <span className="row-main">
        <span className="row-title">
          {count > 0 ? <Link to={to}>{title}</Link> : title} <InfoTip term={term} />
        </span>
        <span className="small">{text}</span>
      </span>
      <span className={count > 0 ? "pill pill-todo" : "pill pill-neutral"}>{count}</span>
    </li>
  );
}

/** Filter der Übersicht: „alle“, ein Standortname oder "" für Hosts ohne Standort. */
const ALL_SITES = "alle";

function SeverityBar({
  counts,
  chosen,
  onPick,
}: {
  counts: { value: number; label: string; count: number }[];
  chosen: number | null;
  onPick: (value: number | null) => void;
}) {
  const shown = counts.filter((entry) => entry.count > 0);
  if (shown.length === 0) {
    return <p className="empty">Keine offenen Probleme.</p>;
  }
  return (
    <>
      <div className="zbx-sevbar">
        {shown.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={`${severityClass(entry.value)} zbx-sevbar-part${chosen !== null && chosen !== entry.value ? " zbx-dim" : ""}`}
            style={{ flexGrow: entry.count }}
            aria-pressed={chosen === entry.value}
            aria-label={`${entry.label}: ${entry.count} ${entry.count === 1 ? "Problem" : "Probleme"}`}
            onClick={() => onPick(chosen === entry.value ? null : entry.value)}
          >
            {entry.count}
          </button>
        ))}
      </div>
      <div className="chips">
        {shown.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="chip chip-filter"
            aria-pressed={chosen === entry.value}
            onClick={() => onPick(chosen === entry.value ? null : entry.value)}
          >
            <span className={`zbx-swatch ${severityClass(entry.value)}`} aria-hidden="true" />
            {entry.label} · {entry.count}
          </button>
        ))}
      </div>
    </>
  );
}

function SiteTile({
  site,
  chosen,
  onPick,
}: {
  site: ZbxSiteHealth;
  chosen: boolean;
  onPick: () => void;
}) {
  const state =
    site.worst !== null
      ? severityLabel(site.worst)
      : site.unreachable > 0
        ? "nicht erreichbar"
        : "in Ordnung";
  const dot =
    site.worst !== null
      ? `zbx-cell-${site.worst}`
      : site.unreachable > 0
        ? "zbx-cell-down"
        : "zbx-cell-ok";
  return (
    <button type="button" className="zbx-site" aria-pressed={chosen} onClick={onPick}>
      <span className="zbx-site-head">
        <span className={`zbx-cell zbx-dot ${dot}`} aria-hidden="true" />
        <strong>{site.name ?? "Ohne Standort"}</strong>
        <span className="small">{state}</span>
      </span>
      <span className="small">
        {site.hosts} {site.hosts === 1 ? "Host" : "Hosts"} · {site.unreachable} nicht erreichbar ·{" "}
        {site.problems} {site.problems === 1 ? "Problem" : "Probleme"}
        {site.maintenance > 0 && ` · ${site.maintenance} in Wartung`}
      </span>
      <span className="zbx-cells" aria-hidden="true">
        {site.cells.map((cell) => (
          <span
            key={cell.hostid}
            className={`zbx-cell zbx-cell-${cell.state}`}
            title={cellLabel(cell)}
          />
        ))}
      </span>
    </button>
  );
}

const CELL_LEGEND: { state: string; label: string }[] = [
  { state: "ok", label: "in Ordnung" },
  { state: "1", label: "Information" },
  { state: "2", label: "Warnung" },
  { state: "3", label: "Durchschnitt" },
  { state: "4", label: "Hoch" },
  { state: "5", label: "Katastrophe" },
  { state: "down", label: "nicht erreichbar" },
  { state: "wartung", label: "in Wartung" },
];

function HistoryChart({ hours }: { hours: ZbxHour[] }) {
  const values = hours.map((entry) => entry.open ?? 0);
  const max = Math.max(1, ...values);
  const known = hours.filter((entry) => entry.open !== null);
  const last = known[known.length - 1];
  const peak = known.reduce<ZbxHour | null>(
    (best, entry) => (best === null || (entry.open ?? 0) > (best.open ?? 0) ? entry : best),
    null,
  );
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (known.length === 0) {
    return <p className="empty">Der Verlauf beginnt mit dem nächsten Abruf.</p>;
  }
  const label = `Offene Probleme je Stunde: zuletzt ${last?.open ?? 0}${
    peak ? `, höchstens ${peak.open ?? 0} um ${clock(peak.hour)} Uhr` : ""
  }.`;
  return (
    <>
      <div className="zbx-hours" role="img" aria-label={label}>
        {hours.map((entry, index) => (
          <span
            key={entry.hour}
            className={
              entry.open === null
                ? "zbx-hour zbx-hour-empty"
                : index === hours.length - 1
                  ? "zbx-hour zbx-hour-now"
                  : "zbx-hour"
            }
            style={{ height: `${Math.max(2, Math.round(((entry.open ?? 0) / max) * 100))}%` }}
            title={`${clock(entry.hour)} Uhr: ${entry.open === null ? "kein Abruf" : `${entry.open} offen`}`}
          />
        ))}
      </div>
      <span className="zbx-hours-axis small">
        <span>vor 24 Stunden</span>
        <span>jetzt</span>
      </span>
      <p className="small">{label}</p>
    </>
  );
}

export function ZabbixOverviewPage() {
  const { data, error } = useLoaded<ZbxOverview>(
    fetchZabbixOverview,
    "Die Übersicht konnte nicht geladen werden.",
  );
  const [site, setSite] = useState(ALL_SITES);
  const [severity, setSeverity] = useState<number | null>(null);
  const inSite = useMemo(
    () =>
      (data?.problems ?? []).filter(
        (problem) => site === ALL_SITES || (problem.site ?? "") === site,
      ),
    [data, site],
  );
  const problems = inSite.filter((problem) => severity === null || problem.severity === severity);
  const counts = SEVERITIES.filter((entry) => entry.value > 0).map((entry) => ({
    value: entry.value,
    label: entry.label,
    count: inSite.filter((problem) => Math.max(1, problem.severity) === entry.value).length,
  }));
  const headline = data ? overviewHeadline(data) : null;
  const filters = [
    site === ALL_SITES ? null : site || "Ohne Standort",
    severity === null ? null : `nur ${severityLabel(severity)}`,
  ].filter(Boolean);
  const todoCount = data
    ? data.todo.long_open + data.todo.unmonitored + data.todo.no_inventory + data.todo.no_serial
    : 0;

  return (
    <div className="page page-wide">
      <ZabbixHead
        title="Übersicht"
        sub="Der aktuelle Stand auf einen Blick. Daten aus Zabbix, nur lesend."
        state={data?.state}
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && <DataStateBar state={data.state} />}
      {data && headline && data.state.configured && (
        <>
          <section className="zbx-summary" aria-label="Gesamtstand">
            <div className={`zbx-hero zbx-hero-${headline.tone}`}>
              <span className="zbx-hero-ring" aria-hidden="true" />
              <div>
                <h2>
                  {headline.title} <InfoTip term="zabbix.gesamtstand" />
                </h2>
                <p>{headline.text}</p>
              </div>
            </div>
            <div className="zbx-card">
              <span className="zbx-card-title">
                Hosts erreichbar <InfoTip term="zabbix.nicht-erreichbar" />
              </span>
              <strong className="zbx-card-number">
                {data.kpis.hosts - data.kpis.unreachable}{" "}
                <span className="small">von {data.kpis.hosts}</span>
              </strong>
              <meter
                className="zbx-meter"
                min={0}
                max={Math.max(1, data.kpis.hosts)}
                value={data.kpis.hosts - data.kpis.unreachable}
                aria-label="Anteil erreichbarer Hosts"
              />
              {data.kpis.maintenance > 0 && (
                <span className="small">
                  {data.kpis.maintenance} in Wartung <InfoTip term="zabbix.wartung" />
                </span>
              )}
            </div>
            <div className="zbx-card">
              <span className="zbx-card-title">Zu erledigen</span>
              <strong className="zbx-card-number">{todoCount}</strong>
              <span className="small">
                {data.todo.long_open} lange offen · {data.todo.unmonitored} nicht überwacht
              </span>
              <a href="#zbx-todo">Zur Liste</a>
            </div>
          </section>

          <section className="panel" aria-labelledby="zbx-sev">
            <div className="panel-head">
              <h2 id="zbx-sev">Offene Probleme nach Schweregrad</h2>
              <span className="small">Ein Klick filtert die Liste unten</span>
            </div>
            <div className="detail-body zbx-sev-body">
              <SeverityBar counts={counts} chosen={severity} onPick={setSeverity} />
            </div>
          </section>

          {data.site_health.length > 0 && (
            <section className="zbx-sites-wrap" aria-labelledby="zbx-sites">
              <div className="zbx-sites-head">
                <h2 id="zbx-sites">Standorte</h2>
                <span className="small">
                  Jedes Kästchen ist ein Host, die Farbe zeigt seinen schlimmsten Zustand
                </span>
              </div>
              <div className="zbx-sites">
                {data.site_health.map((entry) => {
                  const value = entry.name ?? "";
                  return (
                    <SiteTile
                      key={value || "ohne"}
                      site={entry}
                      chosen={site === value}
                      onPick={() => setSite(site === value ? ALL_SITES : value)}
                    />
                  );
                })}
              </div>
              <ul className="zbx-legend small" aria-label="Legende der Kästchen">
                {CELL_LEGEND.map((entry) => (
                  <li key={entry.state}>
                    <span className={`zbx-cell zbx-cell-${entry.state}`} aria-hidden="true" />
                    {entry.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="zbx-probleme">
            <div className="panel-head">
              <h2 id="zbx-probleme">Aktuelle Probleme</h2>
              <span className="small" role="status">
                {filters.length > 0 ? `${filters.join(" · ")} · ` : ""}
                {problems.length} {problems.length === 1 ? "Problem" : "Probleme"}
              </span>
              {filters.length > 0 && (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setSite(ALL_SITES);
                    setSeverity(null);
                  }}
                >
                  Filter zurücksetzen
                </button>
              )}
            </div>
            <ProblemTable problems={problems} empty="Keine Probleme für diese Auswahl." />
          </section>

          <div className="zbx-main">
            <div className="zbx-side">
              <section className="panel" aria-labelledby="zbx-verlauf">
                <div className="panel-head">
                  <h2 id="zbx-verlauf">
                    Letzte 24 Stunden <InfoTip term="zabbix.verlauf" />
                  </h2>
                </div>
                <div className="detail-body">
                  <HistoryChart hours={data.history} />
                </div>
              </section>
              <section className="panel" aria-labelledby="zbx-down">
                <div className="panel-head">
                  <h2 id="zbx-down">Nicht erreichbar</h2>
                  <Link to={`${MONITORING_ZABBIX_HOSTS_PATH}?filter=nicht-erreichbar`}>
                    Alle Hosts
                  </Link>
                </div>
                {data.unreachable.length === 0 ? (
                  <p className="empty">Alle überwachten Hosts sind erreichbar.</p>
                ) : (
                  <ul className="rows">
                    {data.unreachable.map((host) => (
                      <li key={host.hostid} className="row">
                        <span className="row-main">
                          <Link to={`${MONITORING_ZABBIX_HOSTS_PATH}/${host.hostid}`}>
                            {host.name}
                          </Link>
                          <span className="small">
                            {host.site ?? "ohne Standort"}
                            {host.since
                              ? ` · zuletzt erreichbar vor ${age(host.since)}`
                              : " · noch nie erreichbar gesehen"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="panel" aria-labelledby="zbx-wartungen">
                <div className="panel-head">
                  <h2 id="zbx-wartungen">Wartungen</h2>
                  <Link to={MONITORING_ZABBIX_MAINTENANCE_PATH}>Alle</Link>
                </div>
                <MaintenanceList items={data.maintenances} />
              </section>
            </div>
          </div>
          <section className="panel" aria-labelledby="zbx-todo-titel" id="zbx-todo" tabIndex={-1}>
            <div className="panel-head">
              <h2 id="zbx-todo-titel">Zu erledigen</h2>
            </div>
            <ul className="rows">
              <li className="row">
                <span className="row-main">
                  <span className="row-title">
                    Lange offen <InfoTip term="zabbix.lange-offen" />
                  </span>
                  <span className="small">Probleme, die seit mehr als 7 Tagen offen sind</span>
                </span>
                <span className="pill pill-neutral">{data.todo.long_open}</span>
              </li>
              <TodoRow
                title="Nicht überwacht"
                term="zabbix.nicht-ueberwacht"
                text="Geräte im IT-Bestand ohne passenden Host in Zabbix"
                count={data.todo.unmonitored}
                to={`${MONITORING_ZABBIX_HOSTS_PATH}?filter=nicht-ueberwacht`}
              />
              <TodoRow
                title="Ohne Bestandseintrag"
                term="zabbix.ohne-bestand"
                text="Hosts, deren Seriennummer im IT-Bestand fehlt"
                count={data.todo.no_inventory}
                to={`${MONITORING_ZABBIX_HOSTS_PATH}?filter=ohne-bestand`}
              />
              <TodoRow
                title="Seriennummer fehlt"
                term="zabbix.seriennummer-fehlt"
                text="Hosts ohne Seriennummer im Zabbix-Inventar"
                count={data.todo.no_serial}
                to={`${MONITORING_ZABBIX_HOSTS_PATH}?filter=seriennummer-fehlt`}
              />
              {data.todo.certificate_tag ? (
                <li className="row">
                  <span className="row-main">
                    <span className="row-title">Zertifikate</span>
                    <span className="small">
                      Offene Probleme mit dem Tag „{data.todo.certificate_tag}“
                      {data.todo.certificates.length > 0 &&
                        `: ${data.todo.certificates
                          .slice(0, 3)
                          .map((problem) => problem.host ?? problem.name)
                          .join(", ")}`}
                    </span>
                  </span>
                  <span className="pill pill-neutral">{data.todo.certificates.length}</span>
                </li>
              ) : null}
            </ul>
          </section>
          <p className="small">
            Nur lesend. Quittieren und Wartungen anlegen kommen in einer späteren Stufe, dann mit
            Bestätigung durch das Admin-Konto.
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Hosts ----------

type HostFilter =
  | "alle"
  | "probleme"
  | "nicht-erreichbar"
  | "wartung"
  | "ohne-bestand"
  | "seriennummer-fehlt"
  | "nicht-ueberwacht"
  | "abgeschaltet";

const HOST_FILTERS: { value: HostFilter; label: string; test: (host: ZbxHostRow) => boolean }[] = [
  { value: "alle", label: "Alle", test: (host) => host.monitored },
  { value: "probleme", label: "Mit Problemen", test: (host) => host.problems > 0 },
  {
    value: "nicht-erreichbar",
    label: "Nicht erreichbar",
    test: (host) => host.monitored && host.reachable === false && !host.in_maintenance,
  },
  { value: "wartung", label: "In Wartung", test: (host) => host.in_maintenance },
  {
    value: "ohne-bestand",
    label: "Ohne Bestandseintrag",
    test: (host) => host.gap === "ohne_bestand",
  },
  {
    value: "seriennummer-fehlt",
    label: "Seriennummer fehlt",
    test: (host) => host.gap === "seriennummer_fehlt",
  },
  // zeigt Geräte aus dem IT-Bestand statt Hosts
  { value: "nicht-ueberwacht", label: "Nicht überwacht", test: () => false },
  {
    value: "abgeschaltet",
    label: "In Zabbix abgeschaltet",
    test: (host) => !host.monitored,
  },
];

function hostState(host: {
  monitored: boolean;
  reachable: boolean | null;
  in_maintenance: boolean;
}) {
  if (!host.monitored) {
    return { label: "abgeschaltet", pill: "pill pill-neutral" };
  }
  if (host.in_maintenance) {
    return { label: "in Wartung", pill: "pill pill-todo" };
  }
  if (host.reachable === false) {
    return { label: "nicht erreichbar", pill: "pill pill-bad" };
  }
  if (host.reachable === null) {
    return { label: "unbekannt", pill: "pill pill-neutral" };
  }
  return { label: "erreichbar", pill: "pill pill-ok" };
}

const SPLIT_KEY = "werkbank-zabbix-hosts-breite";

function initialFilter(): HostFilter {
  const value = new URLSearchParams(window.location.search).get("filter");
  return HOST_FILTERS.some((entry) => entry.value === value) ? (value as HostFilter) : "alle";
}

export function ZabbixHostsPage({
  hostId,
  roles,
}: {
  hostId: string | null;
  roles: readonly string[];
}) {
  const { data, error } = useLoaded<ZbxHostRow[]>(
    fetchZabbixHosts,
    "Die Hosts konnten nicht geladen werden.",
  );
  const unmonitored = useLoaded<ZbxUnmonitored>(
    fetchZabbixUnmonitored,
    "Die Geräte ohne Host konnten nicht geladen werden.",
  );
  const canLink = canLinkInventory(roles);
  const [filter, setFilter] = useState<HostFilter>(initialFilter);
  const [search, setSearch] = useState("");
  const [site, setSite] = useState("alle");
  const layoutRef = useRef<HTMLDivElement>(null);
  const [split, changeSplit] = useSplit(SPLIT_KEY);
  const sites = useMemo(
    () => [...new Set((data ?? []).map((host) => host.site).filter(Boolean))].sort() as string[],
    [data],
  );
  const needle = search.trim().toLowerCase();
  const shown = (data ?? []).filter(
    (host) =>
      HOST_FILTERS.find((entry) => entry.value === filter)!.test(host) &&
      (site === "alle" || (host.site ?? "") === site) &&
      (!needle ||
        host.name.toLowerCase().includes(needle) ||
        host.host.toLowerCase().includes(needle) ||
        host.serial.toLowerCase().includes(needle) ||
        host.groups.some((group) => group.toLowerCase().includes(needle))),
  );
  const backToList = () => navigate(MONITORING_ZABBIX_HOSTS_PATH);

  return (
    <div className="page page-wide case-page">
      <ZabbixHead title="Hosts" sub="Alle Hosts aus Zabbix mit Zustand, Problemen und Standort." />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <FilterBar<HostFilter>
        search={{
          label: "Hosts durchsuchen",
          value: search,
          placeholder: "Name, Gruppe, Seriennummer …",
          onChange: setSearch,
        }}
        status={{
          label: "Zustand",
          value: filter,
          onChange: setFilter,
          options: HOST_FILTERS.map((entry) => ({
            value: entry.value,
            label: entry.label,
            count:
              entry.value === "nicht-ueberwacht"
                ? (unmonitored.data?.missing.length ?? null)
                : data
                  ? data.filter(entry.test).length
                  : null,
          })),
        }}
        moreActive={site !== "alle" ? 1 : 0}
        onReset={
          search !== "" || filter !== "alle" || site !== "alle"
            ? () => {
                setSearch("");
                setFilter("alle");
                setSite("alle");
              }
            : undefined
        }
        more={
          <label className="filter-field">
            Standort
            <select value={site} onChange={(event) => setSite(event.target.value)}>
              <option value="alle">Alle Standorte</option>
              {sites.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="">Ohne Standort</option>
            </select>
          </label>
        }
      />
      <div
        ref={layoutRef}
        className={
          hostId === null
            ? "case-layout case-layout-table"
            : "case-layout case-layout-table case-layout-detail"
        }
        style={{ "--case-split": split } as CSSProperties}
      >
        <div className="panel case-list">
          <div className="case-scroll">
            {filter === "nicht-ueberwacht" ? (
              <UnmonitoredList
                state={unmonitored.data}
                error={unmonitored.error}
                canLink={canLink}
                onChanged={unmonitored.setData}
                needle={needle}
              />
            ) : (
              <>
                {!data && !error && <p role="status">Wird geladen …</p>}
                {data && shown.length === 0 && (
                  <p className="empty">Kein Host passt zur Auswahl.</p>
                )}
                {shown.length > 0 && (
                  <table className="case-table" aria-label="Hosts">
                    <thead>
                      <tr>
                        <th scope="col">Host</th>
                        <th scope="col" className="col-extra">
                          Standort
                        </th>
                        <th scope="col" className="col-extra">
                          Gruppen
                        </th>
                        <th scope="col">Zustand</th>
                        <th scope="col">Probleme</th>
                        <th scope="col" className="col-extra">
                          IT-Bestand
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((host) => (
                        <HostRowView
                          key={host.hostid}
                          host={host}
                          selected={host.hostid === hostId}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
        {hostId !== null && (
          <SplitHandle value={split} onChange={changeSplit} container={() => layoutRef.current} />
        )}
        <div className="case-main">
          {hostId !== null && (
            <>
              <a
                className="case-back"
                href={MONITORING_ZABBIX_HOSTS_PATH}
                onClick={(event) => {
                  event.preventDefault();
                  backToList();
                }}
              >
                ‹ Zur Liste
              </a>
              <HostDetail key={hostId} hostId={hostId} canLink={canLink} onClose={backToList} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HostRowView({ host, selected }: { host: ZbxHostRow; selected: boolean }) {
  const path = `${MONITORING_ZABBIX_HOSTS_PATH}/${host.hostid}`;
  const state = hostState(host);
  return (
    <tr
      className={selected ? "case-row is-selected" : "case-row"}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a")) {
          navigate(path);
        }
      }}
    >
      <td className="case-title-cell">
        <span className="case-meta small">
          {host.site ?? "ohne Standort"}
          {host.groups.length > 0 && ` · ${host.groups[0]}`}
        </span>
        <a
          href={path}
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
            if (event.button !== 0 || modified) {
              return;
            }
            event.preventDefault();
            navigate(path);
          }}
        >
          {host.name}
        </a>
      </td>
      <td className="col-extra">{host.site ?? "–"}</td>
      <td className="col-extra">{host.groups.join(", ") || "–"}</td>
      <td className="nowrap">
        <span className={state.pill}>{state.label}</span>
      </td>
      <td className="nowrap">
        {host.problems > 0 && host.worst !== null ? (
          <>
            {host.problems} <Severity value={host.worst} />
          </>
        ) : (
          "–"
        )}
      </td>
      <td className="col-extra">
        {host.device ? deviceLabel(host.device) : host.gap ? GAP_LABELS[host.gap] : "–"}
      </td>
    </tr>
  );
}

function UnmonitoredList({
  state,
  error,
  canLink,
  onChanged,
  needle,
}: {
  state: ZbxUnmonitored | null;
  error: string | null;
  canLink: boolean;
  onChanged: (state: ZbxUnmonitored) => void;
  needle: string;
}) {
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  if (error) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {error}
      </p>
    );
  }
  if (!state) {
    return <p role="status">Wird geladen …</p>;
  }
  const matches = (device: DeviceRef) =>
    !needle ||
    [device.name, device.serial, device.inventory_no ?? "", device.kind].some((text) =>
      text.toLowerCase().includes(needle),
    );
  const missing = state.missing.filter(matches);
  const excluded = state.excluded.filter(matches);
  const run = (promise: Promise<ZbxUnmonitored>) =>
    promise.then(
      (next) => {
        setMessage(null);
        onChanged(next);
      },
      (caught: unknown) => setMessage(errorText(caught, "Das hat nicht geklappt.")),
    );
  const reasonOf = (id: number) => (reasons[id] ?? "").trim();
  return (
    <div className="detail-body">
      <p className="small">
        Geräte aus dem IT-Bestand ohne passenden Host in Zabbix, abgeglichen über die Seriennummer.
        {!state.kinds_set &&
          " Noch sind keine Hardware-Arten festgelegt. Das macht ein Admin auf der Seite Verbindung."}
      </p>
      <Feedback
        message={message ? { kind: "alert", text: message } : null}
        onClose={() => setMessage(null)}
      />
      {missing.length === 0 ? (
        <p className="empty">Kein Gerät fehlt in Zabbix.</p>
      ) : (
        <ul className="rows" aria-label="Nicht überwachte Geräte">
          {missing.map((device) => (
            <li key={device.id} className="row zbx-device-row">
              <span className="row-main">
                <Link to={hardwarePath(device.id)}>{deviceLabel(device)}</Link>
                <span className="small">
                  {device.kind} · Seriennummer{" "}
                  {device.serial ? <span className="mono">{device.serial}</span> : "fehlt"}
                </span>
              </span>
              {canLink && (
                <span className="zbx-device-actions">
                  <label className="visually-hidden" htmlFor={`zbx-grund-${device.id}`}>
                    Begründung für {deviceLabel(device)}
                  </label>
                  <input
                    id={`zbx-grund-${device.id}`}
                    type="text"
                    maxLength={200}
                    placeholder="Begründung, z. B. Ersatzgerät"
                    value={reasons[device.id] ?? ""}
                    onChange={(event) =>
                      setReasons({ ...reasons, [device.id]: event.target.value })
                    }
                  />
                  <ConfirmButton
                    className="button button-secondary"
                    disabled={!reasonOf(device.id)}
                    confirm={{
                      title: "Bewusst nicht überwachen?",
                      text: `${deviceLabel(device)} steht danach nicht mehr unter „Nicht überwacht“. Die Begründung kommt in den Verlauf des Geräts.`,
                      action: "Nicht überwachen",
                    }}
                    onConfirm={() => run(markUnmonitored(device.id, reasonOf(device.id)))}
                  >
                    Nicht überwachen
                  </ConfirmButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {excluded.length > 0 && (
        <>
          <h3 className="sub-head">Bewusst nicht überwacht</h3>
          <ul className="rows" aria-label="Bewusst nicht überwachte Geräte">
            {excluded.map((device) => (
              <li key={device.id} className="row zbx-device-row">
                <span className="row-main">
                  <Link to={hardwarePath(device.id)}>{deviceLabel(device)}</Link>
                  <span className="small">
                    {device.kind} · {device.reason}
                  </span>
                </span>
                {canLink && (
                  <ConfirmButton
                    className="button button-secondary"
                    confirm={{
                      title: "Wieder überwachen?",
                      text: `${deviceLabel(device)} steht wieder unter „Nicht überwacht“, solange es in Zabbix keinen passenden Host gibt.`,
                      action: "Wieder überwachen",
                    }}
                    onConfirm={() => run(unmarkUnmonitored(device.id))}
                  >
                    Wieder überwachen
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function HostDetail({
  hostId,
  canLink,
  onClose,
}: {
  hostId: string;
  canLink: boolean;
  onClose: () => void;
}) {
  const { data, error, setData } = useLoaded<ZbxHostDetail>(
    () => fetchZabbixHost(hostId),
    "Der Host konnte nicht geladen werden.",
    [hostId],
  );
  if (error) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p role="status">Wird geladen …</p>;
  }
  const state = hostState(data);
  return (
    <section className="panel" aria-labelledby="zbx-host-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">
            {data.site ?? "ohne Standort"} · {data.groups.join(", ") || "keine Gruppe"}
          </p>
          <h2 id="zbx-host-titel">{data.name}</h2>
          <p className="small">
            <span className={state.pill}>{state.label}</span>
            {data.maintenance && ` · Wartung „${data.maintenance}“`}
          </p>
        </div>
        <div className="project-actions">
          <ZabbixButton href={data.link} label={data.name} />
          <button
            type="button"
            className="button button-secondary case-close"
            aria-label="Ansicht schließen"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <div className="detail-body">
        <h3 className="sub-head">Offene Probleme</h3>
        {data.problems.length === 0 ? (
          <p className="empty">Keine offenen Probleme.</p>
        ) : (
          <ul className="rows">
            {data.problems.map((problem) => (
              <li key={problem.eventid} className="row">
                <span className="row-main">
                  <span className="row-title">{problem.name}</span>
                  <span className="small">
                    seit {age(problem.since)}
                    {problem.acknowledged ? " · quittiert" : ""}
                    {problem.suppressed ? " · unterdrückt" : ""}
                  </span>
                </span>
                <Severity value={problem.severity} />
              </li>
            ))}
          </ul>
        )}
        <h3 className="sub-head">Angaben aus Zabbix</h3>
        <dl className="facts">
          <div>
            <dt>Technischer Name</dt>
            <dd className="mono">{data.host}</dd>
          </div>
          <div>
            <dt>Schnittstellen</dt>
            <dd>
              {data.interfaces.length === 0
                ? "keine"
                : data.interfaces.map((item) => (
                    <span key={`${item.type}-${item.address}-${item.port}`} className="zbx-iface">
                      <span className="mono">
                        {item.type.toUpperCase()} {item.address}
                        {item.port ? `:${item.port}` : ""}
                      </span>{" "}
                      {item.available === true
                        ? "erreichbar"
                        : item.available === false
                          ? "nicht erreichbar"
                          : "unbekannt"}
                    </span>
                  ))}
            </dd>
          </div>
          <div>
            <dt>Hostgruppen</dt>
            <dd>{data.groups.join(", ") || "–"}</dd>
          </div>
          <div>
            <dt>Templates</dt>
            <dd>{data.templates.join(", ") || "–"}</dd>
          </div>
          <div>
            <dt>Zuletzt erreichbar</dt>
            <dd>{data.last_seen_at ? formatDateTime(data.last_seen_at) : "nicht beobachtet"}</dd>
          </div>
          <div>
            <dt>Seriennummer</dt>
            <dd>
              {data.serial ? <span className="mono">{data.serial}</span> : "fehlt im Inventar"}
            </dd>
          </div>
          {(data.model || data.kind) && (
            <div>
              <dt>Modell und Typ</dt>
              <dd>{[data.model, data.kind].filter(Boolean).join(" · ")}</dd>
            </div>
          )}
        </dl>
        <InventoryLink host={data} canLink={canLink} onChanged={setData} />
      </div>
    </section>
  );
}

function InventoryLink({
  host,
  canLink,
  onChanged,
}: {
  host: ZbxHostDetail;
  canLink: boolean;
  onChanged: (host: ZbxHostDetail) => void;
}) {
  const [choice, setChoice] = useState<LookupItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = (promise: Promise<ZbxHostDetail>) =>
    promise.then(
      (next) => {
        setChoice(null);
        setMessage(null);
        onChanged(next);
      },
      (caught: unknown) => setMessage(errorText(caught, "Das hat nicht geklappt.")),
    );
  const allowed = canLink && host.can_link;
  return (
    <>
      <h3 className="sub-head">Im IT-Bestand</h3>
      {host.device ? (
        <dl className="facts">
          <div>
            <dt>Gerät</dt>
            <dd>
              <Link to={hardwarePath(host.device.id)}>{deviceLabel(host.device)}</Link>
            </dd>
          </div>
          <div>
            <dt>Art</dt>
            <dd>{host.device.kind}</dd>
          </div>
          <div>
            <dt>Abgleich</dt>
            <dd>{host.match === "hand" ? "von Hand zugeordnet" : "über die Seriennummer"}</dd>
          </div>
        </dl>
      ) : (
        <p className="hint-box">
          {host.gap === "ohne_bestand"
            ? "Zu dieser Seriennummer gibt es im IT-Bestand kein aktives Gerät. Lege es im Bestand an oder trage dort die Seriennummer nach."
            : host.gap === "seriennummer_fehlt"
              ? "Im Zabbix-Inventar fehlt die Seriennummer. Trage sie in Zabbix nach oder ordne das Gerät hier von Hand zu."
              : "Mit keinem Gerät im IT-Bestand verknüpft."}
        </p>
      )}
      <Feedback
        message={message ? { kind: "alert", text: message } : null}
        onClose={() => setMessage(null)}
      />
      {allowed && host.match === "hand" && (
        <div className="actions">
          <ConfirmButton
            className="button button-secondary"
            confirm={{
              title: "Zuordnung lösen?",
              text: `${host.name} ist danach mit keinem Gerät im IT-Bestand verknüpft. Das steht im Verlauf des Geräts.`,
              action: "Lösen",
            }}
            onConfirm={() => run(unlinkHost(host.hostid))}
          >
            Zuordnung lösen
          </ConfirmButton>
        </div>
      )}
      {allowed && host.match !== "hand" && (
        <div className="form-stack zbx-link-form">
          <LookupPicker
            kind="hardware"
            label="Gerät im IT-Bestand"
            value={choice}
            onChange={setChoice}
            placeholder="Inventarnummer, Name oder Seriennummer"
          />
          <div className="actions">
            <ConfirmButton
              className="button button-primary"
              disabled={choice === null}
              confirm={{
                title: "Gerät zuordnen?",
                text: `${host.name} wird mit ${choice?.label ?? "dem Gerät"} verknüpft. Das gilt, bis Zabbix eine Seriennummer liefert.`,
                action: "Zuordnen",
              }}
              onConfirm={() => (choice ? run(linkHost(host.hostid, choice.id)) : undefined)}
            >
              Zuordnen
            </ConfirmButton>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Wartungen ----------

export function ZabbixMaintenancesPage() {
  const { data, error } = useLoaded<ZbxMaintenance[]>(
    fetchZabbixMaintenances,
    "Die Wartungen konnten nicht geladen werden.",
  );
  const groups: { key: ZbxMaintenance["state"][]; title: string }[] = [
    { key: ["laeuft"], title: "Laufend" },
    { key: ["demnaechst", "geplant"], title: "Kommend und geplant" },
    { key: ["abgelaufen"], title: "Abgelaufen (letzte 30 Tage)" },
  ];
  return (
    <div className="page page-wide">
      <ZabbixHead
        title="Wartungen"
        sub="Wartungen aus Zabbix. Während einer Wartung blendet Zabbix Probleme der Hosts aus."
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data &&
        groups.map((group) => (
          <section key={group.title} className="panel" aria-label={group.title}>
            <div className="panel-head">
              <h2>{group.title}</h2>
            </div>
            <MaintenanceList items={data.filter((item) => group.key.includes(item.state))} />
          </section>
        ))}
    </div>
  );
}

// ---------- Verbindung ----------

export function ZabbixConnectionPage() {
  const { data, error, setData } = useLoaded<ZbxConnection>(
    fetchZabbixConnection,
    "Die Verbindung konnte nicht geladen werden.",
  );
  return (
    <div className="page page-wide">
      <ZabbixHead
        label="Verwaltung"
        title="Zabbix"
        sub="Zustand der Anbindung, Abfragen des Collectors, Dienstkonto und Standorte."
        state={data?.state}
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && <ConnectionView data={data} onSaved={setData} />}
    </div>
  );
}

function ConnectionView({
  data,
  onSaved,
}: {
  data: ZbxConnection;
  onSaved: (data: ZbxConnection) => void;
}) {
  return (
    <>
      <DataStateBar state={data.state} />
      <dl className="kpis">
        <div className="kpi">
          <dt>Zustand</dt>
          <dd className="kpi-number">
            {!data.enabled ? "aus" : data.state.error ? "Fehler" : "verbunden"}
          </dd>
          <dd className="small">{data.url ?? "keine Adresse"}</dd>
        </div>
        <div className="kpi">
          <dt>Zabbix-Version</dt>
          <dd className="kpi-number">{data.version ?? "–"}</dd>
          <dd className="small">
            {data.checked_at ? `geprüft ${formatDateTime(data.checked_at)}` : "noch nicht geprüft"}
          </dd>
        </div>
        <div className="kpi">
          <dt>Token läuft ab</dt>
          <dd className="kpi-number">
            {data.token_never_expires
              ? "nie"
              : data.token_expires_at
                ? formatDateTime(data.token_expires_at)
                : "unbekannt"}
          </dd>
          <dd className="small">Hinweis 30 Tage vorher</dd>
        </div>
      </dl>
      {(data.token_warning || data.token_never_expires) && (
        <p className="hint-box hint-warn">
          {data.token_never_expires
            ? "Das Token hat kein Ablaufdatum. Bitte leg in Zabbix ein Token mit Ablaufdatum an."
            : "Das Token läuft in weniger als 30 Tagen ab. Bitte leg rechtzeitig ein neues an und trag es in der Verwaltung ein."}
        </p>
      )}
      <p className="small">
        Adresse, Token und CA-Zertifikat stehen in der Verwaltung unter{" "}
        <Link to={ADMIN_CONNECTIONS_PATH}>Verbindungen</Link>.
      </p>
      <section className="panel" aria-labelledby="zbx-abfragen">
        <div className="panel-head">
          <h2 id="zbx-abfragen">Abfragen</h2>
          <span className="small">vom Collector auf dem Server</span>
        </div>
        <div className="table-wrap card-wrap">
          <table className="table-cards">
            <thead>
              <tr>
                <th scope="col">Was</th>
                <th scope="col">API-Methoden</th>
                <th scope="col">Takt</th>
                <th scope="col">Zuletzt</th>
                <th scope="col">Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((task) => (
                <tr key={task.task}>
                  <th scope="row">{task.label}</th>
                  <td data-label="API-Methoden" className="mono">
                    {task.methods.join(", ")}
                  </td>
                  <td data-label="Takt">
                    {task.interval_minutes >= 60
                      ? "stündlich"
                      : task.interval_minutes === 1
                        ? "jede Minute"
                        : `alle ${task.interval_minutes} Min.`}
                  </td>
                  <td data-label="Zuletzt">
                    {task.last_at ? formatDateTime(task.last_at) : "–"}
                    {task.duration_ms !== null &&
                      ` · ${(task.duration_ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`}
                  </td>
                  <td data-label="Ergebnis">
                    {task.ok === null ? (
                      "–"
                    ) : task.ok ? (
                      <span className="pill pill-ok">ok</span>
                    ) : (
                      <span className="pill pill-bad" title={task.error ?? undefined}>
                        Fehler
                      </span>
                    )}
                    {task.ok === false && task.error && (
                      <span className="small zbx-error"> {task.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel" aria-labelledby="zbx-konto">
        <div className="panel-head">
          <h2 id="zbx-konto">Dienstkonto in Zabbix</h2>
        </div>
        <div className="detail-body">
          <dl className="facts">
            <div>
              <dt>Rolle</dt>
              <dd>{data.role ?? "nicht lesbar"}</dd>
            </div>
            <div>
              <dt>Erlaubte Methoden</dt>
              <dd className="mono small">{data.methods.join(", ") || "–"}</dd>
            </div>
            <div>
              <dt>Nötig</dt>
              <dd className="mono small">{data.needed.join(", ")}</dd>
            </div>
          </dl>
          {data.findings.length > 0 ? (
            <ul className="hint-box hint-warn zbx-findings" aria-label="Hinweise zum Dienstkonto">
              {data.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          ) : (
            data.role && <p className="hint-box">Die Rolle erlaubt genau das Nötige.</p>
          )}
        </div>
      </section>
      <OptionsForm data={data} onSaved={onSaved} />
    </>
  );
}

function OptionsForm({
  data,
  onSaved,
}: {
  data: ZbxConnection;
  onSaved: (data: ZbxConnection) => void;
}) {
  const [sites, setSites] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(data.groups.map((group) => [group.groupid, group.site_id])),
  );
  const [kindIds, setKindIds] = useState<number[]>(data.kind_ids);
  const [target, setTarget] = useState(String(data.target).replace(".", ","));
  const [tag, setTag] = useState(data.certificate_tag);
  const [value, setValue] = useState(data.certificate_value);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const targetNumber = Number(target.trim().replace(",", "."));
  const targetValue =
    target.trim() !== "" &&
    Number.isFinite(targetNumber) &&
    targetNumber >= 90 &&
    targetNumber <= 100
      ? targetNumber
      : null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (targetValue === null) {
      return;
    }
    // Reihenfolge: zuerst die bisherige, neue Zuordnungen hinten an
    const ordered = [...data.groups].sort(
      (a, b) => (a.position ?? 10_000) - (b.position ?? 10_000) || a.name.localeCompare(b.name),
    );
    setBusy(true);
    setMessage(null);
    saveZabbixOptions({
      mapping: ordered
        .filter((group) => sites[group.groupid])
        .map((group) => ({
          groupid: group.groupid,
          group_name: group.name,
          site_id: sites[group.groupid]!,
        })),
      certificate_tag: tag.trim(),
      certificate_value: value.trim(),
      kind_ids: kindIds,
      target: targetValue ?? data.target,
    })
      .then((saved) => {
        onSaved(saved);
        setMessage({ kind: "status", text: "Die Zuordnung ist gespeichert." });
      })
      .catch((error: unknown) =>
        setMessage({ kind: "alert", text: errorText(error, "Speichern ist fehlgeschlagen.") }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="zbx-zuordnung">
      <div className="panel-head">
        <h2 id="zbx-zuordnung">Zuordnung</h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit}>
        <p className="small">
          Der Standort eines Hosts kommt aus seiner Hostgruppe. Hosts ohne zugeordnete Gruppe
          erscheinen unter „ohne Standort“. Die Standorte pflegst du im IT-Bestand.
        </p>
        {data.groups.length === 0 ? (
          <p className="empty">Noch keine Hostgruppen aus Zabbix gelesen.</p>
        ) : (
          <div className="table-wrap card-wrap">
            <table className="table-cards">
              <thead>
                <tr>
                  <th scope="col">Hostgruppe</th>
                  <th scope="col">Hosts</th>
                  <th scope="col">Standort</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((group) => (
                  <tr key={group.groupid}>
                    <th scope="row">{group.name}</th>
                    <td data-label="Hosts">{group.hosts}</td>
                    <td data-label="Standort">
                      <select
                        className="zbx-site-select"
                        aria-label={`Standort für ${group.name}`}
                        value={sites[group.groupid] ? String(sites[group.groupid]) : ""}
                        onChange={(event) =>
                          setSites({
                            ...sites,
                            [group.groupid]: event.target.value ? Number(event.target.value) : null,
                          })
                        }
                      >
                        <option value="">kein Standort</option>
                        {data.sites.map((site) => (
                          <option key={site.id} value={String(site.id)}>
                            {site.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <fieldset className="zbx-tag">
          <legend>
            Hardware-Arten für „Nicht überwacht“ <InfoTip term="zabbix.nicht-ueberwacht" />
          </legend>
          <p className="small">
            Aktive Geräte dieser Arten aus dem IT-Bestand sollten in Zabbix einen Host haben.
          </p>
          {data.kinds.length === 0 ? (
            <p className="empty">Im IT-Bestand gibt es noch keine Hardware-Arten.</p>
          ) : (
            <div className="zbx-kinds">
              {data.kinds.map((kind) => (
                <label key={kind.id}>
                  <input
                    type="checkbox"
                    className="check"
                    checked={kindIds.includes(kind.id)}
                    onChange={(event) =>
                      setKindIds(
                        event.target.checked
                          ? [...kindIds, kind.id]
                          : kindIds.filter((entry) => entry !== kind.id),
                      )
                    }
                  />
                  {kind.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <fieldset className="zbx-tag">
          <legend>
            Zielwert der Verfügbarkeit <InfoTip term="zabbix.zielwert" />
          </legend>
          <p className="small">
            Die Berichte zeigen, ob ein Standort oder eine Gruppe diesen Wert erreicht. Zwischen 90
            und 100 %.
          </p>
          <label className="zbx-target">
            Zielwert in %
            <input
              type="text"
              inputMode="decimal"
              value={target}
              aria-invalid={targetValue === null}
              aria-describedby={targetValue === null ? "zbx-target-fehler" : undefined}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          {targetValue === null && (
            <p id="zbx-target-fehler" className="field-error">
              Bitte trag eine Zahl zwischen 90 und 100 ein, z. B. 99,5.
            </p>
          )}
        </fieldset>
        <fieldset className="zbx-tag">
          <legend>Tag für ablaufende Zertifikate</legend>
          <p className="small">
            Offene Probleme mit diesem Tag stehen auf der Übersicht unter „Zu erledigen“. Leer
            lassen, wenn es keinen gibt.
          </p>
          <div className="tool-row">
            <label>
              Tag
              <input
                type="text"
                value={tag}
                maxLength={100}
                placeholder="z. B. component"
                onChange={(event) => setTag(event.target.value)}
              />
            </label>
            <label>
              Wert (optional)
              <input
                type="text"
                value={value}
                maxLength={100}
                placeholder="z. B. certificate"
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          </div>
        </fieldset>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Zuordnung speichern
          </button>
        </div>
        <Feedback message={message} onClose={() => setMessage(null)} />
      </form>
    </section>
  );
}
