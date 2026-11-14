import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  auditQuery,
  fetchAudit,
  formatDateTime,
  type AuditEntry,
  type AuditFilter,
} from "../api";

const EMPTY_FILTER: AuditFilter = { module: "", action: "", since: "", until: "" };
const MODULES = [
  { value: "", label: "Alle" },
  { value: "kern", label: "Kern" },
  { value: "m365", label: "M365-Konfiguration" },
  { value: "evergreen", label: "Evergreen" },
];

function describeDetails(details: AuditEntry["details"]): string {
  if (!details) {
    return "";
  }
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(", ");
}

export function AuditPage() {
  const [draft, setDraft] = useState<AuditFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_FILTER);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

  const load = useCallback((current: AuditFilter, offset: number) => {
    fetchAudit(current, offset)
      .then((page) => {
        setEntries((previous) => (offset === 0 ? page.entries : [...previous, ...page.entries]));
        setHasMore(page.has_more);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof ApiError && error.status === 403 ? "forbidden" : "error");
      });
  }, []);

  useEffect(() => {
    load(filter, 0);
  }, [filter, load]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setStatus("loading");
    setFilter({ ...draft });
  };

  if (status === "forbidden") {
    return (
      <>
        <h1>Audit-Log</h1>
        <p>Keine Berechtigung. Das Audit-Log sehen nur Admins und Auditoren.</p>
      </>
    );
  }

  return (
    <>
      <p className="module-label">Allgemein</p>
      <h1>Audit-Log</h1>
      <p className="lead">Unveränderliches Protokoll aller Aktionen in der Werkbank.</p>

      <form className="filter card" onSubmit={onSubmit} aria-label="Audit-Log filtern">
        <label>
          Modul
          <select
            value={draft.module}
            onChange={(event) => setDraft({ ...draft, module: event.target.value })}
          >
            {MODULES.map((module) => (
              <option key={module.value} value={module.value}>
                {module.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Aktion enthält
          <input
            type="text"
            value={draft.action}
            maxLength={128}
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
          />
        </label>
        <label>
          Von
          <input
            type="date"
            value={draft.since}
            onChange={(event) => setDraft({ ...draft, since: event.target.value })}
          />
        </label>
        <label>
          Bis
          <input
            type="date"
            value={draft.until}
            onChange={(event) => setDraft({ ...draft, until: event.target.value })}
          />
        </label>
        <div className="filter-actions">
          <button type="submit" className="button button-primary">
            Anzeigen
          </button>
          <a
            className="button button-secondary"
            href={`/api/audit/export.csv?${auditQuery(filter)}`}
          >
            Als CSV exportieren
          </a>
        </div>
      </form>

      {status === "error" && <p role="alert">Das Audit-Log konnte nicht geladen werden.</p>}
      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="empty">Keine Einträge für diese Auswahl.</p>
      )}
      {entries.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Audit-Einträge">
          <table>
            <caption className="visually-hidden">Audit-Einträge, neueste zuerst</caption>
            <thead>
              <tr>
                <th scope="col">Zeitpunkt</th>
                <th scope="col">Person</th>
                <th scope="col">Modul</th>
                <th scope="col">Aktion</th>
                <th scope="col">Ergebnis</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="nowrap">{formatDateTime(entry.occurred_at)}</td>
                  <td>{entry.user ?? "–"}</td>
                  <td>{entry.module}</td>
                  <td className="mono">{entry.action}</td>
                  <td>{entry.result}</td>
                  <td className="details">{describeDetails(entry.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          className="button button-secondary load-more"
          onClick={() => load(filter, entries.length)}
        >
          Weitere laden
        </button>
      )}
    </>
  );
}
