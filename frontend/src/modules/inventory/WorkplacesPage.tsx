import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { INVENTORY_MASTER_PATH, INVENTORY_WORKPLACES_PATH } from "../../navigation";
import { navigate } from "../../router";
import { DeviceList, EventPanel } from "./parts";
import { LookupPicker } from "./LookupPicker";
import { PlanView, planSpots } from "./PlanView";
import { LocationPanel, PlaceLine } from "./PlaceInfo";
import {
  createWorkplace,
  deleteWorkplace,
  equipmentLabel,
  fetchAssignees,
  fetchFloor,
  fetchLocations,
  fetchMasterData,
  fetchWorkplace,
  fetchWorkplaces,
  filterWorkplaces,
  INVENTORY_EDITOR_ROLE,
  positionPath,
  roomItem,
  spotInRoom,
  updateWorkplace,
  WORKPLACE_FILTERS,
  WORKPLACE_TABS,
  workplaceInput,
  workplaceName,
  workplacePath,
  type Assignees,
  type Floor,
  type Kit,
  type LookupItem,
  type Locations,
  type Workplace,
  type WorkplaceFilter,
  type WorkplaceInput,
  type WorkplaceNew,
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
/** Grundriss der Etage beim Anlegen: Ein Klick in den gewählten Raum setzt den Platz (freiwillig). */
function SpotPicker({
  room,
  spot,
  onSpot,
}: {
  room: LookupItem;
  spot: { x: number; y: number } | null;
  onSpot: (spot: { x: number; y: number } | null) => void;
}) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const floorId = room.floor_id ?? null;

  useEffect(() => {
    if (floorId === null) {
      return;
    }
    let active = true;
    fetchFloor(floorId).then(
      (result) => active && setFloor(result),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Der Grundriss konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [floorId]);

  const shown = floor && floor.id === floorId ? floor : null;
  const target = shown?.rooms.find((entry) => entry.id === room.id) ?? null;
  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!shown) {
    return floorId === null ? null : <p role="status">Grundriss wird geladen …</p>;
  }
  if (!shown.plan || !target) {
    return (
      <p className="small">
        Für diese Etage gibt es keinen Grundriss. Den Platz kannst du später setzen.
      </p>
    );
  }
  // Der neue Platz als hervorgehobener Punkt; Prozent des Raums → Prozent der Etage
  const preview = spot
    ? [
        {
          id: -1,
          x: target.x + (spot.x / 100) * target.w,
          y: target.y + (spot.y / 100) * target.h,
          label: "Neuer Arbeitsplatz",
          on: true,
        },
      ]
    : [];
  return (
    <div className="spot-picker">
      <p className="small" role="status">
        {spot
          ? `Platz in ${room.label} gesetzt. Ein weiterer Klick verschiebt ihn.`
          : `Freiwillig: Klick im Grundriss auf die Stelle in ${room.label}, an der der Arbeitsplatz steht.`}
      </p>
      <PlanView
        floor={shown}
        selectedId={target.id}
        spots={[...planSpots(shown).map((entry) => ({ ...entry, on: false })), ...preview]}
        placing
        label={`Grundriss ${shown.name} mit ${room.label}`}
        onPlace={(point) => {
          const inside = spotInRoom(point, target);
          if (!inside) {
            setHint(`Bitte innerhalb von ${room.label} klicken.`);
            return;
          }
          setHint(null);
          onSpot(inside);
        }}
      />
      {hint && (
        <p role="alert" className="hint-box hint-warn">
          {hint}
        </p>
      )}
      {spot && (
        <button type="button" className="button button-secondary" onClick={() => onSpot(null)}>
          Platz entfernen
        </button>
      )}
    </div>
  );
}

function WorkplaceForm({
  choices,
  initial,
  submitLabel,
  creating = false,
  onSave,
  onCancel,
}: {
  choices: Choices;
  initial: WorkplaceInput;
  submitLabel: string;
  /** Neu anlegen: Raum ist Pflicht, Platz im Grundriss wählbar */
  creating?: boolean;
  onSave: (body: WorkplaceNew) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [room, setRoom] = useState<LookupItem | null>(() =>
    roomItem(choices.locations, initial.room_id),
  );
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [shared, setShared] = useState(initial.shared);
  const [kitId, setKitId] = useState(initial.kit_id === null ? "" : String(initial.kit_id));
  const [positionIds, setPositionIds] = useState<number[]>(initial.position_ids);
  // Namen der Stellen, die über die Suche dazukommen
  const [picked, setPicked] = useState<Record<number, LookupItem>>({});
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = new Map(choices.assignees.positions.map((entry) => [entry.id, entry]));
  const tooMany = !shared && positionIds.length > 1;
  const canAdd = shared || positionIds.length === 0;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (creating && !room) {
      setRoomError("Bitte wähle einen Raum.");
      return;
    }
    if (tooMany) {
      setError("Ein Einzelarbeitsplatz gehört zu höchstens einer Stelle.");
      return;
    }
    setBusy(true);
    setError(null);
    onSave({
      room_id: room ? room.id : null,
      shared,
      kit_id: kitId ? Number(kitId) : null,
      position_ids: positionIds,
      note: note.trim(),
      ...(creating && spot ? { spot_x: spot.x, spot_y: spot.y } : {}),
    }).catch((problem: unknown) => {
      setError(errorText(problem, "Der Arbeitsplatz konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  return (
    <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
      <LookupPicker
        kind="room"
        label={creating ? "Raum" : "Raum (freiwillig)"}
        required={creating}
        placeholder="Raum, Etage oder Standort …"
        value={room}
        error={roomError}
        onChange={(next) => {
          setRoom(next);
          setSpot(null);
          setRoomError(null);
        }}
      />
      {creating && room && <SpotPicker room={room} spot={spot} onSpot={setSpot} />}
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
              const chosen = picked[id];
              const label = entry
                ? `${entry.number} ${entry.name}`
                : (chosen?.label ?? `Stelle ${id}`);
              return (
                <li key={id} className="master-row">
                  <span className="master-name">
                    <strong>{label}</strong>
                    <span className="small">
                      {entry ? entry.person_name || "unbesetzt" : (chosen?.detail ?? "")}
                    </span>
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
        {canAdd && (
          <LookupPicker
            kind="position"
            label="Stelle hinzufügen"
            placeholder="Nummer, Stelle, Person oder Abteilung …"
            value={null}
            exclude={positionIds}
            onChange={(item) => {
              if (item) {
                setPicked({ ...picked, [item.id]: item });
                setPositionIds([...positionIds, item.id]);
              }
            }}
          />
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
            creating
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
              {workplace.shared ? "Geteilt" : "Einzeln"} {equipmentPill(workplace)}
            </p>
            <PlaceLine
              kind="arbeitsplatz"
              id={workplace.id}
              reload={(workplace.room_id ?? 0) * 1000 + (workplace.spot_x ?? -1)}
            />
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
            <LocationPanel
              id="platz-standort"
              kind="arbeitsplatz"
              objectId={workplace.id}
              emptyText="Diesem Arbeitsplatz ist kein Raum zugeordnet. Den Raum wählst du unter „Übersicht“ bei „Bearbeiten“."
              workplace={workplace}
              canEdit={canEdit}
              onWorkplaceChange={setWorkplace}
            />
          )}
          {tab === "verlauf" && <EventPanel id="platz-verlauf" events={workplace.events} />}
        </>
      )}
    </div>
  );
}
