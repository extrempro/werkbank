import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import {
  fetchOverview,
  fetchSettings,
  formatValue,
  settingTitle,
  type Setting,
  type SettingFilter,
} from "./api";

const EMPTY_FILTER: SettingFilter = {
  search: "",
  workload: "",
  includeRemoved: false,
  onlyDeviating: false,
};

export function SettingsPage() {
  const [draft, setDraft] = useState<SettingFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<SettingFilter>(EMPTY_FILTER);
  const [entries, setEntries] = useState<Setting[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [workloads, setWorkloads] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback((current: SettingFilter, offset: number) => {
    fetchSettings(current, offset)
      .then((page) => {
        setEntries((previous) => (offset === 0 ? page.entries : [...previous, ...page.entries]));
        setHasMore(page.has_more);
        setStatus("ready");
      })
      .catch(() => {
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load(filter, 0);
  }, [filter, load]);

  useEffect(() => {
    let active = true;
    fetchOverview()
      .then((overview) => {
        if (active) {
          setWorkloads(overview.workloads);
        }
      })
      .catch(() => {
        // Ohne Liste der Workloads bleibt nur „Alle“ wählbar.
      });
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setStatus("loading");
    setFilter({ ...draft });
  };

  return (
    <>
      <p className="module-label">M365-Konfiguration</p>
      <h1>Einstellungen</h1>
      <p className="lead">Alle gelesenen Einstellungen des Tenants mit ihrem aktuellen Wert.</p>

      <form className="filter card" onSubmit={onSubmit} aria-label="Einstellungen filtern">
        <label>
          Suche in Name und Pfad
          <input
            type="search"
            value={draft.search}
            maxLength={200}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          />
        </label>
        <label>
          Workload
          <select
            value={draft.workload}
            onChange={(event) => setDraft({ ...draft, workload: event.target.value })}
          >
            <option value="">Alle</option>
            {workloads.map((workload) => (
              <option key={workload} value={workload}>
                {workload}
              </option>
            ))}
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={draft.includeRemoved}
            onChange={(event) => setDraft({ ...draft, includeRemoved: event.target.checked })}
          />
          Entfernte anzeigen
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={draft.onlyDeviating}
            onChange={(event) => setDraft({ ...draft, onlyDeviating: event.target.checked })}
          />
          Nur Abweichungen vom Soll-Wert
        </label>
        <div className="filter-actions">
          <button type="submit" className="button button-primary">
            Anzeigen
          </button>
        </div>
      </form>

      {status === "error" && <p role="alert">Die Einstellungen konnten nicht geladen werden.</p>}
      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="empty">Keine Einstellungen für diese Auswahl.</p>
      )}
      {entries.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Einstellungen">
          <table>
            <caption className="visually-hidden">Einstellungen, sortiert nach Pfad</caption>
            <thead>
              <tr>
                <th scope="col">Einstellung</th>
                <th scope="col">Aktueller Wert</th>
                <th scope="col">Gültig seit</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <Link to={`/m365/einstellungen/${entry.id}`}>{settingTitle(entry)}</Link>
                    {!entry.active && <span className="badge">Entfernt</span>}
                    {entry.deviates && <span className="badge">Weicht vom Soll-Wert ab</span>}
                    {entry.criticality === "hoch" && (
                      <span className="badge">Kritikalität hoch</span>
                    )}
                    <span className="mono small path">{entry.path}</span>
                  </td>
                  <td className="value">{formatValue(entry.value)}</td>
                  <td className="nowrap">{formatDateTime(entry.valid_from)}</td>
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
