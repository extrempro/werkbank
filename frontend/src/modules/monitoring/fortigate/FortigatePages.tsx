import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errorText, formatDateTime } from "../../../api";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import {
  ADMIN_FORTIGATE_PATH,
  MONITORING_FORTIGATE_OBJECTS_PATH,
  MONITORING_FORTIGATE_POLICIES_PATH,
  MONITORING_FORTIGATE_UNUSED_PATH,
} from "../../../navigation";
import { navigate, useSearchParam } from "../../../router";
import { useDebounced } from "../../inventory/paged";
import { age } from "../zabbix/ZabbixPages";
import {
  FG_EDITOR,
  fetchFgObjects,
  fetchFgOverview,
  fetchFgPolicies,
  objectsCsvUrl,
  policiesCsvUrl,
  refreshFortigate,
  type FgKind,
  type FgObject,
  type FgObjects,
  type FgOverview,
  type FgPolicies,
  type FgPolicy,
  type FgPolicyFilter,
  type FgSyncDevice,
  type FgSyncState,
} from "./api";

/* IT-Monitoring › FortiGate: Übersicht, Policies, Adressen & Dienste. Nur lesend. */

const REFRESH_MS = 60_000;
const LABEL = "IT-Monitoring · FortiGate";

function useLoaded<T>(load: () => Promise<T>, message: string, deps: unknown[]) {
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
  return { data, error };
}

function FgHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <header className="page-head fg-head">
      <div>
        <p className="module-label">{LABEL}</p>
        <h1>{title}</h1>
        <p className="page-sub">{sub}</p>
      </div>
      {actions && <div className="fg-head-actions">{actions}</div>}
    </header>
  );
}

function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  return (
    <>
      <button
        type="button"
        className="button button-secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          refreshFortigate()
            .then(() =>
              setMessage({
                kind: "status",
                text: "Der Abruf ist angestoßen. Die neuen Daten erscheinen in wenigen Minuten.",
              }),
            )
            .catch((error: unknown) =>
              setMessage({
                kind: "alert",
                text: errorText(error, "Der Abruf konnte nicht angestoßen werden."),
              }),
            )
            .finally(() => setBusy(false));
        }}
      >
        Jetzt abrufen
      </button>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </>
  );
}

/** Stand der Daten und Geräte mit Fehlern, immer sichtbar oben auf jeder Seite. */
function DataBar({ overview }: { overview: FgOverview | null }) {
  if (!overview) {
    return null;
  }
  if (!overview.configured) {
    return (
      <p className="hint-box">
        Es ist noch keine FortiGate eingerichtet. Ein Admin trägt die Geräte in der Verwaltung unter{" "}
        <Link to={ADMIN_FORTIGATE_PATH}>FortiGate</Link> ein.
      </p>
    );
  }
  const times = overview.devices
    .map((device) => device.data_at)
    .filter((value): value is string => Boolean(value))
    .sort();
  const failing = overview.devices.filter((device) => device.last_ok === false);
  return (
    <>
      <p className="small fg-state" role="status">
        {times.length > 0
          ? `Stand ${formatDateTime(times[0] ?? null)} · nur lesend, die Werkbank ändert nichts an den FortiGates`
          : "Noch keine Daten. Der erste Abruf läuft in den nächsten Minuten."}
      </p>
      {failing.length > 0 && (
        <ul className="hint-box hint-warn fg-failing" aria-label="Geräte mit Fehler beim Abruf">
          {failing.map((device) => (
            <li key={device.id}>
              {device.name}: {device.error}
              {device.data_at ? " Angezeigt wird der letzte Stand." : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Leiste „Objekt-Synchronisierung“: je Gerät Rolle und Zahlen. */
export function SyncBar({ devices }: { devices: FgSyncDevice[] }) {
  if (devices.length === 0) {
    return null;
  }
  return (
    <section className="panel fg-sync" aria-labelledby="fg-sync-titel">
      <div className="panel-head">
        <h2 id="fg-sync-titel">Objekt-Synchronisierung</h2>
        <InfoTip term="fortigate.fabric-sync" />
      </div>
      <ul className="fg-sync-list">
        {devices.map((entry) => (
          <li key={entry.device}>
            <strong>{entry.device}</strong> <span className="pill pill-neutral">{entry.role}</span>
            <span className="fg-sub">
              {entry.synchronisiert} synchronisiert · {entry.lokal} lokal
              {entry.abweichend > 0 && (
                <>
                  {" · "}
                  <span className="fg-differs">{entry.abweichend} abweichend</span>
                </>
              )}
              {entry.kandidaten > 0 && ` · ${entry.kandidaten} Kandidaten`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Übersicht ----------------------------------------------------------------------------

export function FortigateOverviewPage({ roles }: { roles: readonly string[] }) {
  const { data, error } = useLoaded<FgOverview>(
    fetchFgOverview,
    "Die Übersicht konnte nicht geladen werden.",
    [],
  );
  return (
    <div className="page page-wide">
      <FgHead
        title="Übersicht"
        sub="Geräte der Security Fabric mit Version, HA und letztem Abruf."
        actions={roles.includes(FG_EDITOR) && data?.configured ? <RefreshButton /> : null}
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <DataBar overview={data} />
      {data?.configured && (
        <>
          <dl className="kpis">
            <div className="kpi">
              <dt>Geräte</dt>
              <dd className="kpi-number">{data.devices.length}</dd>
              <dd className="small">
                {data.reachable === data.devices.length
                  ? "alle erreichbar"
                  : `${data.devices.length - data.reachable} nicht erreichbar`}
              </dd>
            </div>
            <div className="kpi">
              <dt>Policies</dt>
              <dd className="kpi-number">{data.policies}</dd>
              <dd className="small">{data.disabled} deaktiviert</dd>
            </div>
            <div className="kpi">
              <dt>
                Änderungen <InfoTip term="fortigate.aenderungen" />
              </dt>
              <dd className="kpi-number">{data.changes_24h}</dd>
              <dd className="small">neue Konfigurationsstände seit gestern</dd>
            </div>
          </dl>
          <SyncBar devices={data.sync} />
          <section className="panel" aria-labelledby="fg-geraete">
            <div className="panel-head">
              <h2 id="fg-geraete">Geräte</h2>
            </div>
            <div className="table-wrap card-wrap">
              <table className="table-cards">
                <thead>
                  <tr>
                    <th scope="col">Gerät</th>
                    <th scope="col">Rolle im Fabric</th>
                    <th scope="col">HA</th>
                    <th scope="col">FortiOS</th>
                    <th scope="col">Policies</th>
                    <th scope="col">Letzter Abruf</th>
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((device) => (
                    <tr key={device.id}>
                      <th scope="row">
                        {device.name}
                        {device.model && <span className="small fg-sub"> {device.model}</span>}
                      </th>
                      <td data-label="Rolle im Fabric">{device.fabric}</td>
                      <td data-label="HA">{device.ha}</td>
                      <td data-label="FortiOS">{device.version || "–"}</td>
                      <td data-label="Policies">{device.policies}</td>
                      <td data-label="Letzter Abruf">
                        {device.last_ok === null ? (
                          "noch keiner"
                        ) : device.last_ok ? (
                          <span className="pill pill-ok">ok</span>
                        ) : (
                          <span className="pill pill-bad">Fehler</span>
                        )}{" "}
                        {device.last_run_at && formatDateTime(device.last_run_at)}
                        {device.notes.length > 0 && (
                          <span className="small fg-notes"> {device.notes.join(" · ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// --- Gemeinsames für Listen ---------------------------------------------------------------

/** Namen einer Policy-Spalte; offene Angaben („all“, „ALL“, „any“) deutlich markiert. */
function Names({
  names,
  open,
  negate = false,
  extra = [],
}: {
  names: string[];
  open: boolean;
  negate?: boolean;
  extra?: string[];
}) {
  const all = [...names, ...extra];
  if (all.length === 0) {
    return <span className="fg-muted">–</span>;
  }
  return (
    <span className={open ? "fg-open" : undefined}>
      {negate && <span className="fg-negate">nicht </span>}
      {all.join(", ")}
      {open && <span className="visually-hidden"> (offen)</span>}
    </span>
  );
}

function actionClass(action: string): string {
  return action === "accept" ? "fg-accept" : "fg-deny";
}

function hits(value: number | null): string {
  return value === null ? "–" : value.toLocaleString("de-DE");
}

function lastUsed(value: string | null): string {
  return value ? `vor ${age(value)}`.replace("vor gerade eben", "gerade eben") : "nie";
}

function selectionKey(row: { device: string; id: number }): string {
  return `${row.device}:${row.id}`;
}

function replaceParams(values: Record<string, string>) {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) {
      query.set(key, value);
    } else {
      query.delete(key);
    }
  }
  const text = query.toString();
  navigate(`${window.location.pathname}${text ? `?${text}` : ""}`);
}

const QUERY_HINT: Record<string, string> = {
  ip: "Gesucht wird nach der IP: Treffer enthalten auch Netze, Bereiche und Gruppen, in denen sie liegt. „all“ zählt dabei nicht mit.",
  port: "Gesucht wird nach dem Port (auch als Policy-ID): Treffer enthalten auch Dienstgruppen. „ALL“ zählt dabei nicht mit.",
  id: "Gesucht wird nach der Policy-ID.",
};

// --- Policies -----------------------------------------------------------------------------

const ACTIONS = [
  { value: "", label: "Alle Aktionen" },
  { value: "accept", label: "accept" },
  { value: "deny", label: "deny" },
];
const STATES = [
  { value: "", label: "Aktiv und deaktiviert" },
  { value: "aktiv", label: "Nur aktive" },
  { value: "deaktiviert", label: "Nur deaktivierte" },
];

export function FortigatePoliciesPage({ roles }: { roles: readonly string[] }) {
  const overview = useLoaded<FgOverview>(
    fetchFgOverview,
    "Der Stand konnte nicht geladen werden.",
    [],
  );
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const [device, setDevice] = useState(
    () => new URLSearchParams(window.location.search).get("geraet") ?? "",
  );
  const [pair, setPair] = useState("");
  const [action, setAction] = useState("");
  const [state, setState] = useState("");
  const selected = useSearchParam("auswahl");
  const q = useDebounced(search.trim());
  const filter: FgPolicyFilter = { q, device, pair, action, state };
  const { data, error } = useLoaded<FgPolicies>(
    () => fetchFgPolicies(filter),
    "Die Policies konnten nicht geladen werden.",
    [q, device, pair, action, state],
  );
  const detailRef = useRef<HTMLElement>(null);
  const current = data?.rows.find((row) => selectionKey(row) === selected) ?? null;
  const moreActive = [device, pair, action, state].filter(Boolean).length;

  const choose = (row: FgPolicy) => {
    replaceParams({ auswahl: selectionKey(row) });
    window.setTimeout(() => {
      if (detailRef.current && window.matchMedia?.("(max-width: 1023px)").matches) {
        detailRef.current.scrollIntoView({ block: "start" });
      }
    }, 0);
  };

  return (
    <div className="page page-wide fg-page">
      <FgHead
        title="Policies"
        sub="Alle Geräte in FortiOS-Reihenfolge: Je Gerät greift die erste passende Policy."
        actions={
          <>
            <a className="button button-secondary" href={policiesCsvUrl(filter)} download>
              CSV exportieren
            </a>
            {roles.includes(FG_EDITOR) && overview.data?.configured && <RefreshButton />}
          </>
        }
      />
      <DataBar overview={overview.data} />
      <FilterBar<string>
        search={{
          label: "Suchen",
          value: search,
          placeholder: "Name, Adresse, IP, Port, Policy-ID",
          onChange: setSearch,
        }}
        moreTitle="Weitere Filter"
        moreActive={moreActive}
        onReset={
          search || moreActive
            ? () => {
                setSearch("");
                setDevice("");
                setPair("");
                setAction("");
                setState("");
              }
            : undefined
        }
        more={
          <>
            <label className="filter-field">
              Gerät
              <select value={device} onChange={(event) => setDevice(event.target.value)}>
                <option value="">Alle Geräte</option>
                {(data?.devices ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Interface-Paar
              <select value={pair} onChange={(event) => setPair(event.target.value)}>
                <option value="">Alle Paare</option>
                {(data?.pairs ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Aktion
              <select value={action} onChange={(event) => setAction(event.target.value)}>
                {ACTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Status
              <select value={state} onChange={(event) => setState(event.target.value)}>
                {STATES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {data && (
        <p className="small fg-count" role="status">
          {data.rows.length} von {data.total} Policies
          {data.query && QUERY_HINT[data.query] ? ` · ${QUERY_HINT[data.query]}` : ""}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <div className="fg-layout">
        <div className="fg-list">
          {data && data.rows.length === 0 && (
            <p className="empty">Keine Policy passt zur Auswahl.</p>
          )}
          {data && data.rows.length > 0 && (
            <div className="table-wrap card-wrap">
              <table className="table-cards fg-table" aria-label="Policies">
                <thead>
                  <tr>
                    <th scope="col">Gerät · ID</th>
                    <th scope="col">Name und Interfaces</th>
                    <th scope="col">Quelle</th>
                    <th scope="col">Ziel</th>
                    <th scope="col">Dienst</th>
                    <th scope="col">Aktion · NAT</th>
                    <th scope="col" className="number">
                      Treffer
                    </th>
                    <th scope="col">Zuletzt genutzt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    const key = selectionKey(row);
                    const isSelected = key === selected;
                    return (
                      <tr
                        key={key}
                        className={[
                          isSelected ? "is-selected" : "",
                          row.status ? "" : "fg-disabled",
                        ].join(" ")}
                      >
                        <th scope="row">
                          <button
                            type="button"
                            className="button-link fg-pick"
                            aria-pressed={isSelected}
                            onClick={() => choose(row)}
                          >
                            {row.device}
                            <span className="fg-sub">
                              #{row.id} · Position {row.position}
                            </span>
                          </button>
                        </th>
                        <td data-label="Name und Interfaces">
                          <span className="fg-name">{row.name || "ohne Namen"}</span>
                          {!row.status && <span className="pill pill-neutral">deaktiviert</span>}
                          <span className="fg-sub">
                            <Names names={row.srcintf} open={row.open.srcintf} /> →{" "}
                            <Names names={row.dstintf} open={row.open.dstintf} />
                          </span>
                          {row.match && row.match !== "Text" && (
                            <span className="fg-match">{row.match}</span>
                          )}
                        </td>
                        <td data-label="Quelle">
                          <Names
                            names={row.srcaddr}
                            open={row.open.srcaddr}
                            negate={row.srcaddr_negate}
                          />
                        </td>
                        <td data-label="Ziel">
                          <Names
                            names={row.dstaddr}
                            extra={row.internet_service}
                            open={row.open.dstaddr}
                            negate={row.dstaddr_negate}
                          />
                        </td>
                        <td data-label="Dienst">
                          <Names
                            names={row.service}
                            open={row.open.service}
                            negate={row.service_negate}
                          />
                        </td>
                        <td data-label="Aktion · NAT">
                          <span className={actionClass(row.action)}>{row.action}</span>
                          {row.nat && <span className="fg-sub">{row.nat}</span>}
                        </td>
                        <td data-label="Treffer" className="number">
                          {hits(row.hits)}
                        </td>
                        <td data-label="Zuletzt genutzt">{lastUsed(row.last_used)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside ref={detailRef} className="panel fg-detail" aria-label="Detail der Policy">
          {current ? (
            <PolicyDetail row={current} />
          ) : (
            <p className="small fg-detail-empty">
              Wähle eine Policy aus der Liste, um alle Angaben zu sehen.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

const PROFILE_LABELS: Record<string, string> = {
  av: "Virenschutz",
  web: "Web-Filter",
  ips: "IPS",
  app: "Anwendungen",
  dns: "DNS-Filter",
  ssl: "SSL-Prüfung",
  file: "Datei-Filter",
  group: "Profilgruppe",
};

const LOG_LABELS: Record<string, string> = {
  all: "alle Sitzungen",
  utm: "Sicherheitsereignisse",
  disable: "aus",
};

function PolicyDetail({ row }: { row: FgPolicy }) {
  const profiles = Object.entries(row.profiles);
  return (
    <div className="detail-body fg-detail-body">
      <p className="small fg-sub">
        {row.device} · Policy #{row.id} · Position {row.position}{" "}
        <InfoTip term="fortigate.position" />
      </p>
      <h2 className="fg-detail-title">{row.name || "ohne Namen"}</h2>
      <dl className="facts">
        <div>
          <dt>Interfaces</dt>
          <dd>
            <Names names={row.srcintf} open={row.open.srcintf} /> →{" "}
            <Names names={row.dstintf} open={row.open.dstintf} />
          </dd>
        </div>
        <div>
          <dt>Quelle</dt>
          <dd>
            <Names names={row.srcaddr} open={row.open.srcaddr} negate={row.srcaddr_negate} />
            {row.users.length > 0 && (
              <span className="fg-sub">Benutzer: {row.users.join(", ")}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Ziel</dt>
          <dd>
            <Names
              names={row.dstaddr}
              extra={row.internet_service}
              open={row.open.dstaddr}
              negate={row.dstaddr_negate}
            />
          </dd>
        </div>
        <div>
          <dt>Dienst</dt>
          <dd>
            <Names names={row.service} open={row.open.service} negate={row.service_negate} />
          </dd>
        </div>
        <div>
          <dt>Aktion · Log</dt>
          <dd>
            <span className={actionClass(row.action)}>{row.action}</span> ·{" "}
            {LOG_LABELS[row.log] ?? (row.log || "–")}
            {!row.status && " · deaktiviert"}
          </dd>
        </div>
        <div>
          <dt>NAT</dt>
          <dd>
            {row.nat || "kein NAT"}
            {row.poolname.length > 0 && ` (${row.poolname.join(", ")})`}
          </dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>
            {profiles.length === 0
              ? "keine"
              : profiles
                  .map(([key, value]) => `${PROFILE_LABELS[key] ?? key}: ${value}`)
                  .join(" · ")}
          </dd>
        </div>
        {row.schedule && row.schedule !== "always" && (
          <div>
            <dt>Zeitplan</dt>
            <dd>{row.schedule}</dd>
          </div>
        )}
        <div>
          <dt>
            Treffer <InfoTip term="fortigate.treffer" />
          </dt>
          <dd>
            {hits(row.hits)} · zuletzt {row.last_used ? formatDateTime(row.last_used) : "nie"}
            {row.first_used && (
              <span className="fg-sub">zuerst {formatDateTime(row.first_used)}</span>
            )}
          </dd>
        </div>
        {row.comments && (
          <div>
            <dt>Kommentar</dt>
            <dd className="fg-comment">{row.comments}</dd>
          </div>
        )}
      </dl>
      <p className="small fg-muted">Nur ansehen: Die Werkbank ändert nichts an den FortiGates.</p>
    </div>
  );
}

// --- Adressen & Dienste -------------------------------------------------------------------

const KIND_LABELS: Record<FgKind, string> = {
  addresses: "Adressen",
  address_groups: "Adressgruppen",
  services: "Dienste",
  service_groups: "Dienstgruppen",
  vips: "VIPs",
};
const KIND_ORDER: FgKind[] = ["addresses", "address_groups", "services", "service_groups", "vips"];

const SYNC_OPTIONS: { value: FgSyncState; label: string }[] = [
  { value: "synchronisiert", label: "synchronisiert" },
  { value: "lokal", label: "lokal" },
  { value: "lokal_mehrfach", label: "lokal, gleicher Name auf mehreren Geräten" },
  { value: "abweichend", label: "Sync abweichend" },
];

const SYNC_CLASS: Record<FgSyncState, string> = {
  synchronisiert: "fg-sync-ok",
  abweichend: "fg-differs",
  lokal: "",
  lokal_mehrfach: "",
};

function isKind(value: string): value is FgKind {
  return (KIND_ORDER as string[]).includes(value);
}

export function FortigateObjectsPage() {
  const overview = useLoaded<FgOverview>(
    fetchFgOverview,
    "Der Stand konnte nicht geladen werden.",
    [],
  );
  const kindParam = useSearchParam("art");
  const kind: FgKind = isKind(kindParam) ? kindParam : "addresses";
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const [device, setDevice] = useState("");
  const [sync, setSync] = useState("");
  const selected = useSearchParam("auswahl");
  const q = useDebounced(search.trim());
  const { data, error } = useLoaded<FgObjects>(
    () => fetchFgObjects(kind, q, device, sync),
    "Die Objekte konnten nicht geladen werden.",
    [kind, q, device, sync],
  );
  const detailRef = useRef<HTMLElement>(null);
  const current = data?.rows.find((row) => row.name === selected) ?? null;

  return (
    <div className="page page-wide fg-page">
      <FgHead
        title="Adressen & Dienste"
        sub="Objekte aller Geräte, nach Namen zusammengefasst, mit ihren Verwendungen."
        actions={
          <>
            <Link className="button button-secondary" to={MONITORING_FORTIGATE_UNUSED_PATH}>
              Nur unbenutzte anzeigen{data ? ` (${data.unused})` : ""}
            </Link>
            <a
              className="button button-secondary"
              href={objectsCsvUrl(kind, q, device, sync)}
              download
            >
              CSV exportieren
            </a>
          </>
        }
      />
      <DataBar overview={overview.data} />
      {data && kind !== "vips" && <SyncBar devices={data.sync_bar} />}
      <FilterBar<FgKind>
        search={{
          label: "Suchen",
          value: search,
          placeholder: "Name, IP, Netz, Port",
          onChange: setSearch,
        }}
        status={{
          label: "Art",
          value: kind,
          onChange: (value) => replaceParams({ art: value, auswahl: "" }),
          options: KIND_ORDER.map((value) => ({
            value,
            label: KIND_LABELS[value],
            count: data ? data.counts[value] : null,
          })),
        }}
        moreActive={[device, sync].filter(Boolean).length}
        onReset={
          search || device || sync
            ? () => {
                setSearch("");
                setDevice("");
                setSync("");
              }
            : undefined
        }
        more={
          <>
            <label className="filter-field">
              Gerät
              <select value={device} onChange={(event) => setDevice(event.target.value)}>
                <option value="">Alle Geräte</option>
                {(data?.devices ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Fabric-Sync
              <select value={sync} onChange={(event) => setSync(event.target.value)}>
                <option value="">Alle Zustände</option>
                {SYNC_OPTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {data && (
        <p className="small fg-count" role="status">
          {data.rows.length === 1 ? "1 Objekt" : `${data.rows.length} Objekte`}
          {data.query && data.query !== "id" && QUERY_HINT[data.query]
            ? ` · ${(QUERY_HINT[data.query] ?? "").replace(" (auch als Policy-ID)", "")}`
            : ""}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <div className="fg-layout">
        <div className="fg-list">
          {data && data.rows.length === 0 && (
            <p className="empty">Kein Objekt passt zur Auswahl.</p>
          )}
          {data && data.rows.length > 0 && (
            <div className="table-wrap card-wrap">
              <table className="table-cards fg-table" aria-label={KIND_LABELS[kind]}>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Wert</th>
                    <th scope="col">Geräte</th>
                    <th scope="col">Fabric-Sync</th>
                    <th scope="col" className="number">
                      Verwendet
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <ObjectRow
                      key={row.name}
                      row={row}
                      total={data.devices.length}
                      selected={row.name === selected}
                      onPick={() => {
                        replaceParams({ auswahl: row.name });
                        window.setTimeout(() => {
                          if (
                            detailRef.current &&
                            window.matchMedia?.("(max-width: 1023px)").matches
                          ) {
                            detailRef.current.scrollIntoView({ block: "start" });
                          }
                        }, 0);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside ref={detailRef} className="panel fg-detail" aria-label="Detail des Objekts">
          {current ? (
            <ObjectDetail row={current} kind={kind} />
          ) : (
            <p className="small fg-detail-empty">
              Wähle ein Objekt aus der Liste, um Werte je Gerät und die Verwendungen zu sehen.
            </p>
          )}
        </aside>
      </div>
      <p className="small fg-legend">
        Fabric-Sync <InfoTip term="fortigate.fabric-sync" /> · Verwendet{" "}
        <InfoTip term="fortigate.verwendet" />
      </p>
    </div>
  );
}

function ObjectRow({
  row,
  total,
  selected,
  onPick,
}: {
  row: FgObject;
  total: number;
  selected: boolean;
  onPick: () => void;
}) {
  const fabric = row.devices.filter((entry) => entry.fabric).length;
  return (
    <tr className={selected ? "is-selected" : undefined}>
      <th scope="row">
        <button
          type="button"
          className="button-link fg-pick"
          aria-pressed={selected}
          onClick={onPick}
        >
          {row.name}
        </button>
        {row.match && row.match !== "Text" && <span className="fg-match">{row.match}</span>}
      </th>
      <td data-label="Wert" className={row.same_value ? undefined : "fg-differs"}>
        {row.value}
      </td>
      <td data-label="Geräte">
        {row.devices.length === total && total > 1
          ? `alle ${total}`
          : row.devices.map((entry) => entry.device).join(", ")}
      </td>
      <td data-label="Fabric-Sync">
        {row.sync ? (
          <>
            <span className={SYNC_CLASS[row.sync.state]}>{row.sync.label}</span>
            {row.sync.candidate && <span className="fg-sub">Kandidat für Fabric-Sync</span>}
          </>
        ) : fabric > 0 ? (
          `Fabric-Objekt (${fabric}/${row.devices.length})`
        ) : (
          <span className="fg-muted">Standard oder VIP</span>
        )}
      </td>
      <td data-label="Verwendet" className="number">
        {row.uses}
      </td>
    </tr>
  );
}

function ObjectDetail({ row, kind }: { row: FgObject; kind: FgKind }) {
  const groups = useMemo(
    () => [...new Set(row.devices.flatMap((entry) => entry.groups))].sort(),
    [row],
  );
  const devices = row.devices.map((entry) => entry.device);
  return (
    <div className="detail-body fg-detail-body">
      <p className="small fg-sub">{KIND_LABELS[kind]}</p>
      <h2 className="fg-detail-title">{row.name}</h2>
      {row.same_value ? (
        <p className="fg-value">{row.value}</p>
      ) : (
        <>
          <h3 className="fg-detail-sub">Wert je Gerät</h3>
          <ul className="fg-plain">
            {row.devices.map((entry) => (
              <li key={entry.device}>
                <strong>{entry.device}:</strong> {entry.value}
              </li>
            ))}
          </ul>
        </>
      )}
      {row.member_table && row.member_table.length > 0 && (
        <>
          <h3 className="fg-detail-sub">Mitglieder je Gerät</h3>
          <div className="table-wrap">
            <table className="fg-members">
              <thead>
                <tr>
                  <th scope="col">Mitglied</th>
                  {devices.map((name) => (
                    <th scope="col" key={name}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {row.member_table.map((entry) => (
                  <tr key={entry.member}>
                    <th scope="row">{entry.member}</th>
                    {devices.map((name) => (
                      <td key={name} className={entry.devices[name] ? undefined : "fg-missing"}>
                        {entry.devices[name] ? "ja" : "fehlt"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3 className="fg-detail-sub">Verwendet in</h3>
      {row.used_in.length === 0 && groups.length === 0 ? (
        <p className="small">In keiner Policy und keiner Gruppe.</p>
      ) : (
        <ul className="fg-plain">
          {row.used_in.map((use) => (
            <li key={`${use.device}-${use.id}`}>
              <Link
                to={`${MONITORING_FORTIGATE_POLICIES_PATH}?geraet=${encodeURIComponent(use.device)}&q=%23${use.id}&auswahl=${encodeURIComponent(`${use.device}:${use.id}`)}`}
              >
                {use.device} · Policy #{use.id} {use.name}
              </Link>
              <span className="small fg-sub">
                {use.field}
                {use.via_group ? " (über eine Gruppe)" : ""}
              </span>
            </li>
          ))}
          {groups.map((group) => (
            <li key={`gruppe-${group}`}>
              <Link
                to={`${MONITORING_FORTIGATE_OBJECTS_PATH}?art=${kind.startsWith("service") ? "service_groups" : "address_groups"}&q=${encodeURIComponent(group)}&auswahl=${encodeURIComponent(group)}`}
              >
                Gruppe {group}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {row.devices.some((entry) => entry.comment) && (
        <>
          <h3 className="fg-detail-sub">Kommentar</h3>
          <p className="fg-comment">
            {[...new Set(row.devices.map((entry) => entry.comment).filter(Boolean))].join(" · ")}
          </p>
        </>
      )}
    </div>
  );
}
