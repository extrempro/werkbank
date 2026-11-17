import { useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "../../api";
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
              gezeigt. Den vollständigen Stand enthält der Export.
            </p>
          )}
          {result.differences.length > 0 && (
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Unterschiede zwischen den Abrufen"
            >
              <table>
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
                      <td>{KIND_LABELS[item.kind]}</td>
                      <td>
                        {workloadLabel(item.workload)} › {areaLabel(item.area)}
                      </td>
                      <td>{item.object_name ?? "–"}</td>
                      <td className="mono">{item.property}</td>
                      <td className="mono">
                        {item.kind === "neu" ? "–" : formatValue(item.old_value)}
                      </td>
                      <td className="mono">
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

export function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetchSnapshots()
      .then((result) => {
        if (active) {
          setSnapshots(result);
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
          <h2 id="snapshot-list">Abrufe</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Abrufe">
            <table>
              <caption className="visually-hidden">Abrufe, neueste zuerst</caption>
              <thead>
                <tr>
                  <th scope="col">Beginn</th>
                  <th scope="col">Ergebnis</th>
                  <th scope="col">Objekte</th>
                  <th scope="col">Änderungen</th>
                  <th scope="col">Quellen</th>
                  <th scope="col">Export</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td className="nowrap">{formatDateTime(snapshot.started_at)}</td>
                    <td>{snapshotLabel(snapshot.status)}</td>
                    <td>{snapshot.resource_count}</td>
                    <td>{snapshot.change_count}</td>
                    <td>
                      <ul className="plain">
                        {Object.entries(snapshot.source_status).map(([source, ok]) => (
                          <li key={source}>
                            <span className="mono">{sourceLabel(source)}</span>:{" "}
                            {ok ? "vollständig" : "Fehler"}
                            {!ok && snapshot.source_errors?.[source] && (
                              <span className="small snapshot-error">
                                {snapshot.source_errors[source]}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="nowrap">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
