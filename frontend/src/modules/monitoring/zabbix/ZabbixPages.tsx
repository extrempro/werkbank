import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../../api";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { SplitHandle, useSplit } from "../../../components/SplitHandle";
import {
  ADMIN_CONNECTIONS_PATH,
  MONITORING_ZABBIX_HOSTS_PATH,
  MONITORING_ZABBIX_MAINTENANCE_PATH,
} from "../../../navigation";
import { navigate } from "../../../router";
import {
  fetchZabbixConnection,
  fetchZabbixHost,
  fetchZabbixHosts,
  fetchZabbixMaintenances,
  fetchZabbixOverview,
  MAINTENANCE_STATES,
  saveZabbixOptions,
  SEVERITIES,
  severityClass,
  severityLabel,
  type DataState,
  type ZbxConnection,
  type ZbxHostDetail,
  type ZbxHostRow,
  type ZbxMaintenance,
  type ZbxOverview,
  type ZbxProblem,
} from "./api";

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

function ZabbixHead({ title, sub, state }: { title: string; sub: string; state?: DataState }) {
  return (
    <header className="page-head zbx-head">
      <div>
        <p className="module-label">IT-Monitoring · Zabbix</p>
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

export function ZabbixOverviewPage() {
  const { data, error } = useLoaded<ZbxOverview>(
    fetchZabbixOverview,
    "Die Übersicht konnte nicht geladen werden.",
  );
  const [site, setSite] = useState("alle");
  const [minimum, setMinimum] = useState(2);
  const problems = useMemo(
    () =>
      (data?.problems ?? []).filter(
        (problem) =>
          problem.severity >= minimum && (site === "alle" || (problem.site ?? "") === site),
      ),
    [data, site, minimum],
  );

  return (
    <div className="page page-wide">
      <ZabbixHead
        title="Übersicht"
        sub="Was gerade nicht in Ordnung ist. Daten aus Zabbix, nur lesend."
        state={data?.state}
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && (
        <>
          <DataStateBar state={data.state} />
          <section className="panel" aria-labelledby="zbx-todo">
            <div className="panel-head">
              <h2 id="zbx-todo">Zu erledigen</h2>
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
          <dl className="kpis">
            <div className="kpi">
              <dt>Offene Probleme</dt>
              <dd className="kpi-number">{data.kpis.problems}</dd>
              <dd className="small">
                {SEVERITIES.filter((entry) => data.kpis.by_severity[String(entry.value)])
                  .map((entry) => `${data.kpis.by_severity[String(entry.value)]} ${entry.label}`)
                  .join(" · ") || "keine"}
              </dd>
            </div>
            <div className="kpi">
              <dt>
                Hosts nicht erreichbar <InfoTip term="zabbix.nicht-erreichbar" />
              </dt>
              <dd className="kpi-number">{data.kpis.unreachable}</dd>
              <dd className="small">von {data.kpis.hosts} überwachten</dd>
            </div>
            <div className="kpi">
              <dt>
                In Wartung <InfoTip term="zabbix.wartung" />
              </dt>
              <dd className="kpi-number">{data.kpis.maintenance}</dd>
              <dd className="small">Hosts</dd>
            </div>
          </dl>
          <section className="panel" aria-labelledby="zbx-probleme">
            <div className="panel-head">
              <h2 id="zbx-probleme">Aktuelle Probleme</h2>
            </div>
            <div className="detail-body">
              <div className="settings-form zbx-filters">
                <label>
                  Standort
                  <select value={site} onChange={(event) => setSite(event.target.value)}>
                    <option value="alle">Alle Standorte</option>
                    {data.sites.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value="">Ohne Standort</option>
                  </select>
                </label>
                <label>
                  Ab Schweregrad
                  <select
                    value={String(minimum)}
                    onChange={(event) => setMinimum(Number(event.target.value))}
                  >
                    {SEVERITIES.filter((entry) => entry.value > 0)
                      .slice()
                      .reverse()
                      .map((entry) => (
                        <option key={entry.value} value={String(entry.value)}>
                          {entry.label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <ProblemTable problems={problems} empty="Keine Probleme für diese Auswahl." />
            </div>
          </section>
          <div className="zbx-columns">
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

type HostFilter = "alle" | "probleme" | "nicht-erreichbar" | "wartung" | "nicht-ueberwacht";

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
    value: "nicht-ueberwacht",
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

export function ZabbixHostsPage({ hostId }: { hostId: string | null }) {
  const { data, error } = useLoaded<ZbxHostRow[]>(
    fetchZabbixHosts,
    "Die Hosts konnten nicht geladen werden.",
  );
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
            count: data ? data.filter(entry.test).length : null,
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
            {!data && !error && <p role="status">Wird geladen …</p>}
            {data && shown.length === 0 && <p className="empty">Kein Host passt zur Auswahl.</p>}
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
                  </tr>
                </thead>
                <tbody>
                  {shown.map((host) => (
                    <HostRowView key={host.hostid} host={host} selected={host.hostid === hostId} />
                  ))}
                </tbody>
              </table>
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
              <HostDetail key={hostId} hostId={hostId} onClose={backToList} />
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
    </tr>
  );
}

function HostDetail({ hostId, onClose }: { hostId: string; onClose: () => void }) {
  const { data, error } = useLoaded<ZbxHostDetail>(
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
        <p className="small">
          Die Verknüpfung mit dem IT-Bestand über die Seriennummer kommt in der nächsten Stufe.
        </p>
      </div>
    </section>
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
        title="Verbindung"
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
            ? "Das Token hat kein Ablaufdatum. Bitte in Zabbix ein Token mit Ablaufdatum anlegen."
            : "Das Token läuft in weniger als 30 Tagen ab. Bitte rechtzeitig ein neues anlegen und in der Verwaltung eintragen."}
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
  const [tag, setTag] = useState(data.certificate_tag);
  const [value, setValue] = useState(data.certificate_value);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
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
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {message.text}
          </p>
        )}
      </form>
    </section>
  );
}
