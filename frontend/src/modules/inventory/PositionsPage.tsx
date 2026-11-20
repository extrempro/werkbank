import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { INVENTORY_MASTER_PATH, INVENTORY_POSITIONS_PATH } from "../../navigation";
import { navigate } from "../../router";
import { PersonPicker } from "./PersonPicker";
import { LocationPanel, PlaceLine } from "./PlaceInfo";
import { DeviceList, EventPanel } from "./parts";
import {
  createPosition,
  deletePosition,
  fetchMasterData,
  fetchPosition,
  fetchPositions,
  filterPositions,
  formatDate,
  INVENTORY_EDITOR_ROLE,
  POSITION_TABS,
  positionPath,
  updatePosition,
  workplaceName,
  workplacePath,
  type Department,
  type Person,
  type Position,
  type PositionInput,
  type PositionSummary,
  type PositionTab,
} from "./api";

/** Formular für eine Stelle; beim Anlegen und Bearbeiten gleich. */
function PositionForm({
  departments,
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  departments: Department[];
  initial: PositionInput;
  submitLabel: string;
  onSave: (body: PositionInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [departmentId, setDepartmentId] = useState(
    initial.department_id === null ? "" : String(initial.department_id),
  );
  const [person, setPerson] = useState<Person | null>(initial.person);
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte eine Bezeichnung eintragen.");
      return;
    }
    setBusy(true);
    setError(null);
    onSave({
      name: name.trim(),
      department_id: departmentId ? Number(departmentId) : null,
      person,
      note: note.trim(),
    }).catch((problem: unknown) => {
      setError(errorText(problem, "Die Stelle konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  return (
    <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
      <div className="tool-row">
        <label>
          Bezeichnung
          <input
            type="text"
            value={name}
            maxLength={120}
            autoComplete="off"
            placeholder="z. B. Sachbearbeitung Einkauf"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="narrow">
          Abteilung (freiwillig)
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">keine Abteilung</option>
            {departments.map((entry) => (
              <option key={entry.id} value={String(entry.id)}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {departments.length === 0 && (
        <p className="small">
          Abteilungen legst du unter <Link to={INVENTORY_MASTER_PATH}>Stammdaten</Link> an.
        </p>
      )}
      <PersonPicker value={person} onChange={setPerson} />
      <label>
        Notiz (freiwillig)
        <input
          type="text"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

const EMPTY_POSITION: PositionInput = { name: "", department_id: null, person: null, note: "" };

/** IT-Bestand › Stellen: Liste mit Suche, neue Stelle. */
export function PositionsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [list, setList] = useState<PositionSummary[] | null>(null);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPositions().then(
      (result) => active && setList(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Stellen konnten nicht geladen werden.")),
    );
    if (canEdit) {
      fetchMasterData().then(
        (result) => active && setDepartments(result.departments),
        () => active && setDepartments([]),
      );
    }
    return () => {
      active = false;
    };
  }, [canEdit]);

  const shown = list ? filterPositions(list, query) : [];

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Stellen</h1>
          <p className="page-sub">
            Wer eine Stelle besetzt, legst du hier fest; die Person wählst du aus Entra. Hardware
            und Arbeitsplätze hängen an der Stelle, nicht an der Person.
          </p>
        </div>
        {canEdit && !creating && departments && (
          <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
            Stelle anlegen
          </button>
        )}
      </header>

      {canEdit && creating && departments && (
        <section className="panel" aria-labelledby="stelle-neu">
          <div className="panel-head">
            <h2 id="stelle-neu">Stelle anlegen</h2>
          </div>
          <p className="small panel-note">
            Die Nummer vergibt die Werkbank fortlaufend (Präfix unter Stammdaten › Nummernkreise).
          </p>
          <PositionForm
            departments={departments}
            initial={EMPTY_POSITION}
            submitLabel="Stelle anlegen"
            onCancel={() => setCreating(false)}
            onSave={(body) => createPosition(body).then((row) => navigate(positionPath(row.id)))}
          />
        </section>
      )}

      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}

      <section className="panel" aria-labelledby="stellen-liste">
        <div className="panel-head">
          <h2 id="stellen-liste">Alle Stellen</h2>
        </div>
        <div className="detail-body settings-form">
          <label>
            Stellen durchsuchen
            <input
              type="search"
              value={query}
              maxLength={100}
              autoComplete="off"
              placeholder="Stelle, Person, Abteilung …"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {!failed && !list && <p role="status">Wird geladen …</p>}
          {list && (
            <p className="small" role="status">
              {shown.length === 0
                ? "Keine Stellen für diese Suche."
                : `${shown.length} von ${list.length} Stellen`}
            </p>
          )}
        </div>
        {shown.length > 0 && (
          <div className="table-wrap card-wrap">
            <table className="table-cards">
              <caption className="visually-hidden">Stellen im IT-Bestand</caption>
              <thead>
                <tr>
                  <th scope="col">Stelle</th>
                  <th scope="col">Besetzt durch</th>
                  <th scope="col">Abteilung</th>
                  <th scope="col">Arbeitsplätze</th>
                  <th scope="col">Hardware</th>
                  <th scope="col">Standorte</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      <Link to={positionPath(entry.id)}>{entry.name}</Link>
                      <span className="small mono tenant-part">{entry.number}</span>
                    </th>
                    <td data-label="Besetzt durch">
                      {entry.person ? (
                        entry.person.name
                      ) : (
                        <span className="pill pill-neutral">unbesetzt</span>
                      )}
                    </td>
                    <td data-label="Abteilung">{entry.department || "–"}</td>
                    <td data-label="Arbeitsplätze">{entry.workplaces}</td>
                    <td data-label="Hardware">{entry.hardware}</td>
                    <td data-label="Standorte">{entry.sites || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Overview({
  position,
  canEdit,
  onChange,
}: {
  position: Position;
  canEdit: boolean;
  onChange: (next: Position) => void;
}) {
  const [mode, setMode] = useState<"ansicht" | "bearbeiten" | "loeschen">("ansicht");
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = () => {
    setError(null);
    fetchMasterData().then(
      (result) => {
        setDepartments(result.departments);
        setMode("bearbeiten");
      },
      (problem: unknown) =>
        setError(errorText(problem, "Die Abteilungen konnten nicht geladen werden.")),
    );
  };

  return (
    <section className="panel" aria-labelledby="stelle-daten">
      <div className="panel-head">
        <h2 id="stelle-daten">Übersicht</h2>
        {canEdit && mode === "ansicht" && (
          <div className="project-actions">
            <button type="button" className="button button-secondary" onClick={edit}>
              Bearbeiten
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={position.hardware > 0}
              title={position.hardware > 0 ? "An der Stelle hängt noch Hardware" : undefined}
              onClick={() => setMode("loeschen")}
            >
              Löschen
            </button>
          </div>
        )}
      </div>
      {mode === "bearbeiten" && departments ? (
        <PositionForm
          departments={departments}
          initial={{
            name: position.name,
            department_id: position.department_id,
            person: position.person,
            note: position.note,
          }}
          submitLabel="Speichern"
          onCancel={() => setMode("ansicht")}
          onSave={(body) =>
            updatePosition(position.id, body).then((next) => {
              onChange(next);
              setMode("ansicht");
            })
          }
        />
      ) : (
        <div className="detail-body">
          {error && (
            <p role="alert" className="hint-box hint-bad">
              {error}
            </p>
          )}
          {mode === "loeschen" && (
            <div className="hint-box hint-warn confirm-box">
              <p>
                Stelle <strong>{position.name}</strong> löschen? Verknüpfungen zu Arbeitsplätzen
                entfallen. Das lässt sich nicht rückgängig machen.
              </p>
              <div className="project-actions">
                <button
                  type="button"
                  className="button button-danger"
                  autoFocus
                  onClick={() =>
                    deletePosition(position.id).then(
                      () => navigate(INVENTORY_POSITIONS_PATH),
                      (problem: unknown) => {
                        setError(errorText(problem, "Die Stelle konnte nicht gelöscht werden."));
                        setMode("ansicht");
                      },
                    )
                  }
                >
                  Ja, Stelle löschen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setMode("ansicht")}
                >
                  Nein
                </button>
              </div>
            </div>
          )}
          <dl className="facts">
            <div>
              <dt>Besetzt durch</dt>
              <dd>
                {position.person ? (
                  <>
                    {position.person.name}
                    {position.person.upn && <span className="small"> · {position.person.upn}</span>}
                  </>
                ) : (
                  "unbesetzt"
                )}
              </dd>
            </div>
            <div>
              <dt>Abteilung</dt>
              <dd>{position.department || "–"}</dd>
            </div>
            <div>
              <dt>Arbeitet an</dt>
              <dd>{position.sites || "–"}</dd>
            </div>
            <div>
              <dt>Arbeitsplätze</dt>
              <dd>{position.workplaces}</dd>
            </div>
            <div>
              <dt>Hardware</dt>
              <dd>{position.hardware} direkt an der Stelle</dd>
            </div>
            <div>
              <dt>Angelegt am</dt>
              <dd>{formatDate(position.created_at)}</dd>
            </div>
            {position.note && (
              <div>
                <dt>Notiz</dt>
                <dd>{position.note}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

/** IT-Bestand › Stellen › Stelle: Übersicht, Arbeitsplätze, Hardware, Verlauf. */
export function PositionDetailPage({
  positionId,
  tab,
  roles,
}: {
  positionId: number;
  tab: PositionTab;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [position, setPosition] = useState<Position | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPosition(positionId).then(
      (result) => active && setPosition(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Stelle konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [positionId]);

  return (
    <div className="page page-wide">
      <p className="small">
        <Link to={INVENTORY_POSITIONS_PATH}>← Alle Stellen</Link>
      </p>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !position && <p role="status">Wird geladen …</p>}
      {position && (
        <>
          <header className="page-head">
            <p className="module-label">
              Stelle{position.department ? ` · ${position.department}` : ""}
            </p>
            <h1>{position.name}</h1>
            <p className="page-sub">
              {position.person ? `Besetzt durch ${position.person.name}` : "Unbesetzt"} ·{" "}
              <span className="mono">{position.number}</span>
            </p>
            <PlaceLine kind="stelle" id={position.id} />
          </header>
          <nav className="project-tabs" aria-label="Bereiche der Stelle">
            {POSITION_TABS.map((entry) => (
              <Link
                key={entry.id}
                to={positionPath(position.id, entry.id)}
                className={entry.id === tab ? "project-tab project-tab-on" : "project-tab"}
                aria-current={entry.id === tab ? "page" : undefined}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
          {tab === "uebersicht" && (
            <Overview position={position} canEdit={canEdit} onChange={setPosition} />
          )}
          {tab === "arbeitsplaetze" && (
            <section className="panel" aria-labelledby="stelle-plaetze">
              <div className="panel-head">
                <h2 id="stelle-plaetze">Arbeitsplätze ({position.workplace_list.length})</h2>
              </div>
              <div className="detail-body">
                {position.workplace_list.length === 0 ? (
                  <p className="empty">
                    Noch kein Arbeitsplatz. Die Stelle ordnest du im Arbeitsplatz zu.
                  </p>
                ) : (
                  <ul className="link-list">
                    {position.workplace_list.map((entry) => (
                      <li key={entry.id}>
                        <Link to={workplacePath(entry.id)}>{workplaceName(entry)}</Link>
                        <span className="small">
                          {[entry.shared ? "geteilt" : "einzeln", entry.place ?? "ohne Raum"].join(
                            " · ",
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
          {tab === "hardware" && (
            <section className="panel" aria-labelledby="stelle-hardware">
              <div className="panel-head">
                <h2 id="stelle-hardware">Hardware ({position.hardware_list.length})</h2>
              </div>
              <div className="detail-body">
                <DeviceList
                  devices={position.hardware_list}
                  empty="Keine Hardware direkt an der Stelle. Ein Gerät ordnest du beim Gerät unter „Bearbeiten“ zu."
                />
                <p className="small">
                  Hardware an den Arbeitsplätzen der Stelle steht beim jeweiligen Arbeitsplatz.
                </p>
              </div>
            </section>
          )}
          {tab === "standort" && (
            <LocationPanel
              id="stelle-standort"
              kind="stelle"
              objectId={position.id}
              emptyText="Die Arbeitsplätze dieser Stelle haben noch keinen Raum."
            />
          )}
          {tab === "verlauf" && <EventPanel id="stelle-verlauf" events={position.events} />}
        </>
      )}
    </div>
  );
}
