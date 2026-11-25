import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { errorText, formatDateTime, getJson, postJson, putJson } from "../api";
import { Avatar } from "../components/Avatar";
import { useConfirm } from "../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../components/Feedback";
import { FilterBar } from "../components/FilterBar";
import { InfoTip } from "../components/InfoTip";
import { ShowMore, useShowMore } from "../components/ShowMore";
import { SplitHandle, useSplit } from "../components/SplitHandle";

/* Verwaltung › Berechtigungen (design.md, „Tabelle mit Ansicht rechts“): Personen als Tabelle,
   gewählt die Rechte je Bereich rechts daneben; unter 1024 px Karten und nur die Ansicht. */

export interface PermissionArea {
  key: string;
  name: string;
  hint: string;
  levels: { label: string }[];
}

export interface PermissionPerson {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  last_login_at: string | null;
  is_admin: boolean;
  levels: Record<string, number>;
  permissions_since: string | null;
  permissions_origin: "app_rollen" | "verwaltung" | null;
}

interface Overview {
  groups_configured: boolean;
  areas: PermissionArea[];
  people: PermissionPerson[];
}

interface Candidate {
  oid: string;
  display_name: string;
  email: string;
  department: string;
}

const BASE = "/api/admin/permissions";
const WITHOUT = "ohne";
/** So viele Personen stehen zuerst da; der Rest mit „Weitere anzeigen“. */
const PEOPLE_STEP = 50;

/** Kurztexte der Rechte einer Person, z. B. „IT-Budget · Bearbeiten“. */
export function rightLabels(person: PermissionPerson, areas: PermissionArea[]): string[] {
  return areas
    .filter((area) => (person.levels[area.key] ?? 0) > 0)
    .map((area) => {
      const level = area.levels[person.levels[area.key] ?? 0];
      return area.levels.length > 2 && level ? `${area.name} · ${level.label}` : area.name;
    });
}

/** Suche nach Name oder Mail-Adresse, Filter nach Bereich oder „ohne Rechte“. */
export function filterPermissionPeople(
  people: PermissionPerson[],
  query: string,
  area: string,
): PermissionPerson[] {
  const needle = query.trim().toLowerCase();
  return people.filter((person) => {
    const count = Object.values(person.levels).filter((level) => level > 0).length;
    if (area === WITHOUT ? count > 0 : area !== "" && (person.levels[area] ?? 0) === 0) {
      return false;
    }
    return (
      needle === "" ||
      person.display_name.toLowerCase().includes(needle) ||
      (person.email ?? "").toLowerCase().includes(needle)
    );
  });
}

function sameLevels(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
}

export function Permissions() {
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [view, setView] = useState<"person" | "bereich">("person");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [split, changeSplit] = useSplit("werkbank.split.berechtigungen");
  const layoutRef = useRef<HTMLDivElement>(null);
  const paging = useShowMore(PEOPLE_STEP, `${search}|${areaFilter}`);

  const load = useCallback(() => {
    getJson<Overview>(BASE).then(setData, (problem: unknown) =>
      setFailed(errorText(problem, "Die Berechtigungen konnten nicht geladen werden.")),
    );
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(
    () => (data ? filterPermissionPeople(data.people, search, areaFilter) : []),
    [data, search, areaFilter],
  );
  const selected = data?.people.find((person) => person.id === selectedId) ?? null;
  const paneOpen = adding || selected !== null;

  if (failed) {
    return <p role="alert">{failed}</p>;
  }
  if (!data) {
    return <p role="status">Wird geladen …</p>;
  }

  const replace = (person: PermissionPerson) =>
    setData({
      ...data,
      people: data.people.some((entry) => entry.id === person.id)
        ? data.people.map((entry) => (entry.id === person.id ? person : entry))
        : [...data.people, person].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    });
  const close = () => {
    setSelectedId(null);
    setAdding(false);
  };

  return (
    <div className="admin-section">
      {!data.groups_configured && (
        <p className="notice">
          Die Gruppen aus Entra sind noch nicht eingetragen. Bis dahin entscheiden die alten
          App-Rollen, wer sich anmelden darf und wer in die Verwaltung darf.
        </p>
      )}
      <p className="note">
        Wer sich anmelden darf, regelt die Zugangs-Gruppe in Entra, wer hierher darf, die
        Admin-Gruppe. Was jemand in den Bereichen darf, legst du hier fest. Änderungen wirken
        sofort. <InfoTip term="verwaltung.berechtigungen" />
      </p>
      <div className="perm-top">
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            setSelectedId(null);
            setAdding(true);
          }}
        >
          Person hinzufügen
        </button>
      </div>
      <div className="chips" role="group" aria-label="Ansicht der Berechtigungen">
        <button
          type="button"
          className="chip chip-filter"
          aria-pressed={view === "person"}
          onClick={() => setView("person")}
        >
          Nach Person · {data.people.length}
        </button>
        <button
          type="button"
          className="chip chip-filter"
          aria-pressed={view === "bereich"}
          onClick={() => {
            setView("bereich");
            close();
          }}
        >
          Nach Bereich
        </button>
      </div>
      <Feedback message={message} onClose={() => setMessage(null)} />

      {view === "bereich" && <AreaMatrix data={data} />}

      {view === "person" && (
        <>
          <FilterBar<string>
            search={{
              label: "Suchen",
              value: search,
              placeholder: "Name oder Mail-Adresse",
              onChange: setSearch,
              hits: shown.map((person) => ({
                key: person.id,
                title: person.display_name,
                extra: person.email ?? undefined,
                onOpen: () => {
                  setAdding(false);
                  setSelectedId(person.id);
                },
              })),
              total: shown.length,
            }}
            moreActive={areaFilter !== "" ? 1 : 0}
            onReset={
              search !== "" || areaFilter !== ""
                ? () => {
                    setSearch("");
                    setAreaFilter("");
                  }
                : undefined
            }
            more={
              <label className="filter-field">
                Bereich
                <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
                  <option value="">alle</option>
                  {data.areas.map((area) => (
                    <option key={area.key} value={area.key}>
                      {area.name}
                    </option>
                  ))}
                  <option value={WITHOUT}>ohne Rechte</option>
                </select>
              </label>
            }
          />
          <div
            ref={layoutRef}
            className={
              paneOpen
                ? "case-layout case-layout-table case-layout-detail"
                : "case-layout case-layout-table"
            }
            style={{ "--case-split": split } as CSSProperties}
          >
            <div className="panel case-list">
              <div className="case-scroll">
                {shown.length === 0 && (
                  <p className="empty">Keine Person passt zu Suche und Filter.</p>
                )}
                {shown.length > 0 && (
                  <table className="case-table">
                    <caption className="visually-hidden">Personen und ihre Rechte</caption>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Rechte</th>
                        <th scope="col" className="col-extra">
                          Zuletzt angemeldet
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.slice(0, paging.limit).map((person) => (
                        <PersonRow
                          key={person.id}
                          person={person}
                          areas={data.areas}
                          selected={person.id === selectedId}
                          onOpen={() => {
                            setAdding(false);
                            setSelectedId(person.id);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
                <ShowMore
                  shown={Math.min(paging.limit, shown.length)}
                  total={shown.length}
                  onMore={paging.more}
                  onAll={paging.all}
                />
              </div>
            </div>
            {paneOpen && (
              <SplitHandle
                value={split}
                onChange={changeSplit}
                container={() => layoutRef.current}
              />
            )}
            <div className="case-main">
              {paneOpen && (
                <>
                  <a
                    className="case-back"
                    href="/verwaltung/berechtigungen"
                    onClick={(event) => {
                      event.preventDefault();
                      close();
                    }}
                  >
                    ‹ Zur Liste
                  </a>
                  {adding && (
                    <AddPerson
                      onClose={close}
                      onAdded={(person) => {
                        replace(person);
                        setAdding(false);
                        setSelectedId(person.id);
                        setMessage({
                          kind: "status",
                          text: `${person.display_name} ist aufgenommen. Lege jetzt die Rechte fest.`,
                        });
                      }}
                    />
                  )}
                  {!adding && selected && (
                    <PersonDetail
                      key={selected.id}
                      person={selected}
                      areas={data.areas}
                      onClose={close}
                      onSaved={(person, text) => {
                        replace(person);
                        setMessage({ kind: "status", text });
                      }}
                      onFailed={(text) => setMessage({ kind: "alert", text })}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Zeile der Personentabelle: ganz anklickbar; für die Tastatur zählt der Verweis im Namen. */
function PersonRow({
  person,
  areas,
  selected,
  onOpen,
}: {
  person: PermissionPerson;
  areas: PermissionArea[];
  selected: boolean;
  onOpen: () => void;
}) {
  const rights = rightLabels(person, areas);
  const badge = person.is_admin
    ? { tone: "info", text: "Verwaltung" }
    : rights.length > 0
      ? { tone: "neutral", text: rights.length === 1 ? "1 Bereich" : `${rights.length} Bereiche` }
      : { tone: "neutral", text: "ohne Rechte" };
  return (
    <tr
      className={selected ? "case-row is-selected" : "case-row"}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a, button")) {
          onOpen();
        }
      }}
    >
      <td className="case-title-cell">
        <span className="case-meta small">
          {person.last_login_at
            ? `zuletzt ${formatDateTime(person.last_login_at)}`
            : "noch nie angemeldet"}
        </span>
        <a
          href="/verwaltung/berechtigungen"
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onOpen();
          }}
        >
          {person.display_name}
        </a>
        {person.email && <span className="small perm-mail">{person.email}</span>}
      </td>
      <td>
        <span className="perm-chips">
          <span className={`pill pill-${badge.tone}`}>{badge.text}</span>
          {rights.slice(0, 3).map((text) => (
            <span key={text} className="perm-chip case-wide-only">
              {text}
            </span>
          ))}
          {rights.length > 3 && (
            <span className="perm-chip case-wide-only">+{rights.length - 3}</span>
          )}
        </span>
      </td>
      <td className="col-extra">
        {person.last_login_at ? formatDateTime(person.last_login_at) : "noch nie"}
      </td>
    </tr>
  );
}

function PersonDetail({
  person,
  areas,
  onClose,
  onSaved,
  onFailed,
}: {
  person: PermissionPerson;
  areas: PermissionArea[];
  onClose: () => void;
  onSaved: (person: PermissionPerson, text: string) => void;
  onFailed: (text: string) => void;
}) {
  const [levels, setLevels] = useState<Record<string, number>>(person.levels);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const changed = !sameLevels(levels, person.levels);
  const hasRights = Object.values(person.levels).some((level) => level > 0);

  const save = (next: Record<string, number>, text: string) => {
    setBusy(true);
    return putJson<PermissionPerson>(`${BASE}/${person.id}`, { levels: next })
      .then((saved) => {
        setLevels(saved.levels);
        onSaved(saved, text);
      })
      .catch((problem: unknown) =>
        onFailed(errorText(problem, "Die Rechte konnten nicht gespeichert werden.")),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel perm-detail" aria-labelledby="perm-person">
      <div className="panel-head case-head">
        <div className="perm-head">
          <Avatar name={person.display_name} url={person.avatar_url} />
          <div>
            <h2 id="perm-person">{person.display_name}</h2>
            <p className="small">
              {person.email ?? "ohne Mail-Adresse"} ·{" "}
              {person.last_login_at
                ? `zuletzt angemeldet ${formatDateTime(person.last_login_at)}`
                : "noch nie angemeldet"}
            </p>
          </div>
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
        {person.is_admin && (
          <p className="notice-neutral">
            Mitglied der Admin-Gruppe: darf in die Verwaltung. Das kommt aus Entra und lässt sich
            hier nicht ändern.
          </p>
        )}
        {person.permissions_since === null && (
          <p className="small">
            Die alten App-Rollen werden bei der nächsten Anmeldung übernommen, solange du hier
            nichts speicherst.
          </p>
        )}
        {person.permissions_since !== null && person.permissions_origin === "app_rollen" && (
          <p className="small">
            Übernommen aus den App-Rollen am {formatDateTime(person.permissions_since)}.
          </p>
        )}
        <form
          className="perm-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(levels, `Die Rechte von ${person.display_name} sind gespeichert.`);
          }}
        >
          {areas.map((area) => (
            <div key={area.key} className="perm-row">
              <fieldset className="perm-area">
                <legend>
                  {area.name}
                  <span className="small perm-hint">{area.hint}</span>
                </legend>
                <div className="perm-levels">
                  {area.levels.map((level, index) => (
                    <label key={level.label} className="segmented-radio">
                      <input
                        type="radio"
                        name={`stufe-${area.key}`}
                        checked={(levels[area.key] ?? 0) === index}
                        onChange={() => setLevels({ ...levels, [area.key]: index })}
                      />
                      <span>{level.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ))}
          <div className="perm-actions">
            <button type="submit" className="button button-primary" disabled={busy || !changed}>
              Speichern
            </button>
            {changed && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setLevels(person.levels)}
              >
                Änderungen verwerfen
              </button>
            )}
            {hasRights && (
              <button
                type="button"
                className="button button-danger"
                disabled={busy}
                onClick={() =>
                  ask(
                    {
                      title: `Alle Rechte von ${person.display_name} entziehen?`,
                      text: "Die Person kann sich weiter anmelden, sieht aber nur noch die Startseite. Offene Sitzungen verlieren den Zugriff sofort.",
                      action: "Rechte entziehen",
                    },
                    () => save({}, `${person.display_name} hat jetzt keine Rechte mehr.`),
                  )
                }
              >
                Alle Rechte entziehen
              </button>
            )}
          </div>
        </form>
      </div>
      {dialog}
    </section>
  );
}

function AddPerson({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (person: PermissionPerson) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Candidate[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      getJson<Candidate[]>(`${BASE}/candidates?q=${encodeURIComponent(term)}`).then(
        (result) => {
          if (active) {
            setHits(result);
            setProblem(null);
          }
        },
        (failure: unknown) =>
          active && setProblem(errorText(failure, "Die Suche in Entra ist nicht möglich.")),
      );
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  return (
    <section className="panel perm-detail" aria-labelledby="perm-add">
      <div className="panel-head case-head">
        <div>
          <h2 id="perm-add">Person hinzufügen</h2>
          <p className="small">
            Nur nötig für Personen, die sich noch nie angemeldet haben. Anmelden können sie sich nur
            als Mitglied der Zugangs-Gruppe.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary case-close"
          aria-label="Maske schließen"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="detail-body">
        <label className="perm-search">
          Name in Entra suchen
          <input
            type="search"
            value={query}
            maxLength={60}
            autoComplete="off"
            placeholder="mindestens zwei Zeichen"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {problem && <p role="alert">{problem}</p>}
        {!problem && term.length >= 2 && hits !== null && hits.length === 0 && (
          <p className="empty">Niemand gefunden, der noch nicht in der Liste steht.</p>
        )}
        {!problem && term.length >= 2 && hits !== null && hits.length > 0 && (
          <ul className="plain perm-hits">
            {hits.map((hit) => (
              <li key={hit.oid}>
                <span>
                  <strong>{hit.display_name}</strong>
                  <span className="small">
                    {" "}
                    · {[hit.department, hit.email].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    postJson<PermissionPerson>(`${BASE}/people`, { oid: hit.oid })
                      .then(onAdded)
                      .catch((failure: unknown) =>
                        setProblem(
                          errorText(failure, "Die Person konnte nicht aufgenommen werden."),
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Hinzufügen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Nach Bereich: wer welche Stufe hat (Matrix, bleibt am Handy eine Tabelle zum Wischen). */
function AreaMatrix({ data }: { data: Overview }) {
  const maxLevels = Math.max(...data.areas.map((area) => area.levels.length));
  const columns = Array.from({ length: maxLevels - 1 }, (_, index) => index + 1);
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Rechte nach Bereich">
      <table>
        <caption className="visually-hidden">Wer welche Stufe je Bereich hat</caption>
        <thead>
          <tr>
            <th scope="col">Bereich</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                Stufe {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.areas.map((area) => (
            <tr key={area.key}>
              <th scope="row">{area.name}</th>
              {columns.map((column) => {
                const level = area.levels[column];
                if (!level) {
                  return <td key={column} />;
                }
                const names = data.people
                  .filter((person) => (person.levels[area.key] ?? 0) === column)
                  .map((person) => person.display_name);
                return (
                  <td key={column}>
                    <span className="small perm-level-name">{level.label}</span>
                    {names.length > 0 ? names.join(", ") : <span className="empty">niemand</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
