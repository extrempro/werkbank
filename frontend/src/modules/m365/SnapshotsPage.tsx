import { useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "../../api";
import { Feedback } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import {
  areaLabel,
  compareSnapshots,
  fetchSnapshots,
  formatValue,
  snapshotExportUrl,
  snapshotLabel,
  workloadLabel,
  type DifferenceKind,
  type Snapshot,
  type SnapshotComparison,
} from "./api";
import { summarizeSources } from "./snapshotSources";

/** So viele Abrufe zeigt die Seite zuerst und lädt sie je Klick nach. */
const PAGE = 10;

const KIND_LABELS: Record<DifferenceKind, string> = {
  neu: "Neu",
  geaendert: "Geändert",
  entfernt: "Entfernt",
};

function sourceLabel(source: string): string {
  if (source === "graph:sharepoint") {
    return "SharePoint und OneDrive (Graph)";
  }
  return source.replace(/^utcm:/, "");
}

/** Quellen eines Abrufs: Zusammenfassung, Fehler gruppiert und aufklappbar. */
function SourceCell({ snapshot }: { snapshot: Snapshot }) {
  const summary = summarizeSources(snapshot);
  const total = summary.complete.length + summary.failed;
  if (total === 0) {
    return <>–</>;
  }
  return (
    <div className="snapshot-sources">
      <p>
        {summary.complete.length} vollständig
        {summary.failed > 0 && (
          <>
            {" · "}
            <strong>{summary.failed} mit Fehler</strong>
          </>
        )}
      </p>
      <details>
        <summary>{summary.failed > 0 ? "Fehler und Quellen anzeigen" : "Quellen anzeigen"}</summary>
        {summary.groups.map((group) => (
          <div className="snapshot-error-group" key={group.sources.join(",")}>
            {group.scopes.length > 0 ? (
              <p>
                Fehlende Berechtigung beim Dienstprinzipal von UTCM (eine davon genügt):{" "}
                {group.scopes.map((scope, index) => (
                  <span key={scope}>
                    {index > 0 && " oder "}
                    <code>{scope}</code>
                  </span>
                ))}
              </p>
            ) : (
              <p className="snapshot-error">{group.message ?? "Kein Fehlertext gespeichert"}</p>
            )}
            <p className="small">
              {group.sources.length === 1
                ? "Betrifft 1 Typ:"
                : `Betrifft ${group.sources.length} Typen:`}{" "}
              <span className="mono">{group.sources.map(sourceLabel).join(", ")}</span>
            </p>
          </div>
        ))}
        {summary.complete.length > 0 && (
          <p className="small">
            Vollständig gelesen:{" "}
            <span className="mono">{summary.complete.map(sourceLabel).join(", ")}</span>
          </p>
        )}
      </details>
    </div>
  );
}

/** Nur abgeschlossene Abrufe mit eigenem Stand lassen sich vergleichen und exportieren. */
function hasState(snapshot: Snapshot): boolean {
  return snapshot.finished_at !== null && snapshot.status !== "fehler";
}

function SnapshotCompare({ snapshots }: { snapshots: Snapshot[] }) {
  const usable = snapshots.filter(hasState);
  const [from, setFrom] = useState(usable[1]?.id ?? usable[0]?.id ?? 0);
  const [to, setTo] = useState(usable[0]?.id ?? 0);
  const [result, setResult] = useState<SnapshotComparison | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  if (usable.length < 2) {
    return null;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    compareSnapshots(from, to)
      .then((comparison) => {
        setResult(comparison);
        setStatus("idle");
      })
      .catch(() => setStatus("error"));
  }

  const option = (snapshot: Snapshot) => (
    <option key={snapshot.id} value={snapshot.id}>
      {formatDateTime(snapshot.started_at)} ({snapshotLabel(snapshot.status)})
    </option>
  );

  return (
    <section aria-labelledby="snapshot-compare">
      <h2 id="snapshot-compare">Zwei Abrufe vergleichen</h2>
      <form className="filter card" onSubmit={onSubmit} aria-label="Abrufe vergleichen">
        <label>
          Vorher
          <select value={from} onChange={(event) => setFrom(Number(event.target.value))}>
            {usable.map(option)}
          </select>
        </label>
        <label>
          Nachher
          <select value={to} onChange={(event) => setTo(Number(event.target.value))}>
            {usable.map(option)}
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit" className="button button-primary" disabled={status === "loading"}>
            Vergleichen
          </button>
        </div>
      </form>

      {status === "loading" && <p role="status">Wird verglichen …</p>}
      {status === "error" && <p role="alert">Der Vergleich ist fehlgeschlagen.</p>}
      {result && status !== "loading" && (
        <>
          <p>
            {formatDateTime(result.from_at)} → {formatDateTime(result.to_at)}:{" "}
            {result.total === 0
              ? "keine Unterschiede."
              : `${result.counts.neu} neu, ${result.counts.geaendert} geändert, ${result.counts.entfernt} entfernt.`}
          </p>
          {result.truncated && (
            <p className="small">
              Es werden die ersten {result.differences.length} von {result.total} Unterschieden
              gezeigt.
            </p>
          )}
          {result.differences.length > 0 && (
            <div
              className="table-wrap card-wrap"
              tabIndex={0}
              role="region"
              aria-label="Unterschiede zwischen den Abrufen"
            >
              <table className="table-cards">
                <caption className="visually-hidden">Unterschiede zwischen den Abrufen</caption>
                <thead>
                  <tr>
                    <th scope="col">Art</th>
                    <th scope="col">Dienst › Bereich</th>
                    <th scope="col">Objekt</th>
                    <th scope="col">Eigenschaft</th>
                    <th scope="col">Vorher</th>
                    <th scope="col">Nachher</th>
                  </tr>
                </thead>
                <tbody>
                  {result.differences.map((item) => (
                    <tr key={item.path}>
                      <td data-label="Art">{KIND_LABELS[item.kind]}</td>
                      <td data-label="Dienst › Bereich">
                        {workloadLabel(item.workload)} › {areaLabel(item.area)}
                      </td>
                      <td data-label="Objekt">{item.object_name ?? "–"}</td>
                      <td className="mono" data-label="Eigenschaft">
                        {item.property}
                      </td>
                      <td className="mono" data-label="Vorher">
                        {item.kind === "neu" ? "–" : formatValue(item.old_value)}
                      </td>
                      <td className="mono" data-label="Nachher">
                        {item.kind === "entfernt" ? "–" : formatValue(item.new_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** `canExport`: nur Systemadmins laden den vollständigen Stand herunter (der Server prüft das). */
export function SnapshotsPage({ canExport = false }: { canExport?: boolean }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hasMore, setHasMore] = useState(false);
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let active = true;
    fetchSnapshots(PAGE + 1, 0)
      .then((result) => {
        if (active) {
          setSnapshots(result.slice(0, PAGE));
          setHasMore(result.length > PAGE);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const loadMore = () => {
    setMore("loading");
    fetchSnapshots(PAGE + 1, snapshots.length)
      .then((result) => {
        setSnapshots((current) => [...current, ...result.slice(0, PAGE)]);
        setHasMore(result.length > PAGE);
        setMore("idle");
      })
      .catch(() => setMore("error"));
  };

  return (
    <>
      <p className="module-label">M365-Konfiguration</p>
      <h1>Snapshots</h1>
      <p className="lead">Abrufe der Einstellungen aus dem Tenant, neueste zuerst.</p>

      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "error" && <p role="alert">Die Abrufe konnten nicht geladen werden.</p>}
      {status === "ready" && snapshots.length === 0 && (
        <p className="empty">Noch kein Abruf vorhanden.</p>
      )}
      {status === "ready" && <SnapshotCompare snapshots={snapshots} />}
      {snapshots.length > 0 && (
        <section aria-labelledby="snapshot-list">
          <h2 id="snapshot-list">Alle Abrufe</h2>
          <div className="table-wrap card-wrap" tabIndex={0} role="region" aria-label="Abrufe">
            <table className="table-cards">
              <caption className="visually-hidden">Abrufe, neueste zuerst</caption>
              <thead>
                <tr>
                  <th scope="col">Beginn</th>
                  <th scope="col">
                    Ergebnis <InfoTip term="m365.abruf-ergebnis" />
                  </th>
                  <th scope="col">Objekte</th>
                  <th scope="col">Änderungen</th>
                  <th scope="col">Quellen</th>
                  {canExport && <th scope="col">Export</th>}
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td className="nowrap" data-label="Beginn">
                      {formatDateTime(snapshot.started_at)}
                    </td>
                    <td data-label="Ergebnis">{snapshotLabel(snapshot.status)}</td>
                    <td data-label="Objekte">{snapshot.resource_count}</td>
                    <td data-label="Änderungen">{snapshot.change_count}</td>
                    <td data-label="Quellen">
                      <SourceCell snapshot={snapshot} />
                    </td>
                    {canExport && (
                      <td className="nowrap" data-label="Export">
                        {hasState(snapshot) ? (
                          <>
                            <a
                              href={snapshotExportUrl(snapshot.id, "json")}
                              aria-label={`Stand vom ${formatDateTime(snapshot.started_at)} als JSON`}
                            >
                              JSON
                            </a>
                            {" · "}
                            <a
                              href={snapshotExportUrl(snapshot.id, "csv")}
                              aria-label={`Stand vom ${formatDateTime(snapshot.started_at)} als CSV`}
                            >
                              CSV
                            </a>
                          </>
                        ) : (
                          "–"
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <p className="snapshot-more">
              <button
                type="button"
                className="button"
                onClick={loadMore}
                disabled={more === "loading"}
              >
                {more === "loading" ? "Wird geladen …" : `Weitere ${PAGE} anzeigen`}
              </button>
            </p>
          )}
          <Feedback
            message={
              more === "error"
                ? { kind: "alert", text: "Weitere Abrufe konnten nicht geladen werden." }
                : null
            }
            onClose={() => setMore("idle")}
          />
          <p className="small">
            Abrufe ohne Änderungen löscht die Werkbank nach einiger Zeit. Abrufe mit Änderungen und
            die letzten 10 bleiben erhalten.
          </p>
        </section>
      )}
    </>
  );
}
