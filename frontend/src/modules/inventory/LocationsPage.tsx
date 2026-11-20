import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { errorText } from "../../api";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { navigate } from "../../router";
import { planSpots, PlanView } from "./PlanView";
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
  levelPath,
  locationPath,
  PLAN_TYPES,
  renameLevel,
  searchLocations,
  updateFloor,
  updateRoom,
  uploadPlan,
  workplacePath,
  type Floor,
  type FloorSpot,
  type LocationLevel,
  type Locations,
  type Room,
  type RoomRect,
} from "./api";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Baum ein- oder ausgeblendet (in diesem Browser gemerkt). */
const TREE_KEY = "werkbank-standortbaum";

function readTreeHidden(): boolean {
  try {
    return window.localStorage.getItem(TREE_KEY) === "aus";
  } catch {
    return false;
  }
}

function saveTreeHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(TREE_KEY, hidden ? "aus" : "an");
  } catch {
    // Speicher gesperrt: gilt nur bis zum Neuladen
  }
}

type LevelApi = "cities" | "sites" | "sections";

const LEVEL_API: Record<LocationLevel, LevelApi> = {
  stadt: "cities",
  standort: "sites",
  abschnitt: "sections",
};

const LEVEL_LABEL: Record<LocationLevel, string> = {
  stadt: "Stadt",
  standort: "Standort",
  abschnitt: "Gebäudeabschnitt",
};

const NEW_LABEL = {
  stadt: "Neue Stadt",
  standort: "Neuer Standort",
  abschnitt: "Neuer Gebäudeabschnitt",
  etage: "Neue Etage",
} as const;

interface Crumb {
  label: string;
  href: string;
}

interface Child {
  id: number;
  name: string;
  count: string;
  href: string;
}

interface LevelInfo {
  name: string;
  crumbs: Crumb[];
  children: Child[];
  /** was darunter angelegt wird */
  childLabel: string;
  childKind: "standort" | "abschnitt" | "etage";
}

/** Angaben zu einer gewählten Stadt, einem Standort oder Abschnitt aus dem Baum. */
export function levelInfo(
  tree: Locations,
  node: { level: LocationLevel; id: number },
): LevelInfo | null {
  for (const city of tree.cities) {
    const cityCrumb = { label: city.name, href: levelPath("stadt", city.id) };
    if (node.level === "stadt" && city.id === node.id) {
      return {
        name: city.name,
        crumbs: [],
        childLabel: "Standort",
        childKind: "standort",
        children: city.sites.map((site) => ({
          id: site.id,
          name: site.name,
          count: plural(site.sections.length, "Gebäudeabschnitt", "Gebäudeabschnitte"),
          href: levelPath("standort", site.id),
        })),
      };
    }
    for (const site of city.sites) {
      const siteCrumb = { label: site.name, href: levelPath("standort", site.id) };
      if (node.level === "standort" && site.id === node.id) {
        return {
          name: site.name,
          crumbs: [cityCrumb],
          childLabel: "Gebäudeabschnitt",
          childKind: "abschnitt",
          children: site.sections.map((section) => ({
            id: section.id,
            name: section.name,
            count: plural(section.floors.length, "Etage", "Etagen"),
            href: levelPath("abschnitt", section.id),
          })),
        };
      }
      for (const section of site.sections) {
        if (node.level === "abschnitt" && section.id === node.id) {
          return {
            name: section.name,
            crumbs: [cityCrumb, siteCrumb],
            childLabel: "Etage",
            childKind: "etage",
            children: section.floors.map((floor) => ({
              id: floor.id,
              name: floor.name,
              count: floor.has_plan
                ? plural(floor.rooms.length, "Raum", "Räume")
                : "ohne Grundriss",
              href: locationPath(floor.id),
            })),
          };
        }
      }
    }
  }
  return null;
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Pfad" className="loc-crumbs small">
      {crumbs.map((crumb, index) => (
        <span key={crumb.href}>
          {index > 0 && " › "}
          <Link to={crumb.href}>{crumb.label}</Link>
        </span>
      ))}
    </nav>
  );
}

/** Baum: Pfeil klappt auf und zu, der Name öffnet Stadt, Standort, Abschnitt oder Etage. */
function LocationTree({
  tree,
  floor,
  node,
}: {
  tree: Locations;
  floor: Floor | null;
  node: { level: LocationLevel; id: number } | null;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Offen ist anfangs nur der Weg zur gewählten Etage oder Ebene
  const onPath: Record<string, boolean> = {};
  if (floor) {
    onPath[`c${floor.city_id}`] = true;
    onPath[`s${floor.site_id}`] = true;
    onPath[`a${floor.section_id}`] = true;
  }
  if (node) {
    for (const city of tree.cities) {
      for (const site of city.sites) {
        if (node.level === "standort" && site.id === node.id) {
          onPath[`c${city.id}`] = true;
        }
        for (const section of site.sections) {
          if (node.level === "abschnitt" && section.id === node.id) {
            onPath[`c${city.id}`] = true;
            onPath[`s${site.id}`] = true;
          }
        }
      }
    }
  }
  const isOpen = (key: string) => open[key] ?? onPath[key] ?? false;
  const toggle = (key: string) => setOpen({ ...open, [key]: !isOpen(key) });

  const Row = ({
    id,
    level,
    levelId,
    name,
    count,
  }: {
    id: string;
    level: LocationLevel;
    levelId: number;
    name: string;
    count: string;
  }) => (
    <div className={`lt-row lt-${level}`}>
      <button
        type="button"
        className="lt-chev-button"
        aria-expanded={isOpen(id)}
        aria-label={`${name} ${isOpen(id) ? "zuklappen" : "aufklappen"}`}
        onClick={() => toggle(id)}
      >
        <Icon name={isOpen(id) ? "pfeil-unten" : "pfeil-rechts"} />
      </button>
      <Link
        to={levelPath(level, levelId)}
        className="lt-open"
        aria-current={node?.level === level && node.id === levelId ? "page" : undefined}
      >
        <span className="lt-name">{name}</span>
        <span className="lt-count">{count}</span>
      </Link>
    </div>
  );

  return (
    <ul className="lt-list">
      {tree.cities.map((city) => (
        <li key={city.id}>
          <Row
            id={`c${city.id}`}
            level="stadt"
            levelId={city.id}
            name={city.name}
            count={plural(city.sites.length, "Standort", "Standorte")}
          />
          {isOpen(`c${city.id}`) && (
            <ul className="lt-children">
              {city.sites.map((site) => (
                <li key={site.id}>
                  <Row
                    id={`s${site.id}`}
                    level="standort"
                    levelId={site.id}
                    name={site.name}
                    count={plural(
                      site.sections.reduce((sum, section) => sum + section.floors.length, 0),
                      "Etage",
                      "Etagen",
                    )}
                  />
                  {isOpen(`s${site.id}`) && (
                    <ul className="lt-children">
                      {site.sections.map((section) => (
                        <li key={section.id}>
                          <Row
                            id={`a${section.id}`}
                            level="abschnitt"
                            levelId={section.id}
                            name={section.name}
                            count={plural(section.floors.length, "Etage", "Etagen")}
                          />
                          {isOpen(`a${section.id}`) && (
                            <ul className="lt-children">
                              {section.floors.map((entry) => (
                                <li key={entry.id}>
                                  <Link
                                    to={locationPath(entry.id)}
                                    className="lt-floor"
                                    aria-current={entry.id === floor?.id ? "page" : undefined}
                                  >
                                    <span className="lt-name">{entry.name}</span>
                                    <span className="lt-count">
                                      {entry.has_plan
                                        ? plural(entry.rooms.length, "Raum", "Räume")
                                        : "ohne Grundriss"}
                                    </span>
                                  </Link>
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

/** Neuer Eintrag unter einer Ebene: Stadt, Standort, Abschnitt oder Etage. */
function NewEntryForm({
  kind,
  parentId,
  onTree,
  onFloor,
}: {
  kind: "stadt" | "standort" | "abschnitt" | "etage";
  parentId: number | null;
  onTree: (next: Locations) => void;
  onFloor: (next: Floor) => void;
}) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    setError(null);
    const id = parentId ?? 0;
    let done: Promise<unknown>;
    if (kind === "stadt") {
      done = createLevel("cities", { name: name.trim() }).then(onTree);
    } else if (kind === "standort") {
      done = createLevel("sites", { name: name.trim(), city_id: id }).then(onTree);
    } else if (kind === "abschnitt") {
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
    <form className="settings-form tool-row loc-new" onSubmit={onSubmit} noValidate>
      <label>
        {NEW_LABEL[kind]}
        <input
          type="text"
          value={name}
          maxLength={80}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {kind === "etage" && (
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
      <button type="submit" className="button button-secondary">
        Anlegen
      </button>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </form>
  );
}

/** Umbenennen und Löschen; Löschen geht nur, wenn nichts mehr darunter hängt. */
function RenameDelete({
  label,
  name,
  extra,
  onRename,
  onDelete,
}: {
  label: string;
  name: string;
  /** zusätzliches Feld, z. B. Reihenfolge der Etage */
  extra?: { label: string; value: string };
  onRename: (name: string, extra: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [extraValue, setExtraValue] = useState(extra?.value ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    onRename(value.trim(), extraValue).then(
      () => {
        setEditing(false);
        setError(null);
      },
      (problem: unknown) => setError(errorText(problem, "Konnte nicht gespeichert werden.")),
    );
  };

  return (
    <div className="loc-edit">
      {editing ? (
        <form className="settings-form tool-row" onSubmit={onSubmit} noValidate>
          <label>
            Name ({label})
            <input
              type="text"
              value={value}
              maxLength={80}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {extra && (
            <label className="narrow">
              {extra.label}
              <input
                type="number"
                inputMode="numeric"
                min={-20}
                max={200}
                value={extraValue}
                onChange={(event) => setExtraValue(event.target.value)}
              />
            </label>
          )}
          <button type="submit" className="button button-primary">
            Speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setEditing(false)}
          >
            Abbrechen
          </button>
        </form>
      ) : confirming ? (
        <div className="hint-box hint-warn confirm-box">
          <p>
            {label} <strong>{name}</strong> löschen? Das geht nur, wenn nichts mehr darunter hängt.
          </p>
          <div className="project-actions">
            <button
              type="button"
              className="button button-danger"
              onClick={() =>
                onDelete().catch((problem: unknown) => {
                  setError(errorText(problem, "Konnte nicht gelöscht werden."));
                  setConfirming(false);
                })
              }
            >
              Ja, löschen
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
      ) : (
        <div className="project-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setEditing(true);
              setValue(name);
              setExtraValue(extra?.value ?? "");
              setError(null);
            }}
          >
            Umbenennen
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setConfirming(true)}
          >
            {label} löschen
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** Gewählte Stadt, Standort oder Abschnitt: was darunter liegt, Umbenennen, Löschen, Neu. */
function LevelPanel({
  tree,
  node,
  canEdit,
  onTree,
  onFloor,
}: {
  tree: Locations;
  node: { level: LocationLevel; id: number };
  canEdit: boolean;
  onTree: (next: Locations) => void;
  onFloor: (next: Floor) => void;
}) {
  const info = levelInfo(tree, node);
  if (!info) {
    return <p className="panel panel-empty">Diesen Eintrag gibt es nicht mehr.</p>;
  }
  const label = LEVEL_LABEL[node.level];
  return (
    <section className="panel" aria-labelledby="ebene-titel">
      <div className="panel-head">
        <div>
          <Breadcrumbs crumbs={info.crumbs} />
          <p className="small loc-kind">{label}</p>
          <h2 id="ebene-titel">{info.name}</h2>
        </div>
      </div>
      <div className="detail-body">
        {info.children.length === 0 ? (
          <p className="small">
            Noch kein {info.childLabel === "Etage" ? "Eintrag" : info.childLabel} darunter.
          </p>
        ) : (
          <ul className="loc-children">
            {info.children.map((child) => (
              <li key={child.id}>
                <Link to={child.href}>{child.name}</Link>
                <span className="small">{child.count}</span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <>
            <NewEntryForm
              key={`${node.level}-${node.id}`}
              kind={info.childKind}
              parentId={node.id}
              onTree={onTree}
              onFloor={onFloor}
            />
            <RenameDelete
              key={`edit-${node.level}-${node.id}-${info.name}`}
              label={label}
              name={info.name}
              onRename={(name) => renameLevel(LEVEL_API[node.level], node.id, name).then(onTree)}
              onDelete={() =>
                deleteLevel(LEVEL_API[node.level], node.id).then((next) => {
                  onTree(next);
                  const parent = info.crumbs[info.crumbs.length - 1];
                  navigate(parent ? parent.href : "/bestand/standorte");
                })
              }
            />
          </>
        )}
      </div>
    </section>
  );
}

/** Raum neben dem Grundriss: Arbeitsplätze, Name und Lage (auch ohne Maus änderbar), Löschen. */
function RoomPanel({
  room,
  workplaces,
  canEdit,
  onBack,
  onSave,
  onDelete,
}: {
  room: Room;
  workplaces: FloorSpot[];
  canEdit: boolean;
  onBack: () => void;
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
    <section className="room-side" aria-labelledby="raum-titel">
      <button type="button" className="row-button room-back" onClick={onBack}>
        ‹ Alle Räume
      </button>
      <h3 id="raum-titel">Raum {room.name}</h3>
      <p className="small">
        {room.hardware === 0 ? "keine Hardware" : plural(room.hardware, "Gerät", "Geräte")}
        {" · "}
        {workplaces.length === 0
          ? "kein Arbeitsplatz mit Platz im Grundriss"
          : plural(workplaces.length, "Arbeitsplatz", "Arbeitsplätze")}
      </p>
      {workplaces.length > 0 && (
        <ul className="link-list">
          {workplaces.map((spot) => (
            <li key={spot.id}>
              <Link to={workplacePath(spot.id)}>{spot.number}</Link>
              <span className="small">
                {" "}
                {spot.positions.length === 0
                  ? "frei"
                  : spot.positions.map((entry) => entry.person_name || entry.name).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form className="settings-form form-stack" onSubmit={onSubmit} noValidate>
          <label>
            Name
            <input
              type="text"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <details className="room-rect-details">
            <summary>Lage mit Zahlen ändern</summary>
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
          </details>
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
        <p className="small">
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

/** IT-Bestand › Standorte: links der Baum, rechts genau das, was gewählt ist. */
export function LocationsPage({
  floorId,
  roomId,
  node = null,
  roles,
}: {
  floorId: number | null;
  roomId: number | null;
  /** gewählte Stadt, Standort oder Abschnitt */
  node?: { level: LocationLevel; id: number } | null;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [tree, setTree] = useState<Locations | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [floorSettings, setFloorSettings] = useState(false);
  const [draft, setDraft] = useState<RoomRect | null>(null);
  const [mobileTree, setMobileTree] = useState(false);
  const [treeHidden, setTreeHidden] = useState(readTreeHidden);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nodeKey = node ? `${node.level}-${node.id}` : "";

  useEffect(() => {
    let active = true;
    fetchLocations().then(
      (result) => {
        if (!active) {
          return;
        }
        setTree(result);
        if (floorId === null && nodeKey === "") {
          const first = firstFloorId(result);
          if (first !== null) {
            navigate(locationPath(first));
          } else if (result.cities[0]) {
            navigate(levelPath("stadt", result.cities[0].id));
          }
        }
      },
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Standorte konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [floorId, nodeKey]);

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
  const open = (href: string) => {
    setQuery("");
    setMobileTree(false);
    setDraft(null);
    navigate(href);
  };
  const applyFloor = (next: Floor) => {
    setFloor(next);
    void refreshTree();
    if (next.id !== floorId) {
      navigate(locationPath(next.id));
    }
  };
  const toggleTree = (hidden: boolean) => {
    setTreeHidden(hidden);
    saveTreeHidden(hidden);
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

  const selectedLabel = shownFloor
    ? shownFloor.name
    : node && tree
      ? (levelInfo(tree, node)?.name ?? "")
      : "";
  const floorCrumbs: Crumb[] = shownFloor
    ? [
        { label: shownFloor.city, href: levelPath("stadt", shownFloor.city_id) },
        { label: shownFloor.site, href: levelPath("standort", shownFloor.site_id) },
        { label: shownFloor.section, href: levelPath("abschnitt", shownFloor.section_id) },
      ]
    : [];

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
              <NewEntryForm kind="stadt" parentId={null} onTree={setTree} onFloor={applyFloor} />
            ) : (
              <p>Es sind noch keine Standorte angelegt.</p>
            )}
          </div>
        </section>
      )}
      {tree && tree.cities.length > 0 && (
        <div className="loc-wrap">
          <div className={treeHidden ? "loc-layout loc-layout-wide" : "loc-layout"}>
            {selectedLabel && (
              <div className="loc-mobilebar panel">
                <strong>{selectedLabel}</strong>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-expanded={mobileTree}
                  aria-controls="standortbaum"
                  onClick={() => setMobileTree(!mobileTree)}
                >
                  {mobileTree ? "Schließen" : "Standort wechseln"}
                </button>
              </div>
            )}
            <nav
              id="standortbaum"
              className={
                mobileTree || !selectedLabel ? "panel loc-tree loc-tree-open" : "panel loc-tree"
              }
              aria-label="Standorte"
              onClick={(event) => {
                // Schmal: Nach der Wahl im Baum schließt er sich wieder.
                if (event.target instanceof Element && event.target.closest("a")) {
                  setMobileTree(false);
                }
              }}
            >
              <div className="loc-tree-head">
                <span className="loc-tree-title">Standorte</span>
                <button
                  type="button"
                  className="row-button loc-tree-hide"
                  aria-label="Standortbaum ausblenden"
                  title="Standortbaum ausblenden"
                  onClick={() => toggleTree(true)}
                >
                  <Icon name="einklappen" />
                </button>
              </div>
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
                      <li key={hit.href}>
                        <button type="button" className="loc-hit" onClick={() => open(hit.href)}>
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
              <LocationTree tree={tree} floor={shownFloor} node={node} />
              {canEdit && (
                <details className="loc-new-city">
                  <summary>Neue Stadt</summary>
                  <NewEntryForm
                    kind="stadt"
                    parentId={null}
                    onTree={setTree}
                    onFloor={applyFloor}
                  />
                </details>
              )}
            </nav>

            <div className="loc-main">
              {treeHidden && (
                <button
                  type="button"
                  className="button button-secondary loc-tree-show"
                  onClick={() => toggleTree(false)}
                >
                  <Icon name="ausklappen" />
                  Standortbaum einblenden
                </button>
              )}
              {node && !shownFloor && (
                <LevelPanel
                  tree={tree}
                  node={node}
                  canEdit={canEdit}
                  onTree={setTree}
                  onFloor={applyFloor}
                />
              )}
              {!node && !shownFloor && floorId !== null && <p role="status">Wird geladen …</p>}
              {shownFloor && (
                <section className="panel" aria-labelledby="etage-titel">
                  <div className="panel-head">
                    <div>
                      <Breadcrumbs crumbs={floorCrumbs} />
                      <h2 id="etage-titel">{shownFloor.name}</h2>
                    </div>
                    {canEdit && (
                      <div className="project-actions">
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
                        <button
                          type="button"
                          className="button button-secondary"
                          aria-expanded={floorSettings}
                          aria-controls="etage-einstellungen"
                          onClick={() => setFloorSettings(!floorSettings)}
                        >
                          Etage bearbeiten
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="detail-body">
                    {canEdit && floorSettings && (
                      <div id="etage-einstellungen" className="loc-floor-settings">
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
                                    errorText(
                                      problem,
                                      "Der Grundriss konnte nicht entfernt werden.",
                                    ),
                                  ),
                                )
                              }
                            >
                              Grundriss entfernen
                            </button>
                          )}
                        </div>
                        <RenameDelete
                          key={`${shownFloor.id}-${shownFloor.name}-${shownFloor.position}`}
                          label="Etage"
                          name={shownFloor.name}
                          extra={{ label: "Reihenfolge", value: String(shownFloor.position) }}
                          onRename={(name, position) =>
                            updateFloor(shownFloor.id, {
                              name,
                              position: Number(position) || 0,
                            }).then(applyFloor)
                          }
                          onDelete={() =>
                            deleteLevel("floors", shownFloor.id).then((next) => {
                              setTree(next);
                              setFloorSettings(false);
                              navigate(levelPath("abschnitt", shownFloor.section_id));
                            })
                          }
                        />
                      </div>
                    )}
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
                          spots={editing ? [] : planSpots(shownFloor)}
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
                      {room ? (
                        <RoomPanel
                          key={`${room.id}-${room.x}-${room.y}-${room.w}-${room.h}-${room.name}`}
                          room={room}
                          workplaces={shownFloor.workplaces.filter(
                            (spot) => spot.room_id === room.id,
                          )}
                          canEdit={canEdit}
                          onBack={() => navigate(locationPath(shownFloor.id))}
                          onSave={(name, rect) =>
                            updateRoom(room.id, { name, ...rect }).then(applyFloor)
                          }
                          onDelete={() =>
                            deleteRoom(room.id).then((next) => {
                              applyFloor(next);
                              navigate(locationPath(next.id));
                            })
                          }
                        />
                      ) : (
                        <div className="room-list" role="group" aria-label="Räume dieser Etage">
                          <p className="small room-list-head">
                            {shownFloor.rooms.length === 0
                              ? canEdit
                                ? "Noch keine Räume. Mit „Räume bearbeiten“ ziehst du sie im Grundriss auf."
                                : "Noch keine Räume."
                              : plural(shownFloor.rooms.length, "Raum", "Räume")}
                          </p>
                          {shownFloor.rooms.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              aria-pressed={false}
                              onClick={() => navigate(locationPath(shownFloor.id, entry.id))}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
