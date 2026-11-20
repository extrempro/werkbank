import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { errorText } from "../../api";
import { navigate } from "../../router";
import { PlanView } from "./PlanView";
import {
  clampRect,
  createFloor,
  createLevel,
  createRoom,
  deleteLevel,
  deletePlan,
  deleteRoom,
  fetchFloor,
  fetchLocations,
  firstFloorId,
  INVENTORY_EDITOR_ROLE,
  locationPath,
  PLAN_TYPES,
  renameLevel,
  searchLocations,
  updateFloor,
  updateRoom,
  uploadPlan,
  type Floor,
  type Locations,
  type Room,
  type RoomRect,
} from "./api";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Zugeklappter Baum: offen ist nur der Weg zur gewählten Etage, der Rest auf Wunsch. */
function LocationTree({
  tree,
  floor,
  onPick,
}: {
  tree: Locations;
  floor: Floor | null;
  onPick: (floorId: number) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const onPath: Record<string, boolean> = floor
    ? { [`c${floor.city_id}`]: true, [`s${floor.site_id}`]: true, [`a${floor.section_id}`]: true }
    : {};
  const isOpen = (key: string) => open[key] ?? onPath[key] ?? false;
  const toggle = (key: string) => setOpen({ ...open, [key]: !isOpen(key) });

  const Toggle = ({
    id,
    name,
    count,
    level,
  }: {
    id: string;
    name: string;
    count: string;
    level: string;
  }) => (
    <button
      type="button"
      className={`lt-toggle lt-${level}`}
      aria-expanded={isOpen(id)}
      onClick={() => toggle(id)}
    >
      <span className="lt-chev" aria-hidden="true">
        {isOpen(id) ? "▾" : "▸"}
      </span>
      <span className="lt-name">{name}</span>
      <span className="lt-count">{count}</span>
    </button>
  );

  return (
    <ul className="lt-list">
      {tree.cities.map((city) => (
        <li key={city.id}>
          <Toggle
            id={`c${city.id}`}
            name={city.name}
            count={plural(city.sites.length, "Standort", "Standorte")}
            level="city"
          />
          {isOpen(`c${city.id}`) && (
            <ul className="lt-children">
              {city.sites.map((site) => (
                <li key={site.id}>
                  <Toggle
                    id={`s${site.id}`}
                    name={site.name}
                    count={plural(
                      site.sections.reduce((sum, section) => sum + section.floors.length, 0),
                      "Etage",
                      "Etagen",
                    )}
                    level="site"
                  />
                  {isOpen(`s${site.id}`) && (
                    <ul className="lt-children">
                      {site.sections.map((section) => (
                        <li key={section.id}>
                          <Toggle
                            id={`a${section.id}`}
                            name={section.name}
                            count={plural(section.floors.length, "Etage", "Etagen")}
                            level="section"
                          />
                          {isOpen(`a${section.id}`) && (
                            <ul className="lt-children">
                              {section.floors.map((entry) => (
                                <li key={entry.id}>
                                  <button
                                    type="button"
                                    className="lt-floor"
                                    aria-current={entry.id === floor?.id ? "true" : undefined}
                                    onClick={() => onPick(entry.id)}
                                  >
                                    <span className="lt-name">{entry.name}</span>
                                    <span className="lt-count">
                                      {entry.has_plan
                                        ? plural(entry.rooms.length, "Raum", "Räume")
                                        : "ohne Grundriss"}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Neue Stadt, neuer Standort, Abschnitt oder neue Etage. */
function AddLevelForm({
  tree,
  floor,
  onTree,
  onFloor,
}: {
  tree: Locations;
  floor: Floor | null;
  onTree: (next: Locations) => void;
  onFloor: (next: Floor) => void;
}) {
  const [level, setLevel] = useState<"stadt" | "standort" | "abschnitt" | "etage">(
    tree.cities.length === 0 ? "stadt" : "etage",
  );
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const parents: { id: number; label: string }[] = [];
  for (const city of tree.cities) {
    if (level === "standort") {
      parents.push({ id: city.id, label: city.name });
    }
    for (const site of city.sites) {
      if (level === "abschnitt") {
        parents.push({ id: site.id, label: `${city.name} › ${site.name}` });
      }
      for (const section of site.sections) {
        if (level === "etage") {
          parents.push({ id: section.id, label: `${site.name} › ${section.name}` });
        }
      }
    }
  }
  const preset =
    level === "etage" && floor
      ? String(floor.section_id)
      : level === "abschnitt" && floor
        ? String(floor.site_id)
        : level === "standort" && floor
          ? String(floor.city_id)
          : "";
  const parentValue = parent || preset;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    if (level !== "stadt" && !parentValue) {
      setError("Bitte wählen, wozu der Eintrag gehört.");
      return;
    }
    setError(null);
    const id = Number(parentValue);
    let done: Promise<unknown>;
    if (level === "stadt") {
      done = createLevel("cities", { name: name.trim() }).then(onTree);
    } else if (level === "standort") {
      done = createLevel("sites", { name: name.trim(), city_id: id }).then(onTree);
    } else if (level === "abschnitt") {
      done = createLevel("sections", { name: name.trim(), site_id: id }).then(onTree);
    } else {
      done = createFloor({
        name: name.trim(),
        section_id: id,
        position: Number(position) || 0,
      }).then(onFloor);
    }
    done.then(
      () => setName(""),
      (problem: unknown) => setError(errorText(problem, "Konnte nicht angelegt werden.")),
    );
  };

  return (
    <form className="settings-form form-stack" onSubmit={onSubmit} noValidate>
      <div className="tool-row">
        <label className="narrow">
          Neu anlegen
          <select
            value={level}
            onChange={(event) => {
              setLevel(event.target.value as typeof level);
              setParent("");
            }}
          >
            <option value="stadt">Stadt</option>
            <option value="standort">Standort</option>
            <option value="abschnitt">Gebäudeabschnitt</option>
            <option value="etage">Etage</option>
          </select>
        </label>
        {level !== "stadt" && (
          <label>
            Gehört zu
            <select value={parentValue} onChange={(event) => setParent(event.target.value)}>
              <option value="">Bitte wählen</option>
              {parents.map((entry) => (
                <option key={entry.id} value={String(entry.id)}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="tool-row">
        <label>
          Name
          <input
            type="text"
            value={name}
            maxLength={80}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {level === "etage" && (
          <label className="narrow">
            Reihenfolge
            <input
              type="number"
              inputMode="numeric"
              min={-20}
              max={200}
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <div className="project-actions">
        <button type="submit" className="button button-secondary">
          Anlegen
        </button>
      </div>
    </form>
  );
}

/** Umbenennen und Löschen für Stadt, Standort, Abschnitt und Etage der gewählten Etage. */
function PathEditor({
  floor,
  onTree,
  onFloor,
  onFloorGone,
}: {
  floor: Floor;
  onTree: (next: Locations) => void;
  onFloor: (next: Floor) => void;
  onFloorGone: (next: Locations) => void;
}) {
  const entries = [
    { kind: "cities" as const, id: floor.city_id, label: "Stadt", name: floor.city },
    { kind: "sites" as const, id: floor.site_id, label: "Standort", name: floor.site },
    {
      kind: "sections" as const,
      id: floor.section_id,
      label: "Gebäudeabschnitt",
      name: floor.section,
    },
    { kind: "floors" as const, id: floor.id, label: "Etage", name: floor.name },
  ];
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [position, setPosition] = useState(String(floor.position));
  const [error, setError] = useState<string | null>(null);

  const save = (event: FormEvent, entry: (typeof entries)[number]) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    const done: Promise<unknown> =
      entry.kind === "floors"
        ? updateFloor(entry.id, { name: value.trim(), position: Number(position) || 0 }).then(
            onFloor,
          )
        : renameLevel(entry.kind, entry.id, value.trim()).then((tree) => {
            onTree(tree);
            return fetchFloor(floor.id).then(onFloor);
          });
    done.then(
      () => {
        setEditing(null);
        setError(null);
      },
      (problem: unknown) => setError(errorText(problem, "Konnte nicht gespeichert werden.")),
    );
  };

  const remove = (entry: (typeof entries)[number]) => {
    deleteLevel(entry.kind, entry.id).then(
      (tree) => (entry.kind === "floors" ? onFloorGone(tree) : onTree(tree)),
      (problem: unknown) => setError(errorText(problem, "Konnte nicht gelöscht werden.")),
    );
  };

  return (
    <div className="path-editor">
      <ul className="master-list">
        {entries.map((entry) => (
          <li key={entry.kind} className="master-row">
            {editing === entry.kind ? (
              <form className="master-edit" onSubmit={(event) => save(event, entry)} noValidate>
                <label>
                  {entry.label}
                  <input
                    type="text"
                    value={value}
                    maxLength={80}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </label>
                {entry.kind === "floors" && (
                  <label className="narrow">
                    Reihenfolge
                    <input
                      type="number"
                      inputMode="numeric"
                      min={-20}
                      max={200}
                      value={position}
                      onChange={(event) => setPosition(event.target.value)}
                    />
                  </label>
                )}
                <button type="submit" className="button button-primary">
                  Speichern
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setEditing(null)}
                >
                  Abbrechen
                </button>
              </form>
            ) : (
              <>
                <span className="master-name">
                  <span className="small">{entry.label}</span>
                  <strong>{entry.name}</strong>
                </span>
                <span className="master-actions">
                  <button
                    type="button"
                    className="row-button"
                    onClick={() => {
                      setEditing(entry.kind);
                      setValue(entry.name);
                      setError(null);
                    }}
                  >
                    Umbenennen
                  </button>
                  <button type="button" className="row-button" onClick={() => remove(entry)}>
                    Löschen
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="small">
        Gelöscht werden kann nur, was leer ist: eine Etage ohne Räume, ein Abschnitt ohne Etagen und
        so weiter.
      </p>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** Raum: Name und Lage in Prozent (auch ohne Maus änderbar), Löschen. */
function RoomPanel({
  room,
  canEdit,
  onSave,
  onDelete,
}: {
  room: Room;
  canEdit: boolean;
  onSave: (name: string, rect: RoomRect) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [name, setName] = useState(room.name);
  const [rect, setRect] = useState({
    x: String(room.x),
    y: String(room.y),
    w: String(room.w),
    h: String(room.h),
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    const numbers = {
      x: Number(rect.x.replace(",", ".")),
      y: Number(rect.y.replace(",", ".")),
      w: Number(rect.w.replace(",", ".")),
      h: Number(rect.h.replace(",", ".")),
    };
    if (Object.values(numbers).some((value) => !Number.isFinite(value))) {
      setError("Bitte Zahlen für die Lage eintragen.");
      return;
    }
    setError(null);
    onSave(name.trim(), clampRect(numbers)).catch((problem: unknown) =>
      setError(errorText(problem, "Der Raum konnte nicht gespeichert werden.")),
    );
  };

  return (
    <section className="panel" aria-labelledby="raum-titel">
      <div className="panel-head">
        <h2 id="raum-titel">Raum {room.name}</h2>
        <span className="small">
          {room.hardware === 0 ? "keine Hardware" : plural(room.hardware, "Gerät", "Geräte")}
        </span>
      </div>
      {canEdit ? (
        <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
          <label>
            Name
            <input
              type="text"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <fieldset className="room-rect">
            <legend>Lage in Prozent des Grundrisses</legend>
            {(
              [
                ["x", "Von links"],
                ["y", "Von oben"],
                ["w", "Breite"],
                ["h", "Höhe"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="narrow">
                {label}
                <input
                  type="text"
                  inputMode="decimal"
                  value={rect[key]}
                  onChange={(event) => setRect({ ...rect, [key]: event.target.value })}
                />
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="hint-box hint-bad">
              {error}
            </p>
          )}
          <div className="project-actions">
            <button type="submit" className="button button-primary">
              Raum speichern
            </button>
            {confirming ? (
              <>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() =>
                    onDelete().catch((problem: unknown) => {
                      setError(errorText(problem, "Der Raum konnte nicht gelöscht werden."));
                      setConfirming(false);
                    })
                  }
                >
                  Ja, Raum löschen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setConfirming(false)}
                >
                  Nein
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-secondary"
                disabled={room.hardware > 0}
                title={room.hardware > 0 ? "Im Raum steht noch Hardware" : undefined}
                onClick={() => setConfirming(true)}
              >
                Raum löschen
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="detail-body small">
          Lage: {room.x} % von links, {room.y} % von oben, {room.w} × {room.h} %.
        </p>
      )}
    </section>
  );
}

/** Name für einen neu aufgezogenen Raum. */
function NewRoomForm({
  onSave,
  onCancel,
}: {
  onSave: (name: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen für den Raum eintragen.");
      return;
    }
    onSave(name.trim()).catch((problem: unknown) =>
      setError(errorText(problem, "Der Raum konnte nicht angelegt werden.")),
    );
  };
  return (
    <form className="hint-box confirm-box settings-form form-stack" onSubmit={onSubmit} noValidate>
      <label>
        Name des neuen Raums
        <input
          type="text"
          value={name}
          maxLength={80}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <div className="project-actions">
        <button type="submit" className="button button-primary">
          Raum anlegen
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Verwerfen
        </button>
      </div>
    </form>
  );
}

/** IT-Bestand › Standorte: Baum, Grundriss mit Räumen, Pflege der Struktur. */
export function LocationsPage({
  floorId,
  roomId,
  roles,
}: {
  floorId: number | null;
  roomId: number | null;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [tree, setTree] = useState<Locations | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RoomRect | null>(null);
  const [mobileTree, setMobileTree] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetchLocations().then(
      (result) => {
        if (!active) {
          return;
        }
        setTree(result);
        if (floorId === null) {
          const first = firstFloorId(result);
          if (first !== null) {
            navigate(locationPath(first));
          }
        }
      },
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Standorte konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [floorId]);

  useEffect(() => {
    if (floorId === null) {
      return;
    }
    let active = true;
    fetchFloor(floorId).then(
      (result) => active && setFloor(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Etage konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [floorId]);

  const shownFloor = floor && floor.id === floorId ? floor : null;
  const room = shownFloor?.rooms.find((entry) => entry.id === roomId) ?? null;
  const hits = tree ? searchLocations(tree, query) : [];

  const refreshTree = () => fetchLocations().then(setTree);
  const pick = (id: number, nextRoom: number | null = null) => {
    setQuery("");
    setMobileTree(false);
    setDraft(null);
    navigate(locationPath(id, nextRoom));
  };
  const applyFloor = (next: Floor) => {
    setFloor(next);
    void refreshTree();
    if (next.id !== floorId) {
      navigate(locationPath(next.id));
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !shownFloor) {
      return;
    }
    if (!PLAN_TYPES.includes(file.type)) {
      setNotice("Erlaubt sind nur PNG-, JPEG- und WebP-Dateien.");
      return;
    }
    setNotice(null);
    uploadPlan(shownFloor.id, file).then(applyFloor, (problem: unknown) =>
      setNotice(errorText(problem, "Der Grundriss konnte nicht hochgeladen werden.")),
    );
  };

  const moveRoom = (target: Room, rect: RoomRect) =>
    updateRoom(target.id, { name: target.name, ...clampRect(rect) }).then(applyFloor, (problem) =>
      setNotice(errorText(problem, "Der Raum konnte nicht verschoben werden.")),
    );

  if (failed) {
    return (
      <div className="page page-wide">
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">IT-Bestand</p>
        <h1>Standorte</h1>
        <p className="page-sub">
          Städte, Standorte, Gebäudeabschnitte und Etagen mit Grundriss und Räumen.
        </p>
      </header>
      {!tree && <p role="status">Wird geladen …</p>}
      {tree && tree.cities.length === 0 && (
        <section className="panel" aria-labelledby="standorte-leer">
          <div className="panel-head">
            <h2 id="standorte-leer">Noch keine Standorte</h2>
          </div>
          <div className="detail-body">
            {canEdit ? (
              <AddLevelForm tree={tree} floor={null} onTree={setTree} onFloor={applyFloor} />
            ) : (
              <p>Es sind noch keine Standorte angelegt.</p>
            )}
          </div>
        </section>
      )}
      {tree && tree.cities.length > 0 && (
        <div className="loc-wrap">
          <div className="loc-layout">
            {shownFloor && (
              <div className="loc-mobilebar panel">
                <span>
                  <span className="small loc-mobile-path">
                    {shownFloor.city} › {shownFloor.site} › {shownFloor.section}
                  </span>
                  <strong>{shownFloor.name}</strong>
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-expanded={mobileTree}
                  onClick={() => setMobileTree(!mobileTree)}
                >
                  {mobileTree ? "Schließen" : "Etage wechseln"}
                </button>
              </div>
            )}
            <nav
              className={
                mobileTree || !shownFloor ? "panel loc-tree loc-tree-open" : "panel loc-tree"
              }
              aria-label="Standorte"
            >
              <div className="loc-search">
                <label htmlFor="standort-suche" className="visually-hidden">
                  Raum, Etage oder Standort suchen
                </label>
                <input
                  id="standort-suche"
                  type="search"
                  value={query}
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Raum, Etage, Standort suchen"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query.trim() && (
                  <ul className="loc-hits" aria-label="Treffer">
                    {hits.length === 0 && <li className="small">Nichts gefunden.</li>}
                    {hits.map((hit) => (
                      <li key={`${hit.kind}-${hit.floorId}-${hit.roomId ?? hit.name}`}>
                        <button
                          type="button"
                          className="loc-hit"
                          onClick={() => pick(hit.floorId, hit.roomId)}
                        >
                          <strong>{hit.name}</strong>
                          <span className="small">
                            {hit.kind}
                            {hit.path ? ` · ${hit.path}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <LocationTree tree={tree} floor={shownFloor} onPick={(id) => pick(id)} />
            </nav>

            <div className="loc-main">
              {!shownFloor && floorId !== null && <p role="status">Wird geladen …</p>}
              {!shownFloor && floorId === null && (
                <p className="panel panel-empty">
                  Noch keine Etage angelegt.
                  {canEdit ? " Lege unten unter „Neu anlegen“ eine an." : ""}
                </p>
              )}
              {shownFloor && (
                <section className="panel" aria-labelledby="etage-titel">
                  <div className="panel-head">
                    <div>
                      <p className="small loc-path">
                        {shownFloor.city} › {shownFloor.site} › {shownFloor.section}
                      </p>
                      <h2 id="etage-titel">{shownFloor.name}</h2>
                    </div>
                    {canEdit && (
                      <div className="project-actions">
                        <input
                          ref={fileInput}
                          type="file"
                          accept={PLAN_TYPES.join(",")}
                          className="visually-hidden"
                          tabIndex={-1}
                          aria-hidden="true"
                          onChange={onFile}
                        />
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => fileInput.current?.click()}
                        >
                          {shownFloor.plan ? "Grundriss ersetzen" : "Grundriss hochladen"}
                        </button>
                        {shownFloor.plan && (
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() =>
                              deletePlan(shownFloor.id).then(applyFloor, (problem: unknown) =>
                                setNotice(
                                  errorText(problem, "Der Grundriss konnte nicht entfernt werden."),
                                ),
                              )
                            }
                          >
                            Grundriss entfernen
                          </button>
                        )}
                        <button
                          type="button"
                          className={editing ? "button button-primary" : "button button-secondary"}
                          aria-pressed={editing}
                          onClick={() => {
                            setEditing(!editing);
                            setDraft(null);
                          }}
                        >
                          {editing ? "Fertig" : "Räume bearbeiten"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="detail-body">
                    {notice && (
                      <p role="alert" className="hint-box hint-bad">
                        {notice}
                      </p>
                    )}
                    {editing && (
                      <p className="hint-box">
                        Auf freier Fläche ein Rechteck aufziehen legt einen Raum an. Räume ziehen
                        verschiebt sie, der Griff unten rechts ändert die Größe. Ohne Maus: Raum
                        wählen und die Lage in Prozent eintragen.
                      </p>
                    )}
                    {draft && (
                      <NewRoomForm
                        onCancel={() => setDraft(null)}
                        onSave={(name) =>
                          createRoom(shownFloor.id, { name, ...draft }).then((next) => {
                            setDraft(null);
                            applyFloor(next);
                          })
                        }
                      />
                    )}
                    <div className="plan-with-list">
                      <div className="plan-main">
                        <PlanView
                          floor={shownFloor}
                          selectedId={room?.id ?? null}
                          editing={editing}
                          label={`Grundriss ${shownFloor.name}`}
                          onSelect={(entry) =>
                            navigate(
                              locationPath(shownFloor.id, entry.id === room?.id ? null : entry.id),
                            )
                          }
                          onDraw={(rect) => setDraft(rect)}
                          onMove={(entry, rect) => void moveRoom(entry, rect)}
                        />
                      </div>
                      {shownFloor.rooms.length > 0 && (
                        <div className="room-list" role="group" aria-label="Räume dieser Etage">
                          <p className="small room-list-head">
                            {plural(shownFloor.rooms.length, "Raum", "Räume")}
                          </p>
                          {shownFloor.rooms.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              aria-pressed={entry.id === room?.id}
                              onClick={() =>
                                navigate(
                                  locationPath(
                                    shownFloor.id,
                                    entry.id === room?.id ? null : entry.id,
                                  ),
                                )
                              }
                            >
                              <span className="lt-name">{entry.name}</span>
                              <span className="lt-count">
                                {entry.hardware === 0
                                  ? "–"
                                  : plural(entry.hardware, "Gerät", "Geräte")}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
              {shownFloor && room && (
                <RoomPanel
                  key={`${room.id}-${room.x}-${room.y}-${room.w}-${room.h}-${room.name}`}
                  room={room}
                  canEdit={canEdit}
                  onSave={(name, rect) => updateRoom(room.id, { name, ...rect }).then(applyFloor)}
                  onDelete={() =>
                    deleteRoom(room.id).then((next) => {
                      applyFloor(next);
                      navigate(locationPath(next.id));
                    })
                  }
                />
              )}
              {canEdit && (
                <section className="panel" aria-labelledby="struktur-titel">
                  <div className="panel-head">
                    <h2 id="struktur-titel">Standorte pflegen</h2>
                  </div>
                  <div className="detail-body">
                    <AddLevelForm
                      tree={tree}
                      floor={shownFloor}
                      onTree={setTree}
                      onFloor={applyFloor}
                    />
                    {shownFloor && (
                      <PathEditor
                        floor={shownFloor}
                        onTree={setTree}
                        onFloor={applyFloor}
                        onFloorGone={(next) => {
                          setTree(next);
                          const first = firstFloorId(next);
                          navigate(first === null ? "/bestand/standorte" : locationPath(first));
                        }}
                      />
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
