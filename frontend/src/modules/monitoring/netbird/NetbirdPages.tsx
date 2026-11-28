import { useEffect, useRef, useState, type ReactNode } from "react";
import { errorText, formatDateTime } from "../../../api";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { Segmented } from "../../../components/Field";
import {
  ADMIN_NETBIRD_PATH,
  INVENTORY_HARDWARE_PATH,
  MONITORING_NETBIRD_NETWORKS_PATH,
} from "../../../navigation";
import { useSearchParam } from "../../../router";
import { useDebounced } from "../../inventory/paged";
import { replaceParams } from "../fortigate/params";
import {
  PEERS_CSV_URL,
  fetchNbOverview,
  fetchNbPeer,
  fetchNbPeers,
  refreshNetbird,
  type NbBase,
  type NbHint,
  type NbLevel,
  type NbOverview,
  type NbPeerDetail,
  type NbPeerFilter,
  type NbPeers,
  type NbStatus,
} from "./api";

/* IT-Monitoring › NetBird: Übersicht und Peers. Nur lesend. */

const REFRESH_MS = 60_000;
const LABEL = "IT-Monitoring · NetBird";
const PAGE = 50;
const HINTS_SHOWN = 6;

export const LEVEL_LABELS: Record<NbLevel, string> = {
  kritisch: "Kritisch",
  warnung: "Warnung",
  info: "Info",
};
const LEVEL_CLASS: Record<NbLevel, string> = {
  kritisch: "pill pill-bad",
  warnung: "pill pill-todo",
  info: "pill pill-info",
};
const STATUS_CLASS: Record<NbStatus, string> = {
  verbunden: "pill pill-ok",
  offline: "pill pill-neutral",
  freigabe: "pill pill-todo",
  abgelaufen: "pill pill-todo",
};
const STATUS_LABELS: Record<NbStatus, string> = {
  verbunden: "verbunden",
  offline: "offline",
  freigabe: "Freigabe offen",
  abgelaufen: "Anmeldung abgelaufen",
};

export function LevelPill({ level }: { level: NbLevel }) {
  return <span className={LEVEL_CLASS[level]}>{LEVEL_LABELS[level]}</span>;
}

function NbHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <header className="page-head fg-head">
      <div>
        <p className="module-label">{LABEL}</p>
        <h1>{title}</h1>
        <p className="page-sub">{sub}</p>
      </div>
      {actions && <div className="fg-head-actions no-print">{actions}</div>}
    </header>
  );
}

/** Stand der Daten, Fehler beim Abruf und Hinweis ohne Einrichtung. */
export function NbDataBar({ data }: { data: NbBase | null }) {
  if (!data) {
    return null;
  }
  if (!data.configured) {
    return (
      <p className="hint-box">
        NetBird ist noch nicht eingerichtet. Ein Admin trägt Adresse und API-Token in der Verwaltung
        unter <Link to={ADMIN_NETBIRD_PATH}>NetBird</Link> ein.
      </p>
    );
  }
  return (
    <>
      <p className="small fg-state" role="status">
        {data.data_at
          ? `Stand ${formatDateTime(data.data_at)} · nur lesend, die Werkbank ändert nichts an NetBird`
          : "Noch keine Daten. Der erste Abruf läuft in den nächsten Minuten."}
      </p>
      {data.last_ok === false && data.error && (
        <p className="hint-box hint-warn">Der letzte Abruf ist fehlgeschlagen: {data.error}</p>
      )}
      {data.notes.length > 0 && (
        <ul className="hint-box fg-failing" aria-label="Hinweise zum Abruf">
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </>
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
          refreshNetbird()
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

// --- Übersicht ----------------------------------------------------------------------------

const DAY_OPTIONS = [
  { value: "14", label: "14 Tage" },
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
] as const;

export function NetbirdOverviewPage() {
  const [days, setDays] = useState<"14" | "30" | "90">("14");
  const { data, error } = useLoaded<NbOverview>(
    () => fetchNbOverview(Number(days)),
    "Die Übersicht konnte nicht geladen werden.",
    [days],
  );
  return (
    <div className="page page-wide nb-page">
      <NbHead
        title="Übersicht"
        sub="Peers, Versionen und Hinweise aus NetBird."
        actions={
          <>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.print()}
            >
              Bericht drucken
            </button>
            {data?.can_refresh && data.configured && <RefreshButton />}
          </>
        }
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <NbDataBar data={data} />
      {data?.configured && data.data_at && (
        <>
          <dl className="kpis">
            <div className="kpi">
              <dt>
                Peers verbunden <InfoTip term="netbird.verbunden" />
              </dt>
              <dd className="kpi-number">
                {data.connected} / {data.peers}
              </dd>
              <dd className="small">
                {data.routers_offline > 0
                  ? `davon ${data.routers_offline} Routing-Peer${data.routers_offline === 1 ? "" : "s"} offline`
                  : data.routers > 0
                    ? "alle Routing-Peers verbunden"
                    : "keine Routing-Peers"}
              </dd>
            </div>
            <div className="kpi">
              <dt>
                Netze erreichbar <InfoTip term="netbird.erreichbar" />
              </dt>
              <dd className="kpi-number">
                {data.networks_ok} / {data.networks_total}
              </dd>
              <dd className="small">
                <Link to={MONITORING_NETBIRD_NETWORKS_PATH}>
                  {data.networks_single > 0
                    ? `${data.networks_single} ohne Ausfallweg`
                    : "zu den Netzen"}
                </Link>
              </dd>
            </div>
            <div className="kpi">
              <dt>Dienste am Reverse Proxy</dt>
              <dd className="kpi-number">
                {data.services_ok} / {data.services_checked}
              </dd>
              <dd className="small">
                erreichbar
                {data.services_total > data.services_checked
                  ? ` · ${data.services_total - data.services_checked} nicht geprüft`
                  : ""}
              </dd>
            </div>
            <div className="kpi">
              <dt>
                Offene Hinweise <InfoTip term="netbird.hinweis" />
              </dt>
              <dd className="kpi-number">
                {data.hint_counts.kritisch} · {data.hint_counts.warnung} · {data.hint_counts.info}
              </dd>
              <dd className="small">kritisch · Warnung · Info</dd>
            </div>
          </dl>
          <HintList hints={data.hints} />
          <div className="nb-columns">
            <section className="panel" aria-labelledby="nb-versionen">
              <div className="panel-head">
                <h2 id="nb-versionen">
                  Client-Versionen <InfoTip term="netbird.version" />
                </h2>
              </div>
              <div className="detail-body">
                <p className="small">
                  {data.latest_version
                    ? `Neuestes Release laut NetBird: ${data.latest_version}`
                    : "Das neueste Release meldet NetBird nicht; der Vergleich entfällt."}
                </p>
                <dl className="nb-versions">
                  <div>
                    <dt>neuestes</dt>
                    <dd>{data.versions.neuestes}</dd>
                  </div>
                  <div>
                    <dt>eins zurück</dt>
                    <dd>{data.versions.eins}</dd>
                  </div>
                  <div className={data.versions.zwei > 0 ? "nb-warn" : undefined}>
                    <dt>zwei und älter</dt>
                    <dd>{data.versions.zwei}</dd>
                  </div>
                  {data.versions.unbekannt > 0 && (
                    <div>
                      <dt>unbekannt</dt>
                      <dd>{data.versions.unbekannt}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </section>
            <section className="panel" aria-labelledby="nb-systeme">
              <div className="panel-head">
                <h2 id="nb-systeme">Betriebssysteme</h2>
              </div>
              <div className="table-wrap">
                <table className="nb-mini-table" aria-label="Betriebssysteme">
                  <thead>
                    <tr>
                      <th scope="col">System</th>
                      <th scope="col" className="number">
                        gesamt
                      </th>
                      <th scope="col" className="number">
                        online
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.systems.map((row) => (
                      <tr key={row.name}>
                        <th scope="row">{row.name}</th>
                        <td className="number">{row.total}</td>
                        <td className="number">{row.online}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <PeersChart
            data={data}
            days={days}
            onDays={(value) => setDays(value as "14" | "30" | "90")}
          />
        </>
      )}
    </div>
  );
}

function HintList({ hints }: { hints: NbHint[] }) {
  const [level, setLevel] = useState("");
  const [all, setAll] = useState(false);
  const shown = hints.filter((hint) => !level || hint.level === level);
  const visible = all ? shown : shown.slice(0, HINTS_SHOWN);
  return (
    <section className="panel" aria-labelledby="nb-hinweise">
      <div className="panel-head nb-panel-head">
        <h2 id="nb-hinweise">Hinweise</h2>
        <label className="filter-field no-print">
          Stufe
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">Alle ({hints.length})</option>
            {(["kritisch", "warnung", "info"] as NbLevel[]).map((key) => (
              <option key={key} value={key}>
                {LEVEL_LABELS[key]} ({hints.filter((hint) => hint.level === key).length})
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="empty">Keine offenen Hinweise.</p>
      ) : (
        <ul className="nb-hints">
          {visible.map((hint) => (
            <li key={hint.key}>
              <LevelPill level={hint.level} />
              <div>
                <strong>{hint.title}</strong>
                <p className="small">
                  {hint.text} <Link to={hint.link}>Ansehen</Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown.length > HINTS_SHOWN && (
        <p className="detail-body no-print">
          <button type="button" className="button button-secondary" onClick={() => setAll(!all)}>
            {all ? "Weniger anzeigen" : `${shown.length - HINTS_SHOWN} weitere anzeigen`}
          </button>
        </p>
      )}
    </section>
  );
}

function PeersChart({
  data,
  days,
  onDays,
}: {
  data: NbOverview;
  days: string;
  onDays: (value: string) => void;
}) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.chart.map((row) => row.total ?? row.max_connected ?? 0));
  const known = data.chart.filter((row) => row.max_connected !== null);
  const label =
    known.length === 0
      ? "Noch keine Tageswerte."
      : `Höchstwert verbundener Peers je Tag: zwischen ${Math.min(...known.map((row) => row.max_connected ?? 0))} und ${Math.max(...known.map((row) => row.max_connected ?? 0))}.`;
  return (
    <section className="panel" aria-labelledby="nb-verlauf">
      <div className="panel-head nb-panel-head">
        <h2 id="nb-verlauf">
          Verbundene Peers <InfoTip term="netbird.verlauf" />
        </h2>
        <div className="no-print">
          <Segmented
            label="Zeitraum"
            value={days}
            options={DAY_OPTIONS}
            onChange={(value) => onDays(value)}
          />
        </div>
      </div>
      <div className="detail-body">
        <div className="nb-chart" role="img" aria-label={label}>
          {data.chart.map((row) => (
            <span
              key={row.day}
              className={row.weekend ? "nb-bar nb-bar-weekend" : "nb-bar"}
              style={{ height: `${((row.max_connected ?? 0) / max) * 100}%` }}
              title={`${formatDay(row.day)}: ${row.max_connected ?? "–"}`}
            />
          ))}
        </div>
        <p className="small">
          {formatDay(data.chart[0]?.day ?? "")} bis {formatDay(data.chart.at(-1)?.day ?? "")} ·
          graue Balken: Wochenende ·{" "}
          <button type="button" className="button-link" onClick={() => setTable(!table)}>
            {table ? "Tabelle ausblenden" : "als Tabelle zeigen"}
          </button>
        </p>
        {table && (
          <div className="table-wrap">
            <table className="nb-mini-table" aria-label="Verbundene Peers je Tag">
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col" className="number">
                    höchstens verbunden
                  </th>
                  <th scope="col" className="number">
                    Peers gesamt
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.chart.map((row) => (
                  <tr key={row.day}>
                    <th scope="row">{formatDay(row.day)}</th>
                    <td className="number">{row.max_connected ?? "–"}</td>
                    <td className="number">{row.total ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDay(value: string): string {
  if (!value) {
    return "";
  }
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year?.slice(2)}`;
}

// --- Peers --------------------------------------------------------------------------------

function initial(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

export function NetbirdPeersPage() {
  const [search, setSearch] = useState(() => initial("q"));
  const [filter, setFilter] = useState<Omit<NbPeerFilter, "q">>(() => ({
    state: initial("status"),
    group: initial("gruppe"),
    os: initial("system"),
    hinted: initial("hinweis") === "1",
  }));
  const [limit, setLimit] = useState(PAGE);
  const q = useDebounced(search.trim());
  const { data, error } = useLoaded<NbPeers>(
    () => fetchNbPeers({ ...filter, q }),
    "Die Peers konnten nicht geladen werden.",
    [q, filter.state, filter.group, filter.os, filter.hinted],
  );
  const selected = useSearchParam("auswahl");
  const detailRef = useRef<HTMLElement>(null);
  const change = (next: Partial<Omit<NbPeerFilter, "q">>) => {
    setFilter((current) => ({ ...current, ...next }));
    setLimit(PAGE);
  };
  const moreActive = [filter.group, filter.os, filter.hinted ? "1" : ""].filter(Boolean).length;
  const rows = data?.rows ?? [];
  const statuses = (["verbunden", "offline", "abgelaufen", "freigabe"] as NbStatus[]).filter(
    (key) => key !== "freigabe" || data?.approval_known,
  );

  const choose = (id: string) => {
    replaceParams({ auswahl: id });
    window.setTimeout(() => {
      if (detailRef.current && window.matchMedia?.("(max-width: 1023px)").matches) {
        detailRef.current.scrollIntoView({ block: "start" });
      }
    }, 0);
  };

  return (
    <div className="page page-wide fg-page">
      <NbHead
        title="Peers"
        sub="Geräte im NetBird-Netz mit Person, Status und Version."
        actions={
          data?.can_export ? (
            <a className="button button-secondary" href={PEERS_CSV_URL} download>
              CSV exportieren
            </a>
          ) : undefined
        }
      />
      <NbDataBar data={data} />
      <FilterBar<string>
        search={{
          label: "Suchen",
          value: search,
          placeholder: "Name, Person, NetBird-IP",
          onChange: (value) => {
            setSearch(value);
            setLimit(PAGE);
          },
        }}
        status={{
          label: "Status",
          value: filter.state,
          onChange: (value) => change({ state: value }),
          options: [
            { value: "", label: "Alle", count: data ? data.total : null },
            ...statuses.map((key) => ({
              value: key,
              label: STATUS_LABELS[key],
              count: data ? data.counts[key] : null,
            })),
          ],
        }}
        statusSelect
        moreActive={moreActive}
        onReset={
          search || filter.state || moreActive
            ? () => {
                setSearch("");
                change({ state: "", group: "", os: "", hinted: false });
              }
            : undefined
        }
        more={
          <>
            <label className="filter-field">
              Gruppe
              <select
                value={filter.group}
                onChange={(event) => change({ group: event.target.value })}
              >
                <option value="">Alle Gruppen</option>
                {(data?.groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Betriebssystem
              <select value={filter.os} onChange={(event) => change({ os: event.target.value })}>
                <option value="">Alle</option>
                {(data?.families ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={filter.hinted}
                onChange={(event) => change({ hinted: event.target.checked })}
              />
              nur mit Hinweis
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
          {rows.length} von {data.total} Peers
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <div className="fg-layout">
        <div className="fg-list">
          {data && rows.length === 0 && <p className="empty">Kein Peer passt zur Auswahl.</p>}
          {rows.length > 0 && (
            <div className="table-wrap card-wrap">
              <table className="table-cards fg-table" aria-label="Peers">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Person</th>
                    <th scope="col">Status</th>
                    <th scope="col">NetBird-IP</th>
                    <th scope="col">System · Version</th>
                    <th scope="col">Hinweis</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((row) => {
                    const isSelected = row.id === selected;
                    return (
                      <tr key={row.id} className={isSelected ? "is-selected" : undefined}>
                        <th scope="row">
                          <button
                            type="button"
                            className="button-link fg-pick"
                            aria-pressed={isSelected}
                            onClick={() => choose(row.id)}
                          >
                            {row.name}
                          </button>
                          {row.router && <span className="fg-sub">Routing-Peer</span>}
                        </th>
                        <td data-label="Person">{row.person || "–"}</td>
                        <td data-label="Status">
                          <span className={STATUS_CLASS[row.status]}>{row.status_label}</span>
                          <span className="fg-sub">
                            {row.status === "verbunden"
                              ? "jetzt"
                              : row.last_seen
                                ? `zuletzt ${formatDateTime(row.last_seen)}`
                                : "nie gesehen"}
                          </span>
                        </td>
                        <td data-label="NetBird-IP">{row.ip}</td>
                        <td data-label="System · Version">
                          {row.os || "–"}
                          <span
                            className={
                              row.behind !== null && row.behind >= 2 ? "fg-sub nb-warn" : "fg-sub"
                            }
                          >
                            {row.version || "–"}
                          </span>
                        </td>
                        <td data-label="Hinweis">
                          {row.hints.length === 0
                            ? "–"
                            : row.hints.map((hint) => (
                                <span key={hint.key} className="fg-sub">
                                  <LevelPill level={hint.level} /> {hint.title}
                                </span>
                              ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > limit && (
                <p className="detail-body">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setLimit(limit + PAGE)}
                  >
                    Mehr anzeigen ({rows.length - limit} weitere)
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
        <aside ref={detailRef} className="panel fg-detail" aria-label="Detail des Peers">
          {selected ? (
            <PeerDetail key={selected} id={selected} dashboard={data?.dashboard_url ?? ""} />
          ) : (
            <p className="small fg-detail-empty">
              Wähle einen Peer aus der Liste, um alle Angaben zu sehen.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function PeerDetail({ id, dashboard }: { id: string; dashboard: string }) {
  const [data, setData] = useState<NbPeerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchNbPeer(id).then(
      (value) => active && setData(value),
      (caught: unknown) =>
        active && setError(errorText(caught, "Der Peer konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [id]);
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
  const on = data.history.filter((day) => day.connected).length;
  return (
    <div className="detail-body fg-detail-body">
      <p className="small fg-sub">
        {data.person || "ohne Person"} ·{" "}
        <span className={STATUS_CLASS[data.status]}>{data.status_label}</span>
      </p>
      <h2 className="fg-detail-title">{data.name}</h2>
      <dl className="facts">
        <div>
          <dt>NetBird-IP</dt>
          <dd>{data.ip}</dd>
        </div>
        <div>
          <dt>DNS-Name</dt>
          <dd>{data.dns_label || "–"}</dd>
        </div>
        <div>
          <dt>System · Version</dt>
          <dd>
            {data.os || "–"} · {data.version || "–"}
            {data.behind !== null && data.behind > 0 && data.latest_version && (
              <span className="fg-sub">
                {data.behind === 1 ? "1 Release" : `${data.behind} Releases`} zurück (neuestes{" "}
                {data.latest_version})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Zuletzt gesehen</dt>
          <dd>
            {data.status === "verbunden"
              ? "jetzt verbunden"
              : data.last_seen
                ? formatDateTime(data.last_seen)
                : "nie"}
          </dd>
        </div>
        <div>
          <dt>
            Anmeldung bis <InfoTip term="netbird.anmeldung" />
          </dt>
          <dd>
            {data.login_expired
              ? "abgelaufen"
              : data.login_expires
                ? formatDateTime(data.login_expires)
                : "läuft nicht ab"}
          </dd>
        </div>
        {data.country && (
          <div>
            <dt>Land der Verbindung</dt>
            <dd>{data.country}</dd>
          </div>
        )}
        <div>
          <dt>Routing-Peer</dt>
          <dd>{data.router ? "ja" : "nein"}</dd>
        </div>
        <div>
          <dt>Gruppen</dt>
          <dd>{data.group_names.join(", ") || "–"}</dd>
        </div>
        {data.asset && (
          <div>
            <dt>
              IT-Bestand <InfoTip term="netbird.bestand" />
            </dt>
            <dd>
              <Link to={`${INVENTORY_HARDWARE_PATH}/${data.asset.id}`}>
                {data.asset.name}
                {data.asset.inventory_no ? ` (${data.asset.inventory_no})` : ""}
              </Link>
              <span className="fg-sub">Hinweis über den Hostnamen, keine feste Zuordnung</span>
            </dd>
          </div>
        )}
      </dl>
      <section aria-labelledby="nb-verbindungen">
        <h3 id="nb-verbindungen" className="nb-detail-title">
          Verbindungen der letzten 7 Tage
        </h3>
        <div className="nb-week" role="img" aria-label={`An ${on} von 7 Tagen verbunden`}>
          {data.history.map((day) => (
            <span
              key={day.day}
              className={
                day.connected ? "nb-day nb-day-on" : day.known ? "nb-day" : "nb-day nb-day-unknown"
              }
            >
              {WEEKDAYS[new Date(`${day.day}T12:00:00`).getDay()]}
            </span>
          ))}
        </div>
        <p className="small">
          dunkel: mindestens einmal verbunden · gestrichelt: noch nicht erfasst
        </p>
      </section>
      {data.hints.length > 0 && (
        <ul className="nb-hints nb-hints-compact" aria-label="Hinweise zu diesem Peer">
          {data.hints.map((hint) => (
            <li key={hint.key}>
              <LevelPill level={hint.level} />
              <div>
                <strong>{hint.title}</strong>
                <p className="small">{hint.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {dashboard && (
        <a
          className="button button-secondary"
          href={`${dashboard}/peer?id=${encodeURIComponent(data.id)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          In NetBird öffnen
        </a>
      )}
    </div>
  );
}
