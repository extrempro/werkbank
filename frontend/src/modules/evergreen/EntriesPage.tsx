import { useEffect, useId, useState, type FormEvent, type MouseEvent } from "react";
import { errorText } from "../../api";
import { FilterBar } from "../../components/FilterBar";
import { InfoTip } from "../../components/InfoTip";
import { Placeholder } from "../../components/Placeholder";
import { navigate } from "../../router";
import { useDebounced } from "../inventory/paged";
import {
  ENTRY_FILTERS,
  ENTRY_STATES,
  LIST_MAX,
  SOFTWARE,
  SOURCE_LABELS,
  createEntry,
  entriesPath,
  entryPath,
  fetchEntries,
  formatDate,
  type EntryFilter,
  type EntryList,
  type EntrySummary,
  type SoftwareKey,
} from "./api";
import { EntryDetail } from "./EntryDetail";

const EDITOR_ROLE = "Evergreen.Editor";
// Schalter „Reine Info-Meldungen ausblenden“, gemerkt im Browser (Standard: an)
const INFO_KEY = "werkbank-evergreen-info";

function readHideInfo(): boolean {
  try {
    return window.localStorage.getItem(INFO_KEY) !== "aus";
  } catch {
    return true;
  }
}

function storeHideInfo(value: boolean): void {
  try {
    window.localStorage.setItem(INFO_KEY, value ? "an" : "aus");
  } catch {
    // ohne Speicher im Browser gilt der Schalter nur bis zum Neuladen
  }
}

interface Group {
  key: string;
  label: string;
  entries: EntrySummary[];
}

/** Offene Einträge in Gruppen: mit Frist (früheste zuerst), neu, in Bearbeitung. */
export function groupEntries(entries: readonly EntrySummary[]): Group[] {
  const due = entries
    .filter((entry) => entry.action_required_by)
    .sort((a, b) => (a.action_required_by ?? "").localeCompare(b.action_required_by ?? ""));
  const rest = entries.filter((entry) => !entry.action_required_by);
  return [
    { key: "frist", label: "Mit Frist", entries: due },
    { key: "neu", label: "Neu", entries: rest.filter((entry) => entry.status === "neu") },
    {
      key: "bearbeitung",
      label: "In Bearbeitung",
      entries: rest.filter((entry) => entry.status !== "neu"),
    },
  ].filter((group) => group.entries.length > 0);
}

/** Listeneintrag: der ganze Eintrag ist ein Verweis auf die Ansicht. */
function EntryItem({ entry, selected }: { entry: EntrySummary; selected: boolean }) {
  const path = entryPath(entry.software, entry.id);
  const state = ENTRY_STATES[entry.status];
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || modified) {
      return;
    }
    event.preventDefault();
    navigate(path);
  };
  return (
    <li>
      <a
        className="case-item ev-item"
        href={path}
        aria-current={selected ? "true" : undefined}
        onClick={onClick}
      >
        <span className="case-item-head">
          <span className="mono small">{entry.number}</span>
          <span className={`pill ${state.pill}`}>{state.label}</span>
        </span>
        <strong className="ev-item-title">{entry.title}</strong>
        <span className="small ev-item-meta">
          <span>
            {entry.services[0] ?? "–"} · {entry.kind ?? SOURCE_LABELS[entry.source] ?? entry.source}
          </span>
          {entry.action_required_by && (
            <span className="ev-due">bis {formatDate(entry.action_required_by)}</span>
          )}
        </span>
      </a>
    </li>
  );
}

/** Formular für einen Eintrag von Hand. */
function NewEntryForm({ software, onCancel }: { software: SoftwareKey; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [service, setService] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const serviceId = useId();
  const bodyId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Bitte gib einen Titel ein.");
      return;
    }
    setBusy(true);
    setError(null);
    createEntry({
      software,
      title: title.trim(),
      service: service.trim() || undefined,
      body: body.trim() || undefined,
    }).then(
      (created) => navigate(entryPath(software, created.id)),
      (problem: unknown) => {
        setBusy(false);
        setError(errorText(problem, "Der Eintrag konnte nicht angelegt werden."));
      },
    );
  };

  return (
    <form className="panel settings-form form-stack ev-new" onSubmit={submit} noValidate>
      <h2>Neuer Eintrag</h2>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <label htmlFor={titleId}>Titel</label>
      <input
        id={titleId}
        value={title}
        maxLength={500}
        required
        aria-invalid={error !== null && !title.trim()}
        onChange={(event) => setTitle(event.target.value)}
      />
      <label htmlFor={serviceId}>Dienst (optional)</label>
      <input
        id={serviceId}
        value={service}
        maxLength={100}
        placeholder="z. B. Microsoft Teams"
        onChange={(event) => setService(event.target.value)}
      />
      <label htmlFor={bodyId}>Beschreibung (optional)</label>
      <textarea
        id={bodyId}
        value={body}
        rows={4}
        maxLength={20000}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="project-actions">
        <button type="submit" className="button" disabled={busy}>
          Anlegen
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

/** Evergreen › Software: Liste und Ansicht (spec.md 8.3). Links die Liste mit Suche, Status
 *  und Gruppen, rechts die Ansicht; schmal erst die Liste, gewählt nur die Ansicht. */
export function EntriesPage({
  software,
  entryId,
  roles,
}: {
  software: SoftwareKey;
  entryId: number | null;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(EDITOR_ROLE);
  const [filter, setFilter] = useState<EntryFilter>("offen");
  const [search, setSearch] = useState("");
  const [hideInfo, setHideInfo] = useState(readHideInfo);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [list, setList] = useState<{ key: string; data: EntryList } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const query = useDebounced(search);
  const infoId = useId();
  const key = `${software}|${filter}|${query}|${hideInfo}`;

  useEffect(() => {
    let active = true;
    fetchEntries(software, filter, query, hideInfo).then(
      (data) => {
        if (active) {
          setList({ key, data });
          setFailed(null);
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Einträge konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [software, filter, query, hideInfo, reload, key]);

  const data = list?.data ?? null;
  const entries = list && list.key === key ? list.data.entries : null;
  const listPath = entriesPath(software);
  const backToList = () => navigate(listPath);
  const name = SOFTWARE[software] ?? software;
  const counts: Record<EntryFilter, number | null> = {
    offen: data ? data.open : null,
    neu: data ? data.new : null,
    frist: data ? data.due : null,
    abgeschlossen: data ? data.done : null,
  };
  const groups = entries && filter === "offen" ? groupEntries(entries) : null;

  return (
    <div className="page page-wide ev-page">
      <header className="page-head case-top">
        <div>
          <p className="module-label">Evergreen</p>
          <h1>{name}</h1>
        </div>
        {data && (
          <p className="case-count small">
            {data.open} offen{data.new ? `, davon ${data.new} neu` : ""}
          </p>
        )}
        {canEdit && !creating && (
          <button
            type="button"
            className="button button-secondary ev-new-button"
            onClick={() => setCreating(true)}
          >
            Neuer Eintrag
          </button>
        )}
      </header>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {creating && <NewEntryForm software={software} onCancel={() => setCreating(false)} />}
      <div className={entryId === null ? "case-layout" : "case-layout case-layout-detail"}>
        <nav className="panel case-list ev-list" aria-label={`Einträge ${name}`}>
          <div className="case-filters">
            <FilterBar
              plain
              search={{
                label: "Einträge durchsuchen",
                value: search,
                placeholder: "Nummer, Titel, MC…, Dienst …",
                onChange: setSearch,
              }}
              status={{
                label: "Status",
                value: filter,
                onChange: setFilter,
                options: ENTRY_FILTERS.map((item) => ({
                  value: item.id,
                  label: item.label,
                  count: counts[item.id],
                })),
              }}
            />
            <div className="ev-info-row">
              <label className="check-label ev-info-toggle" htmlFor={infoId}>
                <input
                  id={infoId}
                  type="checkbox"
                  className="check"
                  checked={hideInfo}
                  onChange={(event) => {
                    setHideInfo(event.target.checked);
                    storeHideInfo(event.target.checked);
                  }}
                />
                Reine Info-Meldungen ausblenden
              </label>
              <InfoTip term="evergreen.info-meldungen" />
            </div>
          </div>
          <div className="case-scroll">
            {!entries && !failed && <p role="status">Wird geladen …</p>}
            {entries && entries.length === 0 && (
              <p className="empty">
                {query.trim() ? "Kein Eintrag passt zur Suche." : "Keine Einträge in dieser Liste."}
              </p>
            )}
            {groups &&
              groups.map((group) => (
                <section key={group.key} className="ev-group" aria-labelledby={`ev-g-${group.key}`}>
                  <h2 id={`ev-g-${group.key}`} className="ev-group-head">
                    <span>{group.label}</span>
                    <span className="ev-group-count">{group.entries.length}</span>
                  </h2>
                  <ul>
                    {group.entries.map((entry) => (
                      <EntryItem key={entry.id} entry={entry} selected={entry.id === entryId} />
                    ))}
                  </ul>
                </section>
              ))}
            {entries && !groups && entries.length > 0 && (
              <ul>
                {entries.map((entry) => (
                  <EntryItem key={entry.id} entry={entry} selected={entry.id === entryId} />
                ))}
              </ul>
            )}
            {entries && data && data.total > entries.length && (
              <p className="small ev-more" role="status">
                {entries.length} von {data.total} Einträgen – grenze die Suche ein (höchstens{" "}
                {LIST_MAX}).
              </p>
            )}
          </div>
        </nav>
        <div className="case-main">
          {entryId === null ? (
            <Placeholder>Wähle links einen Eintrag, um ihn anzusehen und zu bewerten.</Placeholder>
          ) : (
            <>
              <a
                className="case-back"
                href={listPath}
                onClick={(event) => {
                  event.preventDefault();
                  backToList();
                }}
              >
                ‹ Zur Liste
              </a>
              <EntryDetail
                key={entryId}
                entryId={entryId}
                onChanged={() => setReload((value) => value + 1)}
                onClose={backToList}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
