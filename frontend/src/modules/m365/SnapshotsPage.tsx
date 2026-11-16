import { useEffect, useState } from "react";
import { formatDateTime } from "../../api";
import { fetchSnapshots, snapshotLabel, type Snapshot } from "./api";

function sourceLabel(source: string): string {
  return source.replace(/^utcm:/, "");
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
      {snapshots.length > 0 && (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
