import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Me } from "../../api";
import { Link } from "../../components/Link";
import { Placeholder } from "../../components/Placeholder";
import {
  fetchOverview,
  fetchSettings,
  workloadLabel,
  type Setting,
  type SettingFilter,
} from "./api";
import { SettingDetailPage } from "./SettingDetailPage";

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

interface SettingsPageProps {
  me: Me;
  /** Geöffnete Einstellung. Auf breiten Bildschirmen steht sie neben der Liste. */
  selectedId?: number;
}

export function SettingsPage({ me, selectedId }: SettingsPageProps) {
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
        if (active && Array.isArray(overview.workloads)) {
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

  const hasDetail = selectedId !== undefined;
  const count = `${entries.length}${hasMore ? "+" : ""} Treffer`;

  return (
    <div className={hasDetail ? "page page-wide has-detail" : "page page-wide"}>
      <header className="page-head list-only">
        <p className="module-label">M365-Konfiguration</p>
        {hasDetail ? <p className="page-title">Einstellungen</p> : <h1>Einstellungen</h1>}
        <p className="page-sub">
          Alle gelesenen Einstellungen des Tenants, nach Workload. Eine Einstellung wählen, um
          Wert, Beschreibung und Verlauf zu sehen.
        </p>
      </header>

      <div className="split">
        <div className="split-list split-narrow list-only">
          <section className="panel tree" aria-label="Einstellungen">
            <form className="tree-filter" onSubmit={onSubmit} aria-label="Einstellungen filtern">
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
              <div className="tree-filter-foot">
                <button type="submit" className="button button-primary">
                  Anzeigen
                </button>
                {status === "ready" && (
                  <span className="small" role="status">
                    {count}
                  </span>
                )}
              </div>
            </form>

            {status === "error" && (
              <p role="alert" className="panel-empty">
                Die Einstellungen konnten nicht geladen werden.
              </p>
            )}
            {status === "loading" && (
              <p role="status" className="panel-empty">
                Wird geladen …
              </p>
            )}
            {status === "ready" && entries.length === 0 && (
              <p className="panel-empty">Keine Einstellungen für diese Auswahl.</p>
            )}
            {groupByWorkload(entries).map((group) => (
              <div className="tree-group" key={group.workload}>
                <h2 className="tree-title" id={`workload-${group.workload}`}>
                  {workloadLabel(group.workload)}
                </h2>
                <ul aria-labelledby={`workload-${group.workload}`}>
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        to={`/m365/einstellungen/${entry.id}`}
                        className={entry.id === selectedId ? "tree-item tree-current" : "tree-item"}
                        aria-current={entry.id === selectedId ? "page" : undefined}
                      >
                        <span className="tree-text">
                          <span className="tree-name">{entry.object_name ?? entry.area}</span>
                          <span className="mono tree-prop">{entry.property}</span>
                        </span>
                        <span className="tree-badges">
                          {(entry.open_changes ?? 0) > 0 && (
                            <span className="pill pill-todo">offen</span>
                          )}
                          {entry.deviates && <span className="pill pill-bad">weicht ab</span>}
                          {entry.from_evergreen && (
                            <span className="pill pill-info" title="Durch Beschluss geregelt">
                              BR
                              <span className="visually-hidden"> – durch Beschluss geregelt</span>
                            </span>
                          )}
                          {!entry.active && <span className="pill pill-neutral">entfernt</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
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
          </section>
        </div>

        <div className="split-detail split-wide">
          {hasDetail ? (
            <SettingDetailPage key={selectedId} id={selectedId} me={me} />
          ) : (
            <Placeholder>Einstellung in der Liste wählen, um die Details zu sehen.</Placeholder>
          )}
        </div>
      </div>
    </div>
  );
}
