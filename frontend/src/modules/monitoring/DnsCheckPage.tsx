import { useEffect, useState } from "react";
import { errorText, formatDateTime } from "../../api";
import { LineChart } from "../../components/LineChart";
import { Link } from "../../components/Link";
import {
  dailyHistory,
  fetchDnsOverview,
  filterRows,
  groupByZone,
  runDnsCheckNow,
  STATUS_LABELS,
  viewCounts,
  viewFromSearch,
  type DnsOverview,
  type DnsRow,
  type DnsStatus,
  type DnsView,
} from "./api";

const numbers = new Intl.NumberFormat("de-DE");

const PILL: Record<DnsStatus, string> = {
  ok: "pill pill-ok",
  abweichend: "pill pill-bad",
  fehlt: "pill pill-bad",
  fehler: "pill pill-todo",
  inaktiv: "pill pill-neutral",
};

const VIEWS: { id: DnsView; label: string }[] = [
  { id: "probleme", label: "Probleme" },
  { id: "abweichend", label: "Abweichend" },
  { id: "fehlt", label: "Fehlt öffentlich" },
  { id: "fehler", label: "Fehler" },
  { id: "ok", label: "In Ordnung" },
  { id: "neu", label: "Neu" },
  { id: "alle", label: "Alle" },
];

/** Kacheln oben; ein Klick filtert die Einträge darunter. */
const TILES: { id: DnsView; label: string; warn: boolean }[] = [
  { id: "alle", label: "Geprüft", warn: false },
  { id: "ok", label: "In Ordnung", warn: false },
  { id: "abweichend", label: "Abweichend", warn: true },
  { id: "fehlt", label: "Fehlt öffentlich", warn: true },
  { id: "fehler", label: "Fehler bei der Abfrage", warn: false },
  { id: "neu", label: "Neu seit dem letzten Lauf", warn: true },
];

function Values({ values, marked }: { values: string[]; marked: string[] }) {
  if (values.length === 0) {
    return <span className="small">–</span>;
  }
  return (
    <ul className="dns-values">
      {values.map((value, index) => (
        <li key={`${value}-${index}`} className={marked.includes(value) ? "dns-marked" : ""}>
          <code>{value}</code>
          {marked.includes(value) && <span className="visually-hidden"> (abweichend)</span>}
        </li>
      ))}
    </ul>
  );
}

function RowView({ row }: { row: DnsRow }) {
  return (
    <tr>
      <th scope="row" className="dns-name">
        <code>{row.fqdn}</code>
        {row.new && <span className="pill pill-todo dns-new">neu</span>}
      </th>
      <td>{row.type}</td>
      <td>
        <span className={PILL[row.status]}>{STATUS_LABELS[row.status]}</span>
      </td>
      <td>
        <Values values={row.netbox.length ? row.netbox : row.inactive} marked={row.missing} />
        {row.netbox.length === 0 && row.inactive.length > 0 && (
          <span className="small">inaktiv erfasst</span>
        )}
      </td>
      <td>
        <Values values={row.public} marked={row.extra} />
      </td>
      <td>
        {row.notes.map((note) => (
          <p key={note} className="small dns-note">
            {note}
          </p>
        ))}
        {row.netbox_url && (
          <a href={row.netbox_url} target="_blank" rel="noopener noreferrer" className="small">
            In NetBox öffnen
            <span className="visually-hidden"> (neues Fenster)</span>
          </a>
        )}
      </td>
    </tr>
  );
}

/** IT-Monitoring › DNS-Abgleich mit NetBox: letzter Stand, Verlauf, Zeilen nach Zone. */
export function DnsCheckPage({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<DnsOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<DnsView>(() => viewFromSearch(window.location.search));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchDnsOverview().then(
      (result) => active && setData(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Der DNS-Abgleich konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const onRunNow = () => {
    setBusy(true);
    setMessage(null);
    runDnsCheckNow()
      .then(() =>
        setMessage({
          kind: "status",
          text: "Der Abgleich ist vorgezogen und startet in den nächsten Minuten. Lade die Seite danach neu.",
        }),
      )
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Abgleich konnte nicht vorgezogen werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const head = (
    <header className="page-head">
      <p className="module-label">IT-Monitoring</p>
      <h1>DNS-Abgleich mit NetBox</h1>
      <p className="page-sub">
        Alle {data?.interval_hours ?? 4} Stunden prüft die Werkbank, ob die DNS-Einträge aus NetBox
        öffentlich genau so im DNS stehen.
      </p>
    </header>
  );

  if (failed) {
    return (
      <div className="page">
        {head}
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page">
        {head}
        <p role="status">Wird geladen …</p>
      </div>
    );
  }

  const run = data.result_run;
  const last = data.last_run;
  const counts = viewCounts(data.rows);
  const shown = filterRows(data.rows, view, query);
  const pick = (next: DnsView) => {
    setView(next);
    document.getElementById("dns-eintraege")?.scrollIntoView?.({ block: "start" });
  };
  const days = dailyHistory(data.history);

  return (
    <div className="page">
      {head}

      {!data.enabled && (
        <p className="hint-box">
          Der Abgleich ist nicht eingerichtet oder ausgeschaltet.{" "}
          {isAdmin ? (
            <>
              Adresse und Token von NetBox trägst du unter{" "}
              <Link to="/verwaltung/verbindungen">Verwaltung › Verbindungen</Link> ein.
            </>
          ) : (
            "Die Verwaltung richtet ihn ein."
          )}
        </p>
      )}

      {last?.status === "fehlgeschlagen" && (
        <p role="alert" className="hint-box hint-bad">
          Der letzte Abgleich am {formatDateTime(last.started_at)} ist fehlgeschlagen:{" "}
          {last.error ?? "unbekannter Fehler"}
          {run ? ` Unten steht das Ergebnis vom ${formatDateTime(run.started_at)}.` : ""}
        </p>
      )}

      <div className="dns-meta">
        <p className="small" role="status">
          {run ? `Stand ${formatDateTime(run.started_at)}` : "Noch kein Ergebnis."}
          {data.next_run_at &&
            data.enabled &&
            ` · nächster Abgleich ${formatDateTime(data.next_run_at)}`}
        </p>
        {isAdmin && data.enabled && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onRunNow}
          >
            Jetzt prüfen
          </button>
        )}
      </div>
      {message && (
        <p
          role={message.kind}
          className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
        >
          {message.text}
        </p>
      )}

      {run && (
        <div className="kpis dns-kpis" role="group" aria-label="Einträge nach Status filtern">
          {TILES.map((tile) => (
            <button
              key={tile.id}
              type="button"
              className="kpi kpi-button"
              aria-pressed={view === tile.id}
              onClick={() => pick(tile.id)}
            >
              <span className="kpi-label">{tile.label}</span>{" "}
              <span
                className={tile.warn && counts[tile.id] > 0 ? "kpi-number kpi-todo" : "kpi-number"}
              >
                {numbers.format(counts[tile.id])}
              </span>
              {tile.id === "alle" && " "}
              {tile.id === "alle" && (
                <span className="small">
                  Namen und Typen in {numbers.format(run.zones)}{" "}
                  {run.zones === 1 ? "Zone" : "Zonen"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {days.length > 1 && (
        <section className="panel" aria-labelledby="dns-verlauf">
          <div className="panel-head">
            <h2 id="dns-verlauf">Verlauf der letzten 90 Tage</h2>
            <span className="small">je Tag der letzte Lauf</span>
          </div>
          <LineChart
            title="Verlauf der Abweichungen im DNS-Abgleich"
            days={days.map((entry) => entry.day)}
            series={[
              {
                id: "abweichend",
                label: "Abweichend",
                values: days.map((entry) => entry.counts.abweichend ?? 0),
              },
              {
                id: "fehlt",
                label: "Fehlt öffentlich",
                values: days.map((entry) => entry.counts.fehlt ?? 0),
              },
              {
                id: "fehler",
                label: "Fehler",
                values: days.map((entry) => entry.counts.fehler ?? 0),
              },
            ]}
          />
        </section>
      )}

      {run && (
        <section className="panel" aria-labelledby="dns-eintraege">
          <div className="panel-head">
            <h2 id="dns-eintraege">Einträge</h2>
          </div>
          <div className="detail-body">
            <div className="chips" role="group" aria-label="Einträge filtern">
              {VIEWS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="chip chip-filter"
                  aria-pressed={view === entry.id}
                  onClick={() => setView(entry.id)}
                >
                  {entry.label} ({numbers.format(counts[entry.id])})
                </button>
              ))}
            </div>
            <label className="dns-search">
              Suchen in Name, Zone, Typ und Werten
              <input
                type="search"
                value={query}
                maxLength={100}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <p className="small" role="status">
              {shown.length === 0
                ? view === "probleme" && !query
                  ? "Keine Probleme: Alle Einträge aus NetBox stehen öffentlich so im DNS."
                  : "Keine Einträge für diese Auswahl."
                : `${numbers.format(shown.length)} ${shown.length === 1 ? "Eintrag" : "Einträge"}`}
            </p>
          </div>
          {groupByZone(shown).map(([zone, rows]) => (
            <div key={zone} className="dns-zone">
              <h3 className="dns-zone-title">
                <code>{zone}</code>
                <span className="small">
                  {numbers.format(rows.length)} {rows.length === 1 ? "Eintrag" : "Einträge"}
                </span>
              </h3>
              <div className="table-wrap" tabIndex={0} role="region" aria-label={zone}>
                <table className="dns-table">
                  <caption className="visually-hidden">{zone}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Typ</th>
                      <th scope="col">Status</th>
                      <th scope="col">NetBox</th>
                      <th scope="col">Öffentlich</th>
                      <th scope="col">Hinweise</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <RowView key={row.key} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {run && (run.delegations.length > 0 || Object.keys(run.skipped_types).length > 0) && (
        <section className="panel" aria-labelledby="dns-ausgenommen">
          <div className="panel-head">
            <h2 id="dns-ausgenommen">Nicht geprüft</h2>
          </div>
          <div className="detail-body">
            {run.delegations.length > 0 && (
              <>
                <p>
                  Extern verwaltete Subdomains (in NetBox als NS-Delegation erfasst). Geprüft werden
                  nur ihre NS-Einträge:
                </p>
                <ul>
                  {run.delegations.map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {Object.keys(run.skipped_types).length > 0 && (
              <p>
                Typen, die der Abgleich nicht abfragt:{" "}
                {Object.entries(run.skipped_types)
                  .map(([type, count]) => `${type} (${count})`)
                  .join(", ")}
                .
              </p>
            )}
            <p className="small">
              Reverse-Zonen privater Adressen und nicht aktive Zonen gibt es im öffentlichen DNS
              nicht; sie sind ausgenommen.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
