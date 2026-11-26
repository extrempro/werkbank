import { useEffect, useId, useState, type FormEvent, type MouseEvent } from "react";
import { errorText } from "../../api";
import { FilterBar } from "../../components/FilterBar";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { FixedChoice } from "../../components/ListChoice";
import { navigate } from "../../router";
import { useDebounced } from "../inventory/paged";
import {
  ENTRY_FILTERS,
  ENTRY_STATES,
  LIST_MAX,
  SOFTWARE,
  SOURCE_LABELS,
  TOPICS,
  TOPIC_COLORS,
  TOPIC_LABELS,
  createEntry,
  entriesPath,
  entryPath,
  fetchEntries,
  formatDate,
  topicOf,
  type EntryFilter,
  type EntryList,
  type EntrySummary,
  type SoftwareKey,
  type Topic,
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

export interface TopicGroup {
  topic: Topic;
  entries: EntrySummary[];
  /** die häufigsten Dienste der Kategorie, für die Zeile unter der Überschrift */
  services: string[];
  newCount: number;
  dueCount: number;
}

/** Einträge nach Kategorie, in der festen Reihenfolge; innen erst mit Frist, dann neu, dann der Rest. */
export function groupByTopic(entries: readonly EntrySummary[]): TopicGroup[] {
  return TOPICS.map((topic) => {
    const own = entries.filter((entry) => topicOf(entry.topic) === topic);
    const ordered = groupEntries(own).flatMap((group) => group.entries);
    const tally = new Map<string, number>();
    own.forEach((entry) =>
      entry.services.forEach((service) => tally.set(service, (tally.get(service) ?? 0) + 1)),
    );
    const services = [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
      .slice(0, 3)
      .map(([service]) => service);
    return {
      topic,
      entries: ordered,
      services,
      newCount: own.filter((entry) => entry.status === "neu").length,
      dueCount: own.filter((entry) => entry.action_required_by).length,
    };
  }).filter((group) => group.entries.length > 0);
}

function groupSummary(group: TopicGroup): string {
  const parts = [`${group.entries.length} ${group.entries.length === 1 ? "Meldung" : "Meldungen"}`];
  if (group.newCount) {
    parts.push(`${group.newCount} neu`);
  }
  if (group.dueCount) {
    parts.push(`${group.dueCount} mit Frist`);
  }
  return parts.join(", ");
}

/** Eine Meldung als eigene Karte; die ganze Karte ist ein Verweis auf die Seite des Eintrags. */
function EntryItem({ entry }: { entry: EntrySummary }) {
  const path = entryPath(entry.id);
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
      <a className="ev-card" href={path} onClick={onClick}>
        <span className="ev-card-head">
          <span className="mono">{entry.number}</span>
          <span className={`ev-state ev-state-${entry.status}`}>
            <span className="ev-state-dot" aria-hidden="true" />
            {state.label}
          </span>
        </span>
        <strong className="ev-card-title">{entry.title}</strong>
        <span className="ev-card-meta">
          <span>
            {entry.services[0] ?? "–"} · {entry.kind ?? SOURCE_LABELS[entry.source] ?? entry.source}
          </span>
          {entry.action_required_by && (
            <span className="ev-due">Handeln bis {formatDate(entry.action_required_by)}</span>
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
      (created) => navigate(entryPath(created.id)),
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

/** Microsoft 365 › Neuerungen (spec.md 8.3): die Liste nach Kategorien, gewählt ein Eintrag als
 *  eigene Seite mit Pfad und Blättern innerhalb der Kategorie. */
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
  const [topic, setTopicFilter] = useState<Topic | "alle">("alle");
  const [hideInfo, setHideInfo] = useState(readHideInfo);
  const [closed, setClosed] = useState<ReadonlySet<Topic>>(new Set());
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [list, setList] = useState<{ key: string; data: EntryList } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ id: number; topic: string } | null>(null);
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
  const listPath = entriesPath();
  const backToList = () => navigate(listPath);
  const name = SOFTWARE[software] ?? software;
  const counts: Record<EntryFilter, number | null> = {
    offen: data ? data.open : null,
    neu: data ? data.new : null,
    frist: data ? data.due : null,
    abgeschlossen: data ? data.done : null,
  };
  const allGroups = entries ? groupByTopic(entries) : null;
  const groups = allGroups?.filter((group) => topic === "alle" || group.topic === topic) ?? null;
  const toggle = (key: Topic) =>
    setClosed((before) => {
      const next = new Set(before);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  if (entryId !== null) {
    // Kategorie aus der geladenen Ansicht (sie kann gerade geändert worden sein), sonst aus der Liste
    const listed = entries?.find((entry) => entry.id === entryId) ?? null;
    const entryTopic = topicOf(
      current && current.id === entryId ? current.topic : (listed?.topic ?? "allgemein"),
    );
    const siblings = entries?.filter((entry) => topicOf(entry.topic) === entryTopic) ?? [];
    const ordered = groupByTopic(siblings)[0]?.entries ?? [];
    const index = ordered.findIndex((entry) => entry.id === entryId);
    const previous = index > 0 ? ordered[index - 1] : undefined;
    const next = index >= 0 ? ordered[index + 1] : undefined;
    const label = TOPIC_LABELS[entryTopic];
    return (
      <div className="page page-wide ev-page">
        <nav aria-label="Pfad" className="loc-crumbs small ev-crumbs">
          <span>{name}</span>
          {" › "}
          <Link to={listPath}>Neuerungen</Link>
          {" › "}
          <span>{label}</span>
          {listed && (
            <>
              {" › "}
              <span aria-current="page">{listed.number}</span>
            </>
          )}
        </nav>
        <EntryDetail
          key={entryId}
          entryId={entryId}
          onLoaded={(entry) => setCurrent({ id: entry.id, topic: entry.topic })}
          onChanged={() => setReload((value) => value + 1)}
          onClose={backToList}
        />
        {(previous || next) && (
          <nav className="ev-pager" aria-label={`Blättern in ${label}`}>
            {previous ? <Link to={entryPath(previous.id)}>‹ Vorherige in {label}</Link> : <span />}
            {next && <Link to={entryPath(next.id)}>Nächste in {label} ›</Link>}
          </nav>
        )}
      </div>
    );
  }

  return (
    <div className="page page-wide ev-page">
      <header className="page-head case-top">
        <div>
          <p className="module-label">{name} · Neuerungen</p>
          <h1>Nachrichtencenter</h1>
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
      <section className="panel ev-list" aria-label={`Neuerungen ${name}`}>
        <FilterBar
          plain
          search={{
            label: "Suchen",
            value: search,
            placeholder: "Nummer, Titel, MC…, Dienst …",
            onChange: setSearch,
            hits: (entries ?? []).map((entry) => ({
              key: entry.id,
              title: entry.title,
              extra: `${TOPIC_LABELS[topicOf(entry.topic)]} · ${ENTRY_STATES[entry.status].label}`,
              meta: entry.number,
              href: entryPath(entry.id),
            })),
            total: data?.total ?? entries?.length ?? 0,
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
          more={
            <FixedChoice
              label="Kategorie"
              value={topic}
              options={[
                { value: "alle", label: "Alle Kategorien", hint: `${entries?.length ?? 0}` },
                ...TOPICS.map((item) => ({
                  value: item,
                  label: TOPIC_LABELS[item],
                  hint: `${allGroups?.find((group) => group.topic === item)?.entries.length ?? 0}`,
                })),
              ]}
              onChange={(value) => setTopicFilter(value)}
            />
          }
          moreTitle="Kategorie"
          moreActive={topic === "alle" ? 0 : 1}
          onReset={topic === "alle" ? undefined : () => setTopicFilter("alle")}
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
        {!entries && !failed && <p role="status">Wird geladen …</p>}
        {groups && groups.length === 0 && (
          <p className="empty">
            {query.trim() ? "Kein Eintrag passt zur Suche." : "Keine Einträge in dieser Liste."}
          </p>
        )}
        {groups?.map((group) => {
          const open = !closed.has(group.topic);
          const bodyId = `ev-t-${group.topic}`;
          return (
            <section
              key={group.topic}
              className={`ev-topic-group bereich-${TOPIC_COLORS[group.topic]}`}
              aria-labelledby={`${bodyId}-kopf`}
            >
              <h2 className="ev-topic-head">
                <button
                  type="button"
                  id={`${bodyId}-kopf`}
                  className="ev-topic-toggle"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => toggle(group.topic)}
                >
                  <span className="ev-topic-chevron" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="ev-topic-name">{TOPIC_LABELS[group.topic]}</span>
                  <span className="ev-group-count">{group.entries.length}</span>
                </button>
              </h2>
              <p className="small ev-topic-summary">
                {groupSummary(group)}
                {group.services.length > 0 && ` · ${group.services.join(", ")}`}
              </p>
              <ul id={bodyId} hidden={!open}>
                {group.entries.map((entry) => (
                  <EntryItem key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          );
        })}
        {entries && data && data.total > entries.length && (
          <p className="small ev-more" role="status">
            {entries.length} von {data.total} Einträgen – grenze die Suche ein (höchstens {LIST_MAX}
            ).
          </p>
        )}
      </section>
    </div>
  );
}
