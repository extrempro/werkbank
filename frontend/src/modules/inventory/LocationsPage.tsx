import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { navigate } from "../../router";
import { RoomList } from "./RoomList";
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
  type FloorBrief,
  type FloorSpot,
  type LocationLevel,
  type Locations,
  type Room,
  type RoomRect,
} from "./api";
import { Feedback } from "../../components/Feedback";

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

/** Ansicht des Standortbaums: eine Zeile je Eintrag oder mit Kennzahlen darunter. */
export type TreeView = "kompakt" | "ausfuehrlich";

export const TREE_VIEW_KEY = "werkbank-standortbaum-ansicht";
const TREE_VIEWS: readonly { value: TreeView; label: string }[] = [
  { value: "kompakt", label: "Kompakt" },
  { value: "ausfuehrlich", label: "Ausführlich" },
];

export function readTreeView(): TreeView {
  try {
    return window.localStorage.getItem(TREE_VIEW_KEY) === "kompakt" ? "kompakt" : "ausfuehrlich";
  } catch {
    return "ausfuehrlich";
  }
}

function saveTreeView(view: TreeView): void {
  try {
    window.localStorage.setItem(TREE_VIEW_KEY, view);
    // Frühere Einstellung „Abstände im Baum“ (bis 0.116.0) aufräumen
    window.localStorage.removeItem("werkbank-standortbaum-abstand");
  } catch {
    // Speicher gesperrt: gilt nur bis zum Neuladen
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

type TreeLevel = LocationLevel | "etage";

const LEVEL_ICON = {
  stadt: "ort-stadt",
  standort: "ort-standort",
  abschnitt: "ort-abschnitt",
  etage: "ort-etage",
} as const;

/** Kennzahlen einer Ebene für die Zeile darunter (ausführlich) und die Zahl rechts (kompakt). */
interface Figures {
  sites?: number;
  floors?: number;
  rooms: number;
  free: number;
  noPlan?: boolean;
}

function floorFigures(floor: FloorBrief): Figures {
  return { rooms: floor.rooms.length, free: floor.workplaces_free, noPlan: !floor.has_plan };
}

function sumFigures(floors: FloorBrief[]): Figures {
  return floors.reduce(
    (sum, floor) => ({
      floors: (sum.floors ?? 0) + 1,
      rooms: sum.rooms + floor.rooms.length,
      free: sum.free + floor.workplaces_free,
    }),
    { floors: 0, rooms: 0, free: 0 } as Figures,
  );
}

function figuresText(figures: Figures): string {
  return [
    figures.sites !== undefined ? plural(figures.sites, "Standort", "Standorte") : "",
    figures.floors !== undefined ? plural(figures.floors, "Etage", "Etagen") : "",
    plural(figures.rooms, "Raum", "Räume"),
    figures.free > 0 ? plural(figures.free, "freier Platz", "freie Plätze") : "",
    figures.noPlan ? "ohne Grundriss" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Kurze Zahl der kompakten Ansicht: was direkt darunter liegt (bei Etagen die Räume). */
function shortCount(level: TreeLevel, figures: Figures): number {
  if (level === "stadt") {
    return figures.sites ?? 0;
  }
  return level === "etage" ? figures.rooms : (figures.floors ?? 0);
}

/**
 * Baum: Pfeil klappt auf und zu, der Name öffnet Stadt, Standort, Abschnitt oder Etage.
 * Kompakt: eine Zeile, lange Namen enden mit „…“ (ganz im Tooltip und für Screenreader),
 * rechts eine Zahl. Ausführlich: ganzer Name, darunter die Kennzahlen.
 */
function LocationTree({
  tree,
  floor,
  node,
  view,
  collapsed,
}: {
  tree: Locations;
  floor: Floor | null;
  node: { level: LocationLevel; id: number } | null;
  view: TreeView;
  /** Nach „Alles einklappen“: der Weg zur jetzigen Auswahl ist nicht mehr von selbst offen. */
  collapsed: boolean;
}) {
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
  // Nach „Alles einklappen“ bleibt auch der Weg zur Auswahl zu (bis man woanders hingeht)
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    collapsed ? Object.fromEntries(Object.keys(onPath).map((key) => [key, false])) : {},
  );
  const isOpen = (key: string) => open[key] ?? onPath[key] ?? false;
  const toggle = (key: string) => setOpen({ ...open, [key]: !isOpen(key) });
  const compact = view === "kompakt";

  const Row = ({
    id,
    level,
    href,
    name,
    figures,
    current,
    hasChildren,
  }: {
    id: string;
    level: TreeLevel;
    href: string;
    name: string;
    figures: Figures;
    current: boolean;
    hasChildren: boolean;
  }) => {
    const text = figuresText(figures);
    return (
      <div className={`lt-row lt-${level}`}>
        {hasChildren ? (
          <button
            type="button"
            className="lt-chev-button"
            aria-expanded={isOpen(id)}
            aria-label={`${name} ${isOpen(id) ? "zuklappen" : "aufklappen"}`}
            onClick={() => toggle(id)}
          >
            <Icon name={isOpen(id) ? "pfeil-unten" : "pfeil-rechts"} />
          </button>
        ) : (
          <span className="lt-chev-space" aria-hidden="true" />
        )}
        <Link
          to={href}
          className="lt-open"
          title={compact ? `${name} · ${text}` : undefined}
          aria-current={current ? "page" : undefined}
        >
          <span className="lt-line">
            <Icon name={LEVEL_ICON[level]} />
            <span className="lt-name">{name}</span>
            {compact && (
              <span className="lt-count" aria-hidden="true">
                {shortCount(level, figures)}
              </span>
            )}
          </span>
          {compact ? (
            <span className="visually-hidden">{`, ${text}`}</span>
          ) : (
            <span className="lt-sub">{text}</span>
          )}
        </Link>
      </div>
    );
  };

  return (
    <ul className="lt-list">
      {tree.cities.map((city) => {
        const cityFloors = city.sites.flatMap((site) => site.sections.flatMap((s) => s.floors));
        return (
          <li key={city.id}>
            <Row
              id={`c${city.id}`}
              level="stadt"
              href={levelPath("stadt", city.id)}
              name={city.name}
              figures={{ ...sumFigures(cityFloors), sites: city.sites.length }}
              current={node?.level === "stadt" && node.id === city.id}
              hasChildren={city.sites.length > 0}
            />
            {isOpen(`c${city.id}`) && city.sites.length > 0 && (
              <ul className="lt-children">
                {city.sites.map((site) => (
                  <li key={site.id}>
                    <Row
                      id={`s${site.id}`}
                      level="standort"
                      href={levelPath("standort", site.id)}
                      name={site.name}
                      figures={sumFigures(site.sections.flatMap((section) => section.floors))}
                      current={node?.level === "standort" && node.id === site.id}
                      hasChildren={site.sections.length > 0}
                    />
                    {isOpen(`s${site.id}`) && site.sections.length > 0 && (
                      <ul className="lt-children">
                        {site.sections.map((section) => (
                          <li key={section.id}>
                            <Row
                              id={`a${section.id}`}
                              level="abschnitt"
                              href={levelPath("abschnitt", section.id)}
                              name={section.name}
                              figures={sumFigures(section.floors)}
                              current={node?.level === "abschnitt" && node.id === section.id}
                              hasChildren={section.floors.length > 0}
                            />
                            {isOpen(`a${section.id}`) && section.floors.length > 0 && (
                              <ul className="lt-children">
                                {section.floors.map((entry) => (
                                  <li key={entry.id}>
                                    <Row
                                      id={`f${entry.id}`}
                                      level="etage"
                                      href={locationPath(entry.id)}
                                      name={entry.name}
                                      figures={floorFigures(entry)}
                                      current={entry.id === floor?.id}
                                      hasChildren={false}
                                    />
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
        );
      })}
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
      setError("Bitte trag einen Namen ein.");
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
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("Bitte trag einen Namen ein.");
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
          <ConfirmButton
            className="button button-secondary"
            confirm={{
              title: `${label} ${name} löschen?`,
              text: "Das geht nur, wenn nichts mehr darunter hängt.",
              action: `${label} löschen`,
              danger: true,
            }}
            onConfirm={() =>
              onDelete().catch((problem: unknown) =>
                setError(errorText(problem, "Konnte nicht gelöscht werden.")),
              )
            }
          >
            {label} löschen
          </ConfirmButton>
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
  onSave: (name: string, description: string, rect: RoomRect) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [rect, setRect] = useState({
    x: String(room.x),
    y: String(room.y),
    w: String(room.w),
    h: String(room.h),
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte trag einen Namen ein.");
      return;
    }
    const numbers = {
      x: Number(rect.x.replace(",", ".")),
      y: Number(rect.y.replace(",", ".")),
      w: Number(rect.w.replace(",", ".")),
      h: Number(rect.h.replace(",", ".")),
    };
    if (Object.values(numbers).some((value) => !Number.isFinite(value))) {
      setError("Bitte trag Zahlen für die Lage ein.");
      return;
    }
    setError(null);
    onSave(name.trim(), description.trim(), clampRect(numbers)).catch((problem: unknown) =>
      setError(errorText(problem, "Der Raum konnte nicht gespeichert werden.")),
    );
  };

  return (
    <section className="room-side" aria-labelledby="raum-titel">
      <button type="button" className="row-button room-back" onClick={onBack}>
        ‹ Alle Räume
      </button>
      <h3 id="raum-titel">Raum {room.name}</h3>
      {room.description && <p className="room-description">{room.description}</p>}
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
          <label>
            Nutzung oder Beschreibung (freiwillig)
            <input
              type="text"
              value={description}
              maxLength={120}
              placeholder="z. B. Besprechung, Technik, Büro"
              onChange={(event) => setDescription(event.target.value)}
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
            <ConfirmButton
              className="button button-secondary"
              disabled={room.hardware > 0}
              title={room.hardware > 0 ? "Im Raum steht noch Hardware" : undefined}
              confirm={{
                title: `Raum ${room.name} löschen?`,
                text: "Der Raum verschwindet aus dem Grundriss.",
                action: "Raum löschen",
                danger: true,
              }}
              onConfirm={() =>
                onDelete().catch((problem: unknown) =>
                  setError(errorText(problem, "Der Raum konnte nicht gelöscht werden.")),
                )
              }
            >
              Raum löschen
            </ConfirmButton>
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
      setError("Bitte trag einen Namen für den Raum ein.");
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
  const [view, setView] = useState<TreeView>(readTreeView);
  // Zähler für „Alles einklappen“: baut den Baum neu auf, alles zu
  const [collapses, setCollapses] = useState(0);
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
  const pickView = (value: TreeView) => {
    setView(value);
    saveTreeView(value);
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
              data-view={view}
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
                  className="row-button loc-tree-collapse"
                  aria-label="Alles einklappen"
                  title="Alles einklappen"
                  onClick={() => setCollapses(collapses + 1)}
                >
                  <Icon name="alles-einklappen" />
                </button>
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
              <div className="lt-views" role="group" aria-label="Ansicht des Baums">
                {TREE_VIEWS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={view === option.value}
                    onClick={() => pickView(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
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
              <LocationTree
                key={collapses}
                tree={tree}
                floor={shownFloor}
                node={node}
                view={view}
                collapsed={collapses > 0}
              />
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
                            <ConfirmButton
                              className="button button-secondary"
                              confirm={{
                                title: "Grundriss entfernen?",
                                text: `Das Bild der Etage ${shownFloor.name} wird gelöscht. Die Räume bleiben, sind aber ohne Grundriss nicht mehr zu sehen, bis du ein neues Bild hochlädst.`,
                                action: "Entfernen",
                                danger: true,
                              }}
                              onConfirm={() =>
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
                            </ConfirmButton>
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
                    <Feedback
                      message={notice ? { kind: "alert", text: notice } : null}
                      onClose={() => setNotice(null)}
                    />
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
                          onSave={(name, description, rect) =>
                            updateRoom(room.id, { name, description, ...rect }).then(applyFloor)
                          }
                          onDelete={() =>
                            deleteRoom(room.id).then((next) => {
                              applyFloor(next);
                              navigate(locationPath(next.id));
                            })
                          }
                        />
                      ) : (
                        <RoomList
                          rooms={shownFloor.rooms}
                          emptyText={
                            canEdit
                              ? "Noch keine Räume. Mit „Räume bearbeiten“ ziehst du sie im Grundriss auf."
                              : "Noch keine Räume."
                          }
                          onOpen={(entry) => navigate(locationPath(shownFloor.id, entry.id))}
                        />
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
