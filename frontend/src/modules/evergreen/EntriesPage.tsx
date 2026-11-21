import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { errorText } from "../../api";
import { SplitHandle, useSplit } from "../../components/SplitHandle";
import { navigate } from "../../router";
import { MoreButton, useDebounced, usePagedList } from "../inventory/paged";
import {
  ENTRY_FILTERS,
  ENTRY_STATES,
  NOTE_LABELS,
  SOFTWARE,
  SOURCE_LABELS,
  addNote,
  closeEntry,
  createEntry,
  entriesPath,
  entryPath,
  fetchEntries,
  fetchEntry,
  formatDate,
  reopenEntry,
  type Entry,
  type EntryFilter,
  type EntrySummary,
  type SoftwareKey,
} from "./api";

const EDITOR_ROLE = "Evergreen.Editor";
// Breite der Tabelle neben der Ansicht, gemerkt im Browser
const SPLIT_KEY = "werkbank-evergreen-breite";
const NOTE_MAX = 4000;

function services(entry: EntrySummary): string {
  return entry.services.length ? entry.services.join(", ") : "–";
}

/** Zeile der Tabelle. Die ganze Zeile ist anklickbar, für Tastatur und Screenreader zählt
 *  der Verweis im Titel. */
function EntryRow({ entry, selected }: { entry: EntrySummary; selected: boolean }) {
  const path = entryPath(entry.software, entry.id);
  const open = () => navigate(path);
  return (
    <tr
      className={selected ? "case-row is-selected" : "case-row"}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a")) {
          open();
        }
      }}
    >
      <td className="col-nr mono nowrap">{entry.number}</td>
      <td className="case-title-cell">
        <span className="case-meta small">
          <span className="mono">{entry.number}</span> · {services(entry)} ·{" "}
          {formatDate(entry.created_at)}
        </span>
        <a
          href={path}
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
            if (event.button !== 0 || modified) {
              return;
            }
            event.preventDefault();
            open();
          }}
        >
          {entry.title}
        </a>
        {entry.major_change && <span className="pill pill-neutral ev-major">Größere Änderung</span>}
      </td>
      <td className="col-extra">{services(entry)}</td>
      <td className="col-extra nowrap">{formatDate(entry.created_at)}</td>
      <td className="col-extra">{entry.last_editor ?? "–"}</td>
      <td className="nowrap">
        <span className={`pill ${ENTRY_STATES[entry.status].pill}`}>
          {ENTRY_STATES[entry.status].label}
        </span>
      </td>
    </tr>
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
      setError("Bitte einen Titel eingeben.");
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

/** Ansicht eines Eintrags: Angaben, Text der Meldung, Verlauf mit Notizen. */
function EntryDetail({
  entryId,
  onChanged,
  onClose,
}: {
  entryId: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();

  useEffect(() => {
    let active = true;
    fetchEntry(entryId).then(
      (loaded) => active && setEntry(loaded),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Der Eintrag konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [entryId]);

  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!entry) {
    return <p role="status">Wird geladen …</p>;
  }

  const run = (action: () => Promise<Entry>) => {
    setBusy(true);
    setNotice(null);
    action().then(
      (updated) => {
        setEntry(updated);
        setNote("");
        setBusy(false);
        onChanged();
      },
      (problem: unknown) => {
        setBusy(false);
        setNotice(errorText(problem, "Das hat nicht geklappt."));
      },
    );
  };
  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) {
      setNotice("Bitte eine Notiz eingeben.");
      return;
    }
    run(() => addNote(entry.id, note.trim()));
  };
  const done = entry.status === "abgeschlossen";

  return (
    <>
      <section className="panel" aria-labelledby="eintrag-titel">
        <div className="panel-head case-head">
          <div>
            <p className="small">
              <span className="mono">{entry.number}</span> ·{" "}
              {SOURCE_LABELS[entry.source] ?? entry.source} · {formatDate(entry.created_at)}
            </p>
            <h2 id="eintrag-titel">{entry.title}</h2>
            <p className="small">
              <span className={`pill ${ENTRY_STATES[entry.status].pill}`}>
                {ENTRY_STATES[entry.status].label}
              </span>
              {entry.last_editor ? ` Zuletzt: ${entry.last_editor}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary case-close"
            aria-label="Ansicht schließen"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="detail-body">
          <dl className="facts">
            <div>
              <dt>Dienst</dt>
              <dd>{services(entry)}</dd>
            </div>
            {entry.source === "nachrichtencenter" && entry.source_ref && (
              <div>
                <dt>Meldung</dt>
                <dd className="mono">{entry.source_ref}</dd>
              </div>
            )}
            {entry.published_at && (
              <div>
                <dt>Veröffentlicht</dt>
                <dd>{formatDate(entry.published_at)}</dd>
              </div>
            )}
            {entry.action_required_by && (
              <div>
                <dt>Handeln bis</dt>
                <dd>{formatDate(entry.action_required_by)}</dd>
              </div>
            )}
            {entry.major_change && (
              <div>
                <dt>Art</dt>
                <dd>Größere Änderung</dd>
              </div>
            )}
          </dl>
          {entry.body && (
            <details className="ev-body-wrap" open>
              <summary>Text der Meldung</summary>
              <div className="ev-body">{entry.body}</div>
            </details>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="eintrag-verlauf">
        <div className="panel-head">
          <h2 id="eintrag-verlauf">Notizen und Verlauf</h2>
        </div>
        <div className="detail-body">
          {notice && (
            <p role="alert" className="hint-box hint-bad">
              {notice}
            </p>
          )}
          {entry.notes.length === 0 ? (
            <p className="empty">Noch keine Notizen.</p>
          ) : (
            <ol className="timeline">
              {entry.notes.map((item) => (
                <li key={item.id}>
                  <div className="timeline-head">
                    <strong>{NOTE_LABELS[item.kind] ?? item.kind}</strong>
                    <span className="small">
                      {formatDate(item.created_at)} · {item.author ?? "Werkbank"}
                    </span>
                  </div>
                  {item.text && <span className="ev-note">{item.text}</span>}
                </li>
              ))}
            </ol>
          )}
          {entry.can_edit && (
            <form className="settings-form form-stack ev-note-form" onSubmit={submitNote}>
              <label htmlFor={noteId}>{done ? "Notiz zum Wiederöffnen (optional)" : "Notiz"}</label>
              <textarea
                id={noteId}
                value={note}
                rows={3}
                maxLength={NOTE_MAX}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="project-actions">
                {done ? (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => run(() => reopenEntry(entry.id, note.trim()))}
                  >
                    Wieder öffnen
                  </button>
                ) : (
                  <>
                    <button type="submit" className="button" disabled={busy}>
                      Notiz anfügen
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => run(() => closeEntry(entry.id, note.trim()))}
                    >
                      Abschließen
                    </button>
                  </>
                )}
              </div>
              {!done && (
                <p className="small">
                  „Abschließen“ nimmt den Text oben als letzte Notiz mit, wenn du etwas eingetragen
                  hast.
                </p>
              )}
            </form>
          )}
        </div>
      </section>
    </>
  );
}

/** Evergreen › Software: Einträge als Tabelle, ein gewählter Eintrag öffnet rechts daneben.
 *  Schmal: erst die Liste, gewählt nur die Ansicht mit „Zur Liste“. */
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
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useDebounced(search);
  const searchId = useId();
  const paged = usePagedList<EntrySummary, { open: number; new: number }>(
    `${software}|${filter}|${query}`,
    reload,
    (offset, limit) =>
      fetchEntries(software, filter, query, offset, limit).then((result) => ({
        items: result.entries,
        total: result.total,
        extra: { open: result.open, new: result.new },
      })),
    "Die Einträge konnten nicht geladen werden.",
  );
  const entries = paged.items;
  const openCount = paged.extra ? paged.extra.open : null;
  const newCount = paged.extra ? paged.extra.new : null;
  const listPath = entriesPath(software);
  const backToList = () => navigate(listPath);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [split, changeSplit] = useSplit(SPLIT_KEY);
  const name = SOFTWARE[software] ?? software;

  return (
    <div className="page page-wide case-page">
      <header className="page-head case-top">
        <div>
          <p className="module-label">Evergreen</p>
          <h1>{name}</h1>
        </div>
        {openCount !== null && (
          <p className="case-count small">
            {openCount} offen{newCount ? `, davon ${newCount} neu` : ""}
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
      {paged.error && (
        <p role="alert" className="hint-box hint-bad">
          {paged.error}
        </p>
      )}
      {creating && <NewEntryForm software={software} onCancel={() => setCreating(false)} />}
      <div className="panel case-toolbar">
        <div className="case-search">
          <label htmlFor={searchId} className="visually-hidden">
            Einträge durchsuchen
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            maxLength={100}
            placeholder="Nummer, Titel, Meldung (MC…), Dienst …"
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Status">
          {ENTRY_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chip chip-filter"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {item.id === "offen" && openCount !== null ? ` (${openCount})` : ""}
              {item.id === "neu" && newCount !== null ? ` (${newCount})` : ""}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={layoutRef}
        className={
          entryId === null
            ? "case-layout case-layout-table"
            : "case-layout case-layout-table case-layout-detail"
        }
        style={{ "--case-split": split } as CSSProperties}
      >
        <div className="panel case-list">
          <div className="case-scroll">
            {!entries && !paged.error && <p role="status">Wird geladen …</p>}
            {entries && entries.length === 0 && (
              <p className="empty">
                {query.trim()
                  ? "Kein Eintrag passt zur Suche."
                  : "Keine Einträge in diesem Status."}
              </p>
            )}
            {entries && entries.length > 0 && (
              <table className="case-table" aria-label={`Einträge ${name}`}>
                <thead>
                  <tr>
                    <th scope="col" className="col-nr">
                      Nr.
                    </th>
                    <th scope="col">Titel</th>
                    <th scope="col" className="col-extra">
                      Dienst
                    </th>
                    <th scope="col" className="col-extra">
                      Eingang
                    </th>
                    <th scope="col" className="col-extra">
                      Bearbeitet von
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} selected={entry.id === entryId} />
                  ))}
                </tbody>
              </table>
            )}
            {entries && (
              <MoreButton
                shown={entries.length}
                total={paged.total}
                loading={paged.loadingMore}
                onMore={paged.more}
              />
            )}
          </div>
        </div>
        {entryId !== null && (
          <SplitHandle value={split} onChange={changeSplit} container={() => layoutRef.current} />
        )}
        <div className="case-main">
          {entryId !== null && (
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
                onChanged={() => setReload(reload + 1)}
                onClose={backToList}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
