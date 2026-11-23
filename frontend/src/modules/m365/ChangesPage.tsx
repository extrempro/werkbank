import { useEffect, useRef, useState } from "react";
import { FilterBar } from "../../components/FilterBar";
import { ApiError, formatDateTime, type Me } from "../../api";
import { Placeholder } from "../../components/Placeholder";
import { navigate } from "../../router";
import { createEntryFromChange, entryPath } from "../evergreen/api";
import {
  areaLabel,
  fetchChanges,
  kindLabel,
  reviewChanges,
  settingTitle,
  statusClass,
  statusLabel,
  workloadLabel,
  type Change,
  type ChangeCounts,
  type ChangeGroup,
  type ReviewStatus,
} from "./api";
import { ChangeDetail } from "./ChangeDetail";
import { Feedback } from "../../components/Feedback";

interface ChangesPageProps {
  me: Me;
}

const FILTERS: { value: "" | ReviewStatus; label: string; key: keyof ChangeCounts }[] = [
  { value: "offen", label: "Offen", key: "offen" },
  { value: "ungewollt", label: "Ungewollt", key: "ungewollt" },
  { value: "gewollt", label: "Gewollt", key: "gewollt" },
  { value: "", label: "Alle", key: "alle" },
];

type Message = { kind: "status" | "alert"; text: string };

interface Place {
  workload: string;
  area: string;
}

const ALL: Place = { workload: "", area: "" };

/** Wert in der Auswahl „Dienst und Bereich“: „entra“ oder „entra|conditionalAccessPolicy“. */
function placeValue(place: Place): string {
  return place.area ? `${place.workload}|${place.area}` : place.workload;
}

function parsePlace(value: string): Place {
  const [workload = "", area = ""] = value.split("|");
  return { workload, area };
}

function placeTitle(workload: string, area: string): string {
  return `${workloadLabel(workload)} › ${areaLabel(area)}`;
}

function plural(count: number): string {
  return `${count} ${count === 1 ? "Änderung" : "Änderungen"}`;
}

interface Section {
  key: string;
  workload: string;
  area: string;
  entries: Change[];
}

/** Geladene Änderungen nach Dienst und Bereich; der Bereich mit der neuesten Änderung zuerst. */
function sections(entries: Change[]): Section[] {
  const result: Section[] = [];
  for (const entry of entries) {
    const key = `${entry.workload}|${entry.area}`;
    const section = result.find((item) => item.key === key);
    if (section) {
      section.entries.push(entry);
    } else {
      result.push({ key, workload: entry.workload, area: entry.area, entries: [entry] });
    }
  }
  return result;
}

/** Dienste mit ihren Bereichen für die Auswahl, alphabetisch nach Anzeigenamen. */
function placeOptions(groups: ChangeGroup[]): { workload: string; areas: ChangeGroup[] }[] {
  const workloads = [...new Set(groups.map((group) => group.workload))].sort((a, b) =>
    workloadLabel(a).localeCompare(workloadLabel(b)),
  );
  return workloads.map((workload) => ({
    workload,
    areas: groups
      .filter((group) => group.workload === workload)
      .sort((a, b) => areaLabel(a.area).localeCompare(areaLabel(b.area))),
  }));
}

export function ChangesPage({ me }: ChangesPageProps) {
  const [filter, setFilter] = useState<string>("offen");
  const [place, setPlace] = useState<Place>(ALL);
  const [groups, setGroups] = useState<ChangeGroup[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<Change[]>([]);
  const [counts, setCounts] = useState<ChangeCounts | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [current, setCurrent] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkComment, setBulkComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const canReview = me.roles.includes("Config.Reviewer");
  const canCreateItem = me.roles.includes("Evergreen.Editor");

  useEffect(() => {
    let active = true;
    fetchChanges(filter, 0, 50, place)
      .then((page) => {
        if (active) {
          setEntries(page.entries);
          setHasMore(page.has_more);
          setCounts(page.counts ?? null);
          setGroups(page.groups ?? []);
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
  }, [filter, place, reloadKey]);

  const loadMore = () => {
    fetchChanges(filter, entries.length, 50, place)
      .then((page) => {
        setEntries((previous) => [...previous, ...page.entries]);
        setHasMore(page.has_more);
      })
      .catch(() => {
        setStatus("error");
      });
  };

  const pickFilter = (value: string) => {
    if (value === filter) {
      return;
    }
    setStatus("loading");
    setSelected([]);
    setCurrent(null);
    setMessage(null);
    setFilter(value);
  };

  const pickPlace = (value: string) => {
    setStatus("loading");
    setSelected([]);
    setCurrent(null);
    setMessage(null);
    setPlace(parsePlace(value));
  };

  /** Wählt alle geladenen Änderungen eines Bereichs aus oder hebt die Auswahl auf. */
  const toggleSection = (section: Section) => {
    const ids = section.entries.map((entry) => entry.id);
    const all = ids.every((id) => selected.includes(id));
    setSelected((list) =>
      all ? list.filter((id) => !ids.includes(id)) : [...new Set([...list, ...ids])],
    );
  };

  const open = (id: number) => {
    setCurrent(id);
    setMessage(null);
    // Auf schmalen Bildschirmen steht der Detailbereich unter der Liste.
    window.requestAnimationFrame(() => {
      const target = detailRef.current;
      if (target && typeof target.scrollIntoView === "function" && window.innerWidth < 1100) {
        target.scrollIntoView({ block: "start" });
      }
    });
  };

  const onCreateItem = (entry: Change) => {
    setMessage(null);
    createEntryFromChange(entry.id)
      .then((created) => {
        navigate(entryPath(created.software, created.id));
      })
      .catch((error: unknown) => {
        const detail = error instanceof ApiError ? error.detail : null;
        setMessage({
          kind: "alert",
          text: detail ?? "Der Evergreen-Eintrag konnte nicht angelegt werden.",
        });
      });
  };

  const send = (ids: number[], target: ReviewStatus, comment: string, after: () => void) => {
    setBusy(true);
    setMessage(null);
    reviewChanges(ids, target, comment)
      .then((result) => {
        const text =
          target === "offen"
            ? `${result.updated} Bewertung(en) zurückgesetzt.`
            : `${result.updated} Änderung(en) als ${statusLabel(target).toLowerCase()} bewertet.`;
        setMessage({ kind: "status", text });
        after();
        setReloadKey((key) => key + 1);
      })
      .catch((error: unknown) => {
        const detail = error instanceof ApiError ? error.detail : null;
        setMessage({
          kind: "alert",
          text: detail ?? "Die Bewertung konnte nicht gespeichert werden.",
        });
      })
      .finally(() => setBusy(false));
  };

  const reviewSelection = (target: ReviewStatus) => {
    if (selected.length === 0) {
      setMessage({ kind: "alert", text: "Bitte wähle zuerst mindestens eine Änderung aus." });
      return;
    }
    if (target === "ungewollt" && bulkComment.trim() === "") {
      setMessage({ kind: "alert", text: "Für „ungewollt“ ist ein Kommentar nötig." });
      return;
    }
    send(selected, target, bulkComment.trim(), () => {
      setSelected([]);
      setBulkComment("");
    });
  };

  const toggle = (id: number) => {
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  };

  const shown = entries.find((entry) => entry.id === current) ?? null;

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">M365-Konfiguration</p>
        <h1>Änderungen</h1>
        <p className="page-sub">
          Erkannte Änderungen an Einstellungen des Tenants. Jede Änderung wird als gewollt oder
          ungewollt bewertet.
        </p>
      </header>

      <FilterBar
        status={{
          label: "Änderungen filtern",
          value: filter,
          onChange: pickFilter,
          options: FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
            count: counts ? counts[option.key] : null,
          })),
        }}
        moreTitle="Dienst und Bereich"
        moreActive={place.workload ? 1 : 0}
        more={
          groups.length > 0 || place.workload ? (
            <label className="filter-field changes-place">
              Dienst und Bereich
              <select value={placeValue(place)} onChange={(event) => pickPlace(event.target.value)}>
                <option value="">Alle</option>
                {placeOptions(groups).map((option) => (
                  <optgroup key={option.workload} label={workloadLabel(option.workload)}>
                    <option value={option.workload}>
                      {workloadLabel(option.workload)}: alle Bereiche (
                      {option.areas.reduce((sum, group) => sum + group.count, 0)})
                    </option>
                    {option.areas.map((group) => (
                      <option key={group.area} value={`${group.workload}|${group.area}`}>
                        {areaLabel(group.area)} ({group.count})
                      </option>
                    ))}
                  </optgroup>
                ))}
                {/* Gewählt, aber im aktuellen Status ohne Änderungen: bleibt sichtbar */}
                {place.workload &&
                  !groups.some(
                    (group) =>
                      group.workload === place.workload &&
                      (!place.area || group.area === place.area),
                  ) && (
                    <option value={placeValue(place)}>
                      {place.area
                        ? placeTitle(place.workload, place.area)
                        : workloadLabel(place.workload)}{" "}
                      (0)
                    </option>
                  )}
              </select>
            </label>
          ) : undefined
        }
      />

      <Feedback message={message} onClose={() => setMessage(null)} />

      {status === "error" && <p role="alert">Die Änderungen konnten nicht geladen werden.</p>}
      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="panel panel-empty">Keine Änderungen für diese Auswahl.</p>
      )}

      {entries.length > 0 && (
        <div className="split">
          <div className="split-list">
            <section className="panel" aria-label="Änderungen">
              {sections(entries).map((section) => {
                const total = groups.find(
                  (group) => group.workload === section.workload && group.area === section.area,
                )?.count;
                const titleId = `bereich-${section.key.replace(/[^A-Za-z0-9-]/g, "-")}`;
                const allSelected = section.entries.every((entry) => selected.includes(entry.id));
                return (
                  <div key={section.key} className="change-section">
                    <div className="change-section-head">
                      <h2 id={titleId}>{placeTitle(section.workload, section.area)}</h2>
                      <span className="small">
                        {total !== undefined && total > section.entries.length
                          ? `${section.entries.length} von ${total} geladen`
                          : plural(section.entries.length)}
                      </span>
                      {canReview && (
                        <button
                          type="button"
                          className="button button-link"
                          onClick={() => toggleSection(section)}
                        >
                          {allSelected ? "Auswahl aufheben" : "Alle auswählen"}
                          <span className="visually-hidden">
                            {" "}
                            in {placeTitle(section.workload, section.area)}
                          </span>
                        </button>
                      )}
                    </div>
                    <ul className="rows change-rows" aria-labelledby={titleId}>
                      {section.entries.map((entry) => (
                        <li
                          key={entry.id}
                          className={entry.id === current ? "row-current" : undefined}
                        >
                          {canReview && (
                            <input
                              type="checkbox"
                              className="check"
                              checked={selected.includes(entry.id)}
                              onChange={() => toggle(entry.id)}
                              aria-label={`${settingTitle(entry)} auswählen`}
                            />
                          )}
                          <span className="row-main">
                            <button
                              type="button"
                              className="row-title row-button"
                              aria-current={entry.id === current ? "true" : undefined}
                              onClick={() => open(entry.id)}
                            >
                              {settingTitle(entry)}
                            </button>
                            <span className="small">
                              {kindLabel(entry.kind)} · {formatDateTime(entry.detected_at)} · von{" "}
                              {entry.changed_by ?? "unbekannt"}
                            </span>
                          </span>
                          <span className={statusClass(entry.status)}>
                            {statusLabel(entry.status)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
            {hasMore && (
              <button
                type="button"
                className="button button-secondary load-more"
                onClick={loadMore}
              >
                Weitere laden
              </button>
            )}

            {canReview && (
              <section className="panel bulk" aria-labelledby="bewerten-titel">
                <div className="panel-head">
                  <h2 id="bewerten-titel">Auswahl bewerten</h2>
                  <span className="small">{selected.length} ausgewählt</span>
                </div>
                <div className="detail-body">
                  <label>
                    Kommentar für die Auswahl (Pflicht bei „ungewollt“)
                    <textarea
                      value={bulkComment}
                      maxLength={2000}
                      rows={2}
                      onChange={(event) => setBulkComment(event.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy}
                      onClick={() => reviewSelection("gewollt")}
                    >
                      Als gewollt bewerten
                    </button>
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => reviewSelection("ungewollt")}
                    >
                      Als ungewollt bewerten
                    </button>
                    <button
                      type="button"
                      className="button button-link"
                      disabled={busy}
                      onClick={() => reviewSelection("offen")}
                    >
                      Bewertung zurücksetzen
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="split-detail" ref={detailRef}>
            {shown ? (
              <ChangeDetail
                key={`${shown.id}-${shown.status}`}
                change={shown}
                canReview={canReview}
                canCreateItem={canCreateItem}
                busy={busy}
                onReview={(target, comment) => send([shown.id], target, comment, () => undefined)}
                onCreateItem={() => onCreateItem(shown)}
              />
            ) : (
              <Placeholder>
                Änderung in der Liste wählen, um Vorher und Nachher zu sehen.
              </Placeholder>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
