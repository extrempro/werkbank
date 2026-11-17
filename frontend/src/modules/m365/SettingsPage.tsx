import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Me } from "../../api";
import { Link } from "../../components/Link";
import { Placeholder } from "../../components/Placeholder";
import {
  areaLabel,
  fetchOverview,
  fetchSetting,
  fetchSettings,
  fetchSettingTree,
  formatValue,
  workloadLabel,
  type Setting,
  type SettingFilter,
  type SettingTree,
  type TreeArea,
  type TreeObject,
} from "./api";
import { SettingDetailPage } from "./SettingDetailPage";

const EMPTY_FILTER: SettingFilter = {
  search: "",
  workload: "",
  includeRemoved: false,
  onlyDeviating: false,
};

/** Kurzer Wert für die Zeile; lange Werte stehen in der Detailansicht. */
const VALUE_PREVIEW = 40;

function preview(value: unknown): string {
  const text = formatValue(value);
  return text.length > VALUE_PREVIEW ? `${text.slice(0, VALUE_PREVIEW - 1)}…` : text;
}

const areaKey = (workload: string, area: string) => `${workload}\u0000${area}`;
const objectKey = (workload: string, area: string, objectId: string) =>
  `${workload}\u0000${area}\u0000${objectId}`;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Zähler hinter einem Knoten: offene Änderungen und Abweichungen. */
function CountBadges({ open, deviating }: { open: number; deviating: number }) {
  return (
    <>
      {open > 0 && <span className="pill pill-todo">{open} offen</span>}
      {deviating > 0 && <span className="pill pill-bad">{deviating} weicht ab</span>}
    </>
  );
}

interface Place {
  workload: string;
  area: string;
  objectId: string;
}

/** Schlüssel der Knoten auf dem Weg zu einem Objekt. */
function pathKeys(place: Place): string[] {
  return [
    place.workload,
    areaKey(place.workload, place.area),
    objectKey(place.workload, place.area, place.objectId),
  ];
}

interface ObjectState {
  status: "loading" | "ready" | "error";
  entries: Setting[];
  hasMore: boolean;
}

/** Ein aufklappbarer Knoten des Baums; „open“ wird von außen geführt. */
function Node({
  open,
  onToggle,
  level,
  title,
  meta,
  badges,
  children,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  level: 1 | 2 | 3;
  title: ReactNode;
  meta?: string;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details
      className={`tree-node tree-level-${level}`}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) {
          onToggle(next);
        }
      }}
    >
      <summary className="tree-summary">
        <span className="tree-text">
          <span className="tree-name">{title}</span>
          {meta && <span className="tree-prop">{meta}</span>}
        </span>
        {badges && <span className="tree-badges">{badges}</span>}
      </summary>
      {open && children}
    </details>
  );
}

interface SettingsPageProps {
  me: Me;
  /** Geöffnete Einstellung. Auf breiten Bildschirmen steht sie neben der Liste. */
  selectedId?: number;
}

export function SettingsPage({ me, selectedId }: SettingsPageProps) {
  const [draft, setDraft] = useState<SettingFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<SettingFilter>(EMPTY_FILTER);
  const [tree, setTree] = useState<SettingTree | null>(null);
  const [workloads, setWorkloads] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Aufgeklappte Knoten (Dienst, Bereich, Objekt) und die geladenen Eigenschaften je Objekt
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [objects, setObjects] = useState<ReadonlyMap<string, ObjectState>>(new Map());
  // Weg zur geöffneten Einstellung; der Baum klappt ihn auf, sobald beides geladen ist.
  const selectedPlace = useRef<Place | null>(null);
  const treeReady = useRef(false);

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

  const loadObject = useCallback(
    (workload: string, area: string, objectId: string, offset: number) => {
      const key = objectKey(workload, area, objectId);
      setObjects((previous) => {
        const next = new Map(previous);
        next.set(key, {
          status: "loading",
          entries: previous.get(key)?.entries ?? [],
          hasMore: false,
        });
        return next;
      });
      fetchSettings({ ...filter, workload }, offset, { area, objectId })
        .then((page) => {
          setObjects((previous) => {
            const next = new Map(previous);
            const before = offset === 0 ? [] : (previous.get(key)?.entries ?? []);
            next.set(key, {
              status: "ready",
              entries: [...before, ...page.entries],
              hasMore: page.has_more,
            });
            return next;
          });
        })
        .catch(() => {
          setObjects((previous) => {
            const next = new Map(previous);
            next.set(key, { status: "error", entries: [], hasMore: false });
            return next;
          });
        });
    },
    [filter],
  );

  useEffect(() => {
    let active = true;
    treeReady.current = false;
    fetchSettingTree(filter)
      .then((result) => {
        if (!active) {
          return;
        }
        setTree(result);
        setObjects(new Map());
        // Bei Suche oder Abweichungen sind Dienste und Bereiche gleich offen.
        const filtered = Boolean(filter.search || filter.onlyDeviating);
        const keys = new Set<string>();
        for (const workload of result.workloads) {
          if (filtered || result.workloads.length === 1) {
            keys.add(workload.workload);
          }
          for (const area of workload.areas) {
            if (filtered) {
              keys.add(areaKey(workload.workload, area.area));
            }
          }
        }
        // Die geöffnete Einstellung bleibt im Baum sichtbar.
        const place = selectedPlace.current;
        if (place) {
          pathKeys(place).forEach((key) => keys.add(key));
          loadObject(place.workload, place.area, place.objectId, 0);
        }
        treeReady.current = true;
        setOpened(keys);
        setStatus("ready");
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [filter, loadObject]);

  const toggle = (key: string, open: boolean) => {
    setOpened((previous) => {
      const next = new Set(previous);
      if (open) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const toggleObject = (workload: string, area: string, objectId: string, open: boolean) => {
    const key = objectKey(workload, area, objectId);
    toggle(key, open);
    if (open && !objects.has(key)) {
      loadObject(workload, area, objectId, 0);
    }
  };

  // Eine direkt geöffnete Einstellung (Link aus Änderungen, Suche) klappt ihren Weg im Baum auf.
  useEffect(() => {
    if (selectedId === undefined) {
      return;
    }
    let active = true;
    fetchSetting(selectedId)
      .then(({ setting }) => {
        if (!active) {
          return;
        }
        const place = {
          workload: setting.workload,
          area: setting.area,
          objectId: setting.object_id,
        };
        selectedPlace.current = place;
        if (treeReady.current) {
          setOpened((previous) => new Set([...previous, ...pathKeys(place)]));
          loadObject(place.workload, place.area, place.objectId, 0);
        }
      })
      .catch(() => {
        // Die Detailansicht zeigt den Fehler.
      });
    return () => {
      active = false;
    };
  }, [selectedId, loadObject]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setStatus("loading");
    setFilter({ ...draft });
  };

  const hasDetail = selectedId !== undefined;
  const objectCount =
    tree?.workloads.reduce(
      (sum, workload) =>
        sum + workload.areas.reduce((inner, area) => inner + area.objects.length, 0),
      0,
    ) ?? 0;
  const count = tree
    ? `${plural(tree.settings, "Einstellung", "Einstellungen")} in ${plural(objectCount, "Objekt", "Objekten")}`
    : "";

  const renderObject = (workload: string, area: TreeArea, entry: TreeObject) => {
    const key = objectKey(workload, area.area, entry.object_id);
    const state = objects.get(key);
    return (
      <li key={entry.object_id}>
        <Node
          level={3}
          open={opened.has(key)}
          onToggle={(open) => toggleObject(workload, area.area, entry.object_id, open)}
          title={entry.object_name ?? areaLabel(area.area)}
          meta={plural(entry.settings, "Eigenschaft", "Eigenschaften")}
          badges={
            <>
              <CountBadges open={entry.open_changes} deviating={entry.deviating} />
              {!entry.active && <span className="pill pill-neutral">entfernt</span>}
            </>
          }
        >
          {state?.status === "error" && (
            <p role="alert" className="small tree-note">
              Die Eigenschaften konnten nicht geladen werden.
            </p>
          )}
          {state?.status === "loading" && state.entries.length === 0 && (
            <p role="status" className="small tree-note">
              Wird geladen …
            </p>
          )}
          {state && state.entries.length > 0 && (
            <ul aria-label={`Eigenschaften von ${entry.object_name ?? areaLabel(area.area)}`}>
              {state.entries.map((setting) => (
                <li key={setting.id}>
                  <Link
                    to={`/m365/einstellungen/${setting.id}`}
                    className={setting.id === selectedId ? "tree-item tree-current" : "tree-item"}
                    aria-current={setting.id === selectedId ? "page" : undefined}
                  >
                    <span className="tree-text">
                      <span className="tree-name mono">{setting.property}</span>
                      <span className="tree-prop">{preview(setting.value)}</span>
                    </span>
                    <span className="tree-badges">
                      {(setting.open_changes ?? 0) > 0 && (
                        <span className="pill pill-todo">offen</span>
                      )}
                      {setting.deviates && <span className="pill pill-bad">weicht ab</span>}
                      {setting.from_evergreen && (
                        <span className="pill pill-info" title="Durch Beschluss geregelt">
                          BR
                          <span className="visually-hidden"> – durch Beschluss geregelt</span>
                        </span>
                      )}
                      {setting.ai_unreviewed && (
                        <span className="pill pill-neutral" title="KI-Text, ungeprüft">
                          KI
                          <span className="visually-hidden"> – Beschreibung ungeprüft</span>
                        </span>
                      )}
                      {!setting.active && <span className="pill pill-neutral">entfernt</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {state?.hasMore && (
            <button
              type="button"
              className="button button-secondary tree-more"
              onClick={() => loadObject(workload, area.area, entry.object_id, state.entries.length)}
            >
              Weitere Eigenschaften laden
            </button>
          )}
        </Node>
      </li>
    );
  };

  return (
    <div className={hasDetail ? "page page-wide has-detail" : "page page-wide"}>
      <header className="page-head list-only">
        <p className="module-label">M365-Konfiguration</p>
        {hasDetail ? <p className="page-title">Einstellungen</p> : <h1>Einstellungen</h1>}
        <p className="page-sub">
          Alle gelesenen Einstellungen des Tenants nach Dienst, Bereich und Objekt. Ein Objekt
          aufklappen und eine Einstellung wählen, um Wert, Beschreibung und Verlauf zu sehen.
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
                Dienst
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
            {status === "ready" && tree && tree.workloads.length === 0 && (
              <p className="panel-empty">Keine Einstellungen für diese Auswahl.</p>
            )}
            {status === "ready" && tree && tree.workloads.length > 0 && (
              <ul className="tree-root" aria-label="Dienste">
                {[...tree.workloads]
                  .sort((a, b) =>
                    workloadLabel(a.workload).localeCompare(workloadLabel(b.workload)),
                  )
                  .map((workload) => (
                    <li key={workload.workload}>
                      <Node
                        level={1}
                        open={opened.has(workload.workload)}
                        onToggle={(open) => toggle(workload.workload, open)}
                        title={workloadLabel(workload.workload)}
                        meta={plural(workload.areas.length, "Bereich", "Bereiche")}
                        badges={
                          <CountBadges
                            open={workload.open_changes}
                            deviating={workload.deviating}
                          />
                        }
                      >
                        <ul aria-label={`Bereiche von ${workloadLabel(workload.workload)}`}>
                          {[...workload.areas]
                            .sort((a, b) => areaLabel(a.area).localeCompare(areaLabel(b.area)))
                            .map((area) => {
                              const key = areaKey(workload.workload, area.area);
                              return (
                                <li key={area.area}>
                                  <Node
                                    level={2}
                                    open={opened.has(key)}
                                    onToggle={(open) => toggle(key, open)}
                                    title={areaLabel(area.area)}
                                    meta={plural(area.objects.length, "Objekt", "Objekte")}
                                    badges={
                                      <CountBadges
                                        open={area.open_changes}
                                        deviating={area.deviating}
                                      />
                                    }
                                  >
                                    <ul aria-label={`Objekte in ${areaLabel(area.area)}`}>
                                      {area.objects.map((entry) =>
                                        renderObject(workload.workload, area, entry),
                                      )}
                                    </ul>
                                  </Node>
                                </li>
                              );
                            })}
                        </ul>
                      </Node>
                    </li>
                  ))}
              </ul>
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
