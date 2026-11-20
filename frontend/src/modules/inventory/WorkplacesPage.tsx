import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { INVENTORY_MASTER_PATH, INVENTORY_WORKPLACES_PATH } from "../../navigation";
import { navigate } from "../../router";
import { DeviceList, EventPanel, RoomPlanPanel } from "./parts";
import {
  createWorkplace,
  deleteWorkplace,
  equipmentLabel,
  fetchAssignees,
  fetchLocations,
  fetchMasterData,
  fetchWorkplace,
  fetchWorkplaces,
  filterWorkplaces,
  INVENTORY_EDITOR_ROLE,
  positionPath,
  roomChoices,
  updateWorkplace,
  WORKPLACE_FILTERS,
  WORKPLACE_TABS,
  workplaceInput,
  workplaceName,
  workplacePath,
  type Assignees,
  type Kit,
  type Locations,
  type Workplace,
  type WorkplaceFilter,
  type WorkplaceInput,
  type WorkplaceSummary,
  type WorkplaceTab,
} from "./api";

interface Choices {
  assignees: Assignees;
  locations: Locations;
  kits: Kit[];
}

function loadChoices(): Promise<Choices> {
  return Promise.all([fetchAssignees(), fetchLocations(), fetchMasterData()]).then(
    ([assignees, locations, master]) => ({ assignees, locations, kits: master.kits }),
  );
}

function equipmentPill(entry: Pick<WorkplaceSummary, "complete" | "missing">) {
  const cls = entry.complete === null ? "pill-neutral" : entry.complete ? "pill-ok" : "pill-todo";
  return <span className={`pill ${cls}`}>{equipmentLabel(entry)}</span>;
}

/** Formular für einen Arbeitsplatz; beim Anlegen und Bearbeiten gleich. */
function WorkplaceForm({
  choices,
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  choices: Choices;
  initial: WorkplaceInput;
  submitLabel: string;
  onSave: (body: WorkplaceInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [roomId, setRoomId] = useState(initial.room_id === null ? "" : String(initial.room_id));
  const [shared, setShared] = useState(initial.shared);
  const [kitId, setKitId] = useState(initial.kit_id === null ? "" : String(initial.kit_id));
  const [positionIds, setPositionIds] = useState<number[]>(initial.position_ids);
  const [adding, setAdding] = useState("");
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = roomChoices(choices.locations);
  const byId = new Map(choices.assignees.positions.map((entry) => [entry.id, entry]));
  const free = choices.assignees.positions.filter((entry) => !positionIds.includes(entry.id));
  const tooMany = !shared && positionIds.length > 1;
  const canAdd = shared || positionIds.length === 0;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (tooMany) {
      setError("Ein Einzelarbeitsplatz gehört zu höchstens einer Stelle.");
      return;
    }
    setBusy(true);
    setError(null);
    onSave({
      name: name.trim(),
      room_id: roomId ? Number(roomId) : null,
      shared,
      kit_id: kitId ? Number(kitId) : null,
      position_ids: positionIds,
      note: note.trim(),
    }).catch((problem: unknown) => {
      setError(errorText(problem, "Der Arbeitsplatz konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  return (
    <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
      <div className="tool-row">
        <label>
          Bezeichnung (freiwillig)
          <input
            type="text"
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder="z. B. Fensterplatz"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Raum (freiwillig)
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            <option value="">kein Raum</option>
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.rooms.map((room) => (
                  <option key={room.id} value={String(room.id)}>
                    {room.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="seg-field">
        <legend>Typ</legend>
        <div className="chips">
          {[
            { value: false, label: "Einzelarbeitsplatz" },
            { value: true, label: "Geteilter Arbeitsplatz" },
          ].map((entry) => (
            <button
              key={entry.label}
              type="button"
              className="chip chip-filter"
              aria-pressed={shared === entry.value}
              onClick={() => setShared(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="small">
          Ein Einzelarbeitsplatz gehört zu genau einer Stelle, ein geteilter zu mehreren.
        </p>
      </fieldset>
      <label>
        Ausstattung (Vorlage, freiwillig)
        <select value={kitId} onChange={(event) => setKitId(event.target.value)}>
          <option value="">keine Vorlage</option>
          {choices.kits.map((kit) => (
            <option key={kit.id} value={String(kit.id)}>
              {kit.name}
            </option>
          ))}
        </select>
      </label>
      {choices.kits.length === 0 && (
        <p className="small">
          Vorlagen legst du unter <Link to={INVENTORY_MASTER_PATH}>Stammdaten</Link> an.
        </p>
      )}
      <fieldset className="seg-field">
        <legend>Stellen ({positionIds.length})</legend>
        {positionIds.length === 0 ? (
          <p className="small">Frei, keine Stelle zugeordnet.</p>
        ) : (
          <ul className="master-list">
            {positionIds.map((id) => {
              const entry = byId.get(id);
              const label = entry ? `${entry.number} ${entry.name}` : `Stelle ${id}`;
              return (
                <li key={id} className="master-row">
                  <span className="master-name">
                    <strong>{label}</strong>
                    <span className="small">{entry?.person_name || "unbesetzt"}</span>
                  </span>
                  <span className="master-actions">
                    <button
                      type="button"
                      className="row-button"
                      aria-label={`${label} entfernen`}
                      onClick={() => setPositionIds(positionIds.filter((value) => value !== id))}
                    >
                      Entfernen
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {tooMany && (
          <p role="alert" className="hint-box hint-warn">
            Ein Einzelarbeitsplatz darf nur zu einer Stelle gehören. Entferne die übrigen Stellen
            oder wähle „Geteilter Arbeitsplatz“.
          </p>
        )}
        {canAdd && free.length > 0 && (
          <div className="tool-row">
            <label>
              Stelle hinzufügen
              <select value={adding} onChange={(event) => setAdding(event.target.value)}>
                <option value="">Bitte wählen</option>
                {free.map((entry) => (
                  <option key={entry.id} value={String(entry.id)}>
                    {entry.number} {entry.name}
                    {entry.person_name ? ` (${entry.person_name})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={!adding}
              onClick={() => {
                setPositionIds([...positionIds, Number(adding)]);
                setAdding("");
              }}
            >
              Hinzufügen
            </button>
          </div>
        )}
      </fieldset>
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

const EMPTY_WORKPLACE: WorkplaceInput = {
  name: "",
  room_id: null,
  shared: false,
  kit_id: null,
  position_ids: [],
  note: "",
};

/** IT-Bestand › Arbeitsplätze: Liste mit Filtern, neuer Arbeitsplatz. */
export function WorkplacesPage({ roles }: { roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [list, setList] = useState<WorkplaceSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkplaceFilter>("alle");
  const [choices, setChoices] = useState<Choices | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchWorkplaces().then(
      (result) => active && setList(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Arbeitsplätze konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const startCreate = () => {
    setNotice(null);
    loadChoices().then(setChoices, (problem: unknown) =>
      setNotice(errorText(problem, "Die Auswahllisten konnten nicht geladen werden.")),
    );
  };

  const shown = list ? filterWorkplaces(list, filter) : [];

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Arbeitsplätze</h1>
          <p className="page-sub">
            Ein Einzelarbeitsplatz gehört zu genau einer Stelle, ein geteilter Arbeitsplatz zu
            mehreren.
          </p>
        </div>
        {canEdit && !choices && (
          <button type="button" className="button button-primary" onClick={startCreate}>
            Arbeitsplatz anlegen
          </button>
        )}
      </header>
      {notice && (
        <p role="alert" className="hint-box hint-bad">
          {notice}
        </p>
      )}
      {canEdit && choices && (
        <section className="panel" aria-labelledby="platz-neu">
          <div className="panel-head">
            <h2 id="platz-neu">Arbeitsplatz anlegen</h2>
          </div>
          <p className="small panel-note">
            Die Nummer vergibt die Werkbank fortlaufend (Präfix unter Stammdaten › Nummernkreise).
          </p>
          <WorkplaceForm
            choices={choices}
            initial={EMPTY_WORKPLACE}
            submitLabel="Arbeitsplatz anlegen"
            onCancel={() => setChoices(null)}
            onSave={(body) => createWorkplace(body).then((row) => navigate(workplacePath(row.id)))}
          />
        </section>
      )}
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      <section className="panel" aria-labelledby="plaetze-liste">
        <div className="panel-head">
          <h2 id="plaetze-liste">Alle Arbeitsplätze</h2>
          <div className="chips" role="group" aria-label="Filter">
            {WORKPLACE_FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="chip chip-filter"
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div className="detail-body">
          {!failed && !list && <p role="status">Wird geladen …</p>}
          {list && (
            <p className="small" role="status">
              {shown.length === 0
                ? "Keine Arbeitsplätze mit diesem Filter."
                : `${shown.length} von ${list.length} Arbeitsplätzen`}
            </p>
          )}
        </div>
        {shown.length > 0 && (
          <div className="table-wrap card-wrap">
            <table className="table-cards">
              <caption className="visually-hidden">Arbeitsplätze im IT-Bestand</caption>
              <thead>
                <tr>
                  <th scope="col">Arbeitsplatz</th>
                  <th scope="col">Typ</th>
                  <th scope="col">Ort</th>
                  <th scope="col">Stellen</th>
                  <th scope="col">Ausstattung</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      <Link to={workplacePath(entry.id)}>{workplaceName(entry)}</Link>
                    </th>
                    <td data-label="Typ">{entry.shared ? "geteilt" : "einzeln"}</td>
                    <td data-label="Ort">{entry.place ?? "–"}</td>
                    <td data-label="Stellen">
                      {entry.positions.length === 0
                        ? "frei"
                        : entry.positions
                            .map((position) => position.person_name || position.name)
                            .join(", ")}
                    </td>
                    <td data-label="Ausstattung">{equipmentPill(entry)}</td>
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
  workplace,
  canEdit,
  onChange,
}: {
  workplace: Workplace;
  canEdit: boolean;
  onChange: (next: Workplace) => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasHardware = workplace.hardware_list.length > 0;

  const edit = () => {
    setError(null);
    loadChoices().then(setChoices, (problem: unknown) =>
      setError(errorText(problem, "Die Auswahllisten konnten nicht geladen werden.")),
    );
  };

  return (
    <section className="panel" aria-labelledby="platz-daten">
      <div className="panel-head">
        <h2 id="platz-daten">Übersicht</h2>
        {canEdit && !choices && !confirming && (
          <div className="project-actions">
            <button type="button" className="button button-secondary" onClick={edit}>
              Bearbeiten
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={hasHardware}
              title={hasHardware ? "Am Arbeitsplatz hängt noch Hardware" : undefined}
              onClick={() => setConfirming(true)}
            >
              Löschen
            </button>
          </div>
        )}
      </div>
      {choices ? (
        <WorkplaceForm
          choices={choices}
          initial={workplaceInput(workplace)}
          submitLabel="Speichern"
          onCancel={() => setChoices(null)}
          onSave={(body) =>
            updateWorkplace(workplace.id, body).then((next) => {
              onChange(next);
              setChoices(null);
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
          {confirming && (
            <div className="hint-box hint-warn confirm-box">
              <p>
                Arbeitsplatz <strong>{workplaceName(workplace)}</strong> löschen? Das lässt sich
                nicht rückgängig machen.
              </p>
              <div className="project-actions">
                <button
                  type="button"
                  className="button button-danger"
                  autoFocus
                  onClick={() =>
                    deleteWorkplace(workplace.id).then(
                      () => navigate(INVENTORY_WORKPLACES_PATH),
                      (problem: unknown) => {
                        setError(
                          errorText(problem, "Der Arbeitsplatz konnte nicht gelöscht werden."),
                        );
                        setConfirming(false);
                      },
                    )
                  }
                >
                  Ja, Arbeitsplatz löschen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setConfirming(false)}
                >
                  Nein
                </button>
              </div>
            </div>
          )}
          <dl className="facts">
            <div>
              <dt>Typ</dt>
              <dd>{workplace.shared ? "Geteilter Arbeitsplatz" : "Einzelarbeitsplatz"}</dd>
            </div>
            <div>
              <dt>Ort</dt>
              <dd>{workplace.place ?? "–"}</dd>
            </div>
            <div>
              <dt>Ausstattung</dt>
              <dd>
                {workplace.kit ?? "keine Vorlage"} {equipmentPill(workplace)}
              </dd>
            </div>
            {workplace.note && (
              <div>
                <dt>Notiz</dt>
                <dd>{workplace.note}</dd>
              </div>
            )}
          </dl>
          <h3 className="sub-head">Stellen ({workplace.positions.length})</h3>
          {workplace.positions.length === 0 ? (
            <p className="empty">Frei, keine Stelle zugeordnet.</p>
          ) : (
            <ul className="link-list">
              {workplace.positions.map((entry) => (
                <li key={entry.id}>
                  <Link to={positionPath(entry.id)}>
                    {entry.number} {entry.name}
                  </Link>
                  <span className="small">{entry.person_name || "unbesetzt"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function EquipmentPanel({ workplace }: { workplace: Workplace }) {
  const check = workplace.equipment;
  return (
    <section className="panel" aria-labelledby="platz-ausstattung">
      <div className="panel-head">
        <h2 id="platz-ausstattung">Ausstattung</h2>
        {check && <span className="small">Vorlage {check.kit}</span>}
      </div>
      <div className="detail-body">
        {!check ? (
          <p className="empty">
            Keine Vorlage gewählt. Vorlagen pflegst du unter Stammdaten › Ausstattung; wählen kannst
            du sie in der Übersicht unter „Bearbeiten“.
          </p>
        ) : (
          <>
            <p className={check.complete ? "hint-box" : "hint-box hint-warn"}>
              {check.complete
                ? "Alles da, was die Vorlage verlangt."
                : `Es fehlt noch etwas: ${equipmentLabel(check)}.`}
            </p>
            <ul className="equip-list">
              {check.rows.map((row, index) => {
                const ok = row.have >= row.need;
                return (
                  <li key={`${row.label}-${index}`}>
                    <span className={ok ? "pill pill-ok" : "pill pill-todo"}>
                      {row.have} von {row.need}
                    </span>
                    <span>
                      <strong>{row.label}</strong>
                      <span className="small">
                        {" "}
                        · passend: {row.kinds.join(", ")}
                        {row.devices.length > 0 ? ` · vorhanden: ${row.devices.join(", ")}` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="small">
              Gezählt wird Hardware am Arbeitsplatz und Hardware der Stellen, die ihn nutzen. Jedes
              Gerät zählt nur einmal.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** IT-Bestand › Arbeitsplätze › Arbeitsplatz. */
export function WorkplaceDetailPage({
  workplaceId,
  tab,
  roles,
}: {
  workplaceId: number;
  tab: WorkplaceTab;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchWorkplace(workplaceId).then(
      (result) => active && setWorkplace(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Der Arbeitsplatz konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [workplaceId]);

  return (
    <div className="page page-wide">
      <p className="small">
        <Link to={INVENTORY_WORKPLACES_PATH}>← Alle Arbeitsplätze</Link>
      </p>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !workplace && <p role="status">Wird geladen …</p>}
      {workplace && (
        <>
          <header className="page-head">
            <p className="module-label">Arbeitsplatz</p>
            <h1>{workplaceName(workplace)}</h1>
            <p className="page-sub">
              {workplace.shared ? "Geteilt" : "Einzeln"} · {workplace.place ?? "ohne Raum"}{" "}
              {equipmentPill(workplace)}
            </p>
          </header>
          <nav className="project-tabs" aria-label="Bereiche des Arbeitsplatzes">
            {WORKPLACE_TABS.map((entry) => (
              <Link
                key={entry.id}
                to={workplacePath(workplace.id, entry.id)}
                className={entry.id === tab ? "project-tab project-tab-on" : "project-tab"}
                aria-current={entry.id === tab ? "page" : undefined}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
          {tab === "uebersicht" && (
            <Overview workplace={workplace} canEdit={canEdit} onChange={setWorkplace} />
          )}
          {tab === "ausstattung" && <EquipmentPanel workplace={workplace} />}
          {tab === "hardware" && (
            <section className="panel" aria-labelledby="platz-hardware">
              <div className="panel-head">
                <h2 id="platz-hardware">
                  Hardware am Arbeitsplatz ({workplace.hardware_list.length})
                </h2>
              </div>
              <div className="detail-body">
                <DeviceList
                  devices={workplace.hardware_list}
                  empty="Keine Hardware direkt am Arbeitsplatz. Ein Gerät ordnest du beim Gerät unter „Bearbeiten“ zu."
                />
              </div>
            </section>
          )}
          {tab === "standort" && (
            <RoomPlanPanel
              id="platz-standort"
              location={workplace.location}
              emptyText="Diesem Arbeitsplatz ist kein Raum zugeordnet."
            />
          )}
          {tab === "verlauf" && <EventPanel id="platz-verlauf" events={workplace.events} />}
        </>
      )}
    </div>
  );
}
