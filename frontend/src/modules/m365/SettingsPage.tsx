import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import {
  fetchOverview,
  fetchSettings,
  formatValue,
  settingTitle,
  workloadLabel,
  type Setting,
  type SettingFilter,
} from "./api";

const EMPTY_FILTER: SettingFilter = {
  search: "",
  workload: "",
  includeRemoved: false,
  onlyDeviating: false,
};

interface WorkloadGroup {
  workload: string;
  entries: Setting[];
}

/** Gruppiert nach Workload in der Reihenfolge, in der die Einstellungen geliefert werden. */
function groupByWorkload(entries: Setting[]): WorkloadGroup[] {
  const groups: WorkloadGroup[] = [];
  for (const entry of entries) {
    const group = groups.find((item) => item.workload === entry.workload);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.push({ workload: entry.workload, entries: [entry] });
    }
  }
  return groups.sort((a, b) => workloadLabel(a.workload).localeCompare(workloadLabel(b.workload)));
}

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
    <div className="page">
      <header className="page-head">
        <p className="module-label">M365-Konfiguration</p>
        <h1>Einstellungen</h1>
        <p className="page-sub">
          Alle gelesenen Einstellungen des Tenants mit ihrem aktuellen Wert, nach Workload.
        </p>
      </header>

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
                {workloadLabel(workload)}
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
      {entries.length > 0 &&
        groupByWorkload(entries).map((group) => (
          <section
            className="panel tree-group"
            key={group.workload}
            aria-labelledby={`workload-${group.workload}`}
          >
            <div className="panel-head">
              <h2 id={`workload-${group.workload}`}>{workloadLabel(group.workload)}</h2>
              <span className="small">{group.entries.length} Einstellungen</span>
            </div>
            <ul className="rows">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <span className="row-main">
                    <Link to={`/m365/einstellungen/${entry.id}`} className="row-title">
                      {settingTitle(entry)}
                    </Link>
                    <span className="mono small path">{entry.path}</span>
                    <span className="badges">
                      {!entry.active && <span className="pill pill-neutral">Entfernt</span>}
                      {entry.deviates && (
                        <span className="pill pill-bad">Weicht vom Soll-Wert ab</span>
                      )}
                      {entry.criticality === "hoch" && (
                        <span className="pill pill-todo">Kritikalität hoch</span>
                      )}
                    </span>
                  </span>
                  <span className="row-side">
                    <span className="mono row-value">{formatValue(entry.value)}</span>
                    <span className="small">seit {formatDateTime(entry.valid_from)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {hasMore && (
        <button
          type="button"
          className="button button-secondary load-more"
          onClick={() => load(filter, entries.length)}
        >
          Weitere laden
        </button>
      )}
    </div>
  );
}
