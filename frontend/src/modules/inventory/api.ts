import { ApiError, deleteJson, getJson, postJson, putJson } from "../../api";
import {
  INVENTORY_CASES_PATH,
  INVENTORY_HARDWARE_PATH,
  INVENTORY_LOANS_PATH,
  INVENTORY_LOCATIONS_PATH,
  INVENTORY_POSITIONS_PATH,
  INVENTORY_WORKPLACES_PATH,
} from "../../navigation";

const BASE = "/api/inventory";

export const INVENTORY_EDITOR_ROLE = "Bestand.Editor";

export type HardwareStatus = "aktiv" | "ausgemustert";
export type Whereabouts = "entsorgt" | "abgegeben" | "leasing" | "hersteller";

export const WHEREABOUTS_LABELS: Record<Whereabouts, string> = {
  entsorgt: "entsorgt",
  abgegeben: "verkauft oder abgegeben",
  leasing: "an Leasing zurück",
  hersteller: "beim Hersteller",
};

export const SOURCE_LABELS: Record<string, string> = {
  manuell: "von Hand",
  ninja: "aus NinjaOne",
};

export interface HardwareSummary {
  id: number;
  name: string;
  kind_id: number;
  kind: string;
  maker: string | null;
  model: string | null;
  serial: string;
  inventory_no: string | null;
  hostname: string;
  source: string;
  status: HardwareStatus;
  /** Raum mit Standort und Etage als Text; null ohne Raum. */
  place: string | null;
  /** Stelle oder Arbeitsplatz als Text; null ohne Zuordnung. */
  holder: string | null;
}

export interface Retire {
  retired_on: string;
  reason: string;
  whereabouts: Whereabouts | "";
  wiped: boolean | null;
  note: string;
}

export interface HardwareEvent {
  occurred_at: string;
  who: string;
  text: string;
}

export interface DeviceLocation {
  room_id: number;
  room: string;
  floor_id: number;
  floor: string;
  section: string;
  site: string;
  city: string;
}

export interface HolderRef {
  kind: "stelle" | "arbeitsplatz";
  id: number;
  label: string;
}

export interface Hardware extends HardwareSummary {
  location: DeviceLocation | null;
  /** Kenndaten aus NinjaOne; null bei Geräten ohne Eintrag in NinjaOne */
  ninja: NinjaInfo | null;
  /** Monitor: Rechner, an dem er laut NinjaOne zuletzt hing */
  connected_to: LinkedDevice | null;
  /** Rechner: Monitore, die laut NinjaOne zuletzt an ihm hingen */
  monitors: LinkedDevice[];
  /** Offener Verleih, in dem das Gerät gerade ist */
  loan: LoanRef | null;
  /** Anschaffungsdatum JJJJ-MM-TT */
  purchased_on: string | null;
  holder_ref: HolderRef | null;
  position_id: number | null;
  workplace_id: number | null;
  model_id: number | null;
  maker_id: number | null;
  note: string;
  has_storage: boolean;
  created_at: string;
  retire: Retire | null;
  events: HardwareEvent[];
}

export interface HardwareInput {
  kind_id: number;
  model_id: number | null;
  name: string;
  serial: string;
  hostname: string;
  note: string;
  /** Anschaffungsdatum JJJJ-MM-TT oder null */
  purchased_on: string | null;
  room_id: number | null;
  position_id: number | null;
  workplace_id: number | null;
}

export interface RetireInput {
  reason_id: number;
  whereabouts: Whereabouts;
  retired_on: string;
  wiped: boolean;
  note: string;
}

export interface Kind {
  id: number;
  name: string;
  has_storage: boolean;
  used: number;
  /** Nutzungsdauer in Jahren (Erneuerungsbedarf in der Statistik); null = keine */
  lifetime_years?: number | null;
}

export interface Model {
  id: number;
  name: string;
  used: number;
}

export interface Maker {
  id: number;
  name: string;
  models: Model[];
}

export interface Reason {
  id: number;
  name: string;
  used: number;
}

export interface Department {
  id: number;
  name: string;
  used: number;
}

export interface KitRow {
  label: string;
  count: number;
  kind_ids: number[];
}

export interface Kit {
  id: number;
  name: string;
  /** an so vielen Arbeitsplätzen gewählt */
  used: number;
  rows: KitRow[];
}

/** Zweck eines Pool-Arbeitsplatzes (Stammdaten); ``used`` = so viele Arbeitsplätze. */
export interface Purpose {
  id: number;
  name: string;
  used: number;
}

export interface MasterData {
  kinds: Kind[];
  makers: Maker[];
  reasons: Reason[];
  departments: Department[];
  purposes: Purpose[];
  kits: Kit[];
}

/** Die Reiter eines Geräts; der erste hat keinen eigenen Pfadteil. */
export type HardwareTab = "uebersicht" | "standort" | "technik" | "verlauf";

export const HARDWARE_TABS: { id: HardwareTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "standort", label: "Standort" },
  { id: "technik", label: "Technik" },
  { id: "verlauf", label: "Verlauf" },
];

export function hardwarePath(id: number, tab: HardwareTab = "uebersicht"): string {
  return tab === "uebersicht"
    ? `${INVENTORY_HARDWARE_PATH}/${id}`
    : `${INVENTORY_HARDWARE_PATH}/${id}/${tab}`;
}

/** Gerät und Reiter aus dem Pfad, z. B. „/bestand/hardware/7/verlauf“; sonst null. */
export function parseHardwarePath(path: string): { id: number; tab: HardwareTab } | null {
  const match = /^\/bestand\/hardware\/(\d{1,9})(?:\/(standort|technik|verlauf))?$/.exec(path);
  if (!match) {
    return null;
  }
  return { id: Number(match[1]), tab: (match[2] as HardwareTab | undefined) ?? "uebersicht" };
}

export type ListState = HardwareStatus | "alle";

export interface HardwareList {
  items: HardwareSummary[];
  /** Treffer insgesamt (Status, Art, Suche) */
  total: number;
  /** Arten, die es mit diesem Status gibt */
  kinds: { id: number; name: string }[];
}

export function fetchHardwareList(
  state: ListState,
  query = "",
  kindId: number | null = null,
  offset = 0,
  limit = PAGE_SIZE,
): Promise<HardwareList> {
  const params = pageQuery(state, query, offset, limit);
  return getJson(`${BASE}/hardware?${params}${kindId === null ? "" : `&kind=${kindId}`}`);
}

export function fetchHardware(id: number): Promise<Hardware> {
  return getJson(`${BASE}/hardware/${id}`);
}

export function createHardware(
  body: HardwareInput & { inventory_no: string | null },
): Promise<Hardware> {
  return postJson(`${BASE}/hardware`, body, { quiet: true });
}

export function updateHardware(id: number, body: HardwareInput): Promise<Hardware> {
  return putJson(`${BASE}/hardware/${id}`, body, { quiet: true });
}

export function setInventoryNo(id: number, inventoryNo: string | null): Promise<Hardware> {
  return putJson(
    `${BASE}/hardware/${id}/inventory-no`,
    { inventory_no: inventoryNo },
    { quiet: true },
  );
}

export function retireHardware(id: number, body: RetireInput): Promise<Hardware> {
  return postJson(`${BASE}/hardware/${id}/retire`, body, { quiet: true });
}

export function reactivateHardware(id: number): Promise<Hardware> {
  return postJson(`${BASE}/hardware/${id}/reactivate`, {}, { quiet: true });
}

export function fetchMasterData(): Promise<MasterData> {
  return getJson(`${BASE}/master-data`);
}

export type MasterKind = "kinds" | "makers" | "reasons" | "departments" | "purposes";

export function createEntry(
  kind: MasterKind,
  body: { name: string; has_storage?: boolean },
): Promise<MasterData> {
  return postJson(`${BASE}/${kind}`, body, { quiet: true });
}

export function updateEntry(
  kind: MasterKind,
  id: number,
  body: { name: string; has_storage?: boolean },
): Promise<MasterData> {
  return putJson(`${BASE}/${kind}/${id}`, body, { quiet: true });
}

export function deleteEntry(kind: MasterKind | "models" | "kits", id: number): Promise<MasterData> {
  return deleteJson(`${BASE}/${kind}/${id}`, { quiet: true });
}

export function createModel(makerId: number, name: string): Promise<MasterData> {
  return postJson(`${BASE}/makers/${makerId}/models`, { name }, { quiet: true });
}

export function updateModel(id: number, name: string): Promise<MasterData> {
  return putJson(`${BASE}/models/${id}`, { name }, { quiet: true });
}

export function saveKit(id: number | null, body: { name: string; rows: KitRow[] }) {
  return id === null
    ? postJson<MasterData>(`${BASE}/kits`, body, { quiet: true })
    : putJson<MasterData>(`${BASE}/kits/${id}`, body, { quiet: true });
}

/** Text für Hersteller und Modell, z. B. „Hersteller A Monitor 27“; ohne Modell „–“. */
export function modelLabel(device: Pick<HardwareSummary, "maker" | "model">): string {
  return device.model ? `${device.maker ?? ""} ${device.model}`.trim() : "–";
}

/** Suche über Bezeichnung, Art, Modell, Seriennummer, Inventurnummer, Hostname und Standort. */
/** Datum als „TT.MM.JJJJ“. */
export function formatDay(value: string | null): string {
  if (!value) {
    return "–";
  }
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

/** Zeitpunkt als Datum in deutscher Schreibweise (ohne Uhrzeit). */
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "–" : date.toLocaleDateString("de-DE");
}

/** Heute als „JJJJ-MM-TT“ in der Ortszeit. */
export function today(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// --- Standorte ---------------------------------------------------------------------------

export interface RoomBrief {
  id: number;
  name: string;
}

export interface FloorBrief {
  id: number;
  name: string;
  position: number;
  has_plan: boolean;
  rooms: RoomBrief[];
  /** Freie Arbeitsplätze auf der Etage (ohne Stelle, kein Pool). */
  workplaces_free: number;
}

export interface SectionNode {
  id: number;
  name: string;
  floors: FloorBrief[];
}

export interface SiteNode {
  id: number;
  name: string;
  sections: SectionNode[];
}

export interface CityNode {
  id: number;
  name: string;
  sites: SiteNode[];
}

export interface Locations {
  cities: CityNode[];
}

export interface Room {
  id: number;
  name: string;
  /** freiwillig: Nutzung oder Beschreibung */
  description: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hardware: number;
  /** Arbeitsplätze im Raum, davon ohne Stelle */
  workplaces: number;
  workplaces_free: number;
  /** Personen der Stellen an den Arbeitsplätzen im Raum */
  people: string[];
}

export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Floor {
  id: number;
  name: string;
  position: number;
  section_id: number;
  section: string;
  site_id: number;
  site: string;
  city_id: number;
  city: string;
  /** ``rotation``: Drehung beim Anzeigen im Uhrzeigersinn; Räume und Plätze sind ungedreht gespeichert */
  plan: { url: string; width: number; height: number; rotation: PlanRotation } | null;
  rooms: Room[];
  /** Arbeitsplätze mit gesetztem Platz; x und y in Prozent der Etage */
  workplaces: FloorSpot[];
}

export interface FloorSpot {
  id: number;
  number: string;
  room_id: number;
  x: number;
  y: number;
  shared: boolean;
  positions: { number: string; name: string; person_name: string }[];
  hardware: { name: string; kind: string }[];
  hardware_more: number;
}

/** Inhalt des Info-Fensters am Platz: Überschrift und Zeilen (nur Text). */
export function spotInfo(spot: FloorSpot, room: string | null): { title: string; lines: string[] } {
  const title = [spot.number, room ? `Raum ${room}` : "", spot.shared ? "geteilt" : "einzeln"]
    .filter(Boolean)
    .join(" · ");
  const lines =
    spot.positions.length === 0
      ? ["Keine Stelle"]
      : spot.positions.map(
          (position) =>
            `${position.number} ${position.name} – ${position.person_name || "unbesetzt"}`,
        );
  if (spot.hardware.length === 0) {
    lines.push("Keine Hardware");
  } else {
    const devices = spot.hardware.map((device) =>
      device.kind ? `${device.name} (${device.kind})` : device.name,
    );
    lines.push(
      `Hardware: ${devices.join(", ")}${spot.hardware_more > 0 ? ` und ${spot.hardware_more} weitere` : ""}`,
    );
  }
  return { title, lines };
}

/** Etage und Raum aus dem Pfad, z. B. „/bestand/standorte/etage/4/raum/9“. */
/** Ebene über der Etage, die bei „Standorte“ gewählt sein kann. */
export type LocationLevel = "stadt" | "standort" | "abschnitt";

export interface LocationRoute {
  floorId: number | null;
  roomId: number | null;
  /** gewählte Stadt, Standort oder Abschnitt (statt einer Etage) */
  node?: { level: LocationLevel; id: number };
}

export function parseLocationPath(path: string): LocationRoute | null {
  if (path === INVENTORY_LOCATIONS_PATH) {
    return { floorId: null, roomId: null };
  }
  const level = /^\/bestand\/standorte\/(stadt|standort|abschnitt)\/(\d{1,9})$/.exec(path);
  if (level) {
    return {
      floorId: null,
      roomId: null,
      node: { level: level[1] as LocationLevel, id: Number(level[2]) },
    };
  }
  const match = /^\/bestand\/standorte\/etage\/(\d{1,9})(?:\/raum\/(\d{1,9}))?$/.exec(path);
  if (!match) {
    return null;
  }
  return { floorId: Number(match[1]), roomId: match[2] ? Number(match[2]) : null };
}

export function levelPath(level: LocationLevel, id: number): string {
  return `${INVENTORY_LOCATIONS_PATH}/${level}/${id}`;
}

export function locationPath(floorId: number, roomId: number | null = null): string {
  const base = `${INVENTORY_LOCATIONS_PATH}/etage/${floorId}`;
  return roomId === null ? base : `${base}/raum/${roomId}`;
}

export function fetchLocations(): Promise<Locations> {
  return getJson(`${BASE}/locations`);
}

export function fetchFloor(id: number): Promise<Floor> {
  return getJson(`${BASE}/floors/${id}`);
}

export type LevelKind = "cities" | "sites" | "sections";

export function createLevel(
  kind: LevelKind,
  body: { name: string; city_id?: number; site_id?: number },
): Promise<Locations> {
  return postJson(`${BASE}/${kind}`, body, { quiet: true });
}

export function renameLevel(kind: LevelKind, id: number, name: string): Promise<Locations> {
  return putJson(`${BASE}/${kind}/${id}`, { name }, { quiet: true });
}

export function deleteLevel(kind: LevelKind | "floors", id: number): Promise<Locations> {
  return deleteJson(`${BASE}/${kind}/${id}`, { quiet: true });
}

export function createFloor(body: {
  name: string;
  section_id: number;
  position: number;
}): Promise<Floor> {
  return postJson(`${BASE}/floors`, body, { quiet: true });
}

export function updateFloor(id: number, body: { name: string; position: number }): Promise<Floor> {
  return putJson(`${BASE}/floors/${id}`, body, { quiet: true });
}

export function createRoom(
  floorId: number,
  body: RoomRect & { name: string; description?: string },
): Promise<Floor> {
  return postJson(`${BASE}/floors/${floorId}/rooms`, body, { quiet: true });
}

/** Ohne ``description`` bleibt die Beschreibung, wie sie ist (z. B. beim Verschieben). */
export function updateRoom(
  id: number,
  body: RoomRect & { name: string; description?: string },
): Promise<Floor> {
  return putJson(`${BASE}/rooms/${id}`, body, { quiet: true });
}

export function deleteRoom(id: number): Promise<Floor> {
  return deleteJson(`${BASE}/rooms/${id}`, { quiet: true });
}

export function deletePlan(floorId: number): Promise<Floor> {
  return deleteJson(`${BASE}/floors/${floorId}/plan`, { quiet: true });
}

export const PLAN_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Dreht den Grundriss beim Anzeigen (im Uhrzeigersinn). */
export function rotatePlan(floorId: number, rotation: PlanRotation): Promise<Floor> {
  return putJson(`${BASE}/floors/${floorId}/plan/rotation`, { rotation }, { quiet: true });
}

// --- Drehung des Grundrisses ---------------------------------------------------------------
// Gespeichert wird immer in Prozent des ungedrehten Bilds; gedreht wird nur beim Anzeigen.

export type PlanRotation = 0 | 90 | 180 | 270;

export const PLAN_ROTATIONS: readonly PlanRotation[] = [0, 90, 180, 270];

type Point = { x: number; y: number };

/** Punkt des ungedrehten Bilds → Punkt in der Anzeige. */
export function pointToView(point: Point, rotation: PlanRotation): Point {
  switch (rotation) {
    case 90:
      return { x: 100 - point.y, y: point.x };
    case 180:
      return { x: 100 - point.x, y: 100 - point.y };
    case 270:
      return { x: point.y, y: 100 - point.x };
    default:
      return point;
  }
}

/** Punkt in der Anzeige → Punkt des ungedrehten Bilds (zum Speichern). */
export function pointToPlan(point: Point, rotation: PlanRotation): Point {
  switch (rotation) {
    case 90:
      return { x: point.y, y: 100 - point.x };
    case 180:
      return { x: 100 - point.x, y: 100 - point.y };
    case 270:
      return { x: 100 - point.y, y: point.x };
    default:
      return point;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rectThrough(a: Point, b: Point): RoomRect {
  const rect = rectFromPoints(a, b);
  return { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) };
}

/** Rechteck des ungedrehten Bilds → Rechteck in der Anzeige. */
export function rectToView(rect: RoomRect, rotation: PlanRotation): RoomRect {
  return rectThrough(
    pointToView({ x: rect.x, y: rect.y }, rotation),
    pointToView({ x: rect.x + rect.w, y: rect.y + rect.h }, rotation),
  );
}

/** Rechteck in der Anzeige → Rechteck des ungedrehten Bilds (zum Speichern). */
export function rectToPlan(rect: RoomRect, rotation: PlanRotation): RoomRect {
  return rectThrough(
    pointToPlan({ x: rect.x, y: rect.y }, rotation),
    pointToPlan({ x: rect.x + rect.w, y: rect.y + rect.h }, rotation),
  );
}

/** Lädt den Grundriss hoch; der Inhalt der Anfrage ist das Bild selbst. */
export async function uploadPlan(floorId: number, file: File): Promise<Floor> {
  const response = await fetch(`${BASE}/floors/${floorId}/plan`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "detail" in body) {
        const value = (body as { detail: unknown }).detail;
        detail = typeof value === "string" ? value : null;
      }
    } catch {
      // ohne Text
    }
    throw new ApiError(response.status, false, detail);
  }
  return (await response.json()) as Floor;
}

/** Rechteck auf 0–100 % begrenzen und auf zwei Stellen runden. */
export function clampRect(rect: RoomRect, min = 1): RoomRect {
  const round = (value: number) => Math.round(value * 100) / 100;
  const w = Math.min(100, Math.max(min, rect.w));
  const h = Math.min(100, Math.max(min, rect.h));
  const x = Math.min(100 - w, Math.max(0, rect.x));
  const y = Math.min(100 - h, Math.max(0, rect.y));
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Rechteck aus zwei Punkten (beim Aufziehen), unabhängig von der Richtung. */
export function rectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
): RoomRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export interface FloorHit {
  kind: "Stadt" | "Standort" | "Abschnitt" | "Etage" | "Raum";
  name: string;
  path: string;
  /** Ziel bei „Standorte“ */
  href: string;
}

/** Suche im Baum: Städte, Standorte, Abschnitte, Etagen und Räume (höchstens 12). */
export function searchLocations(tree: Locations, query: string): FloorHit[] {
  const needle = query.trim().toLocaleLowerCase("de");
  if (!needle) {
    return [];
  }
  const hits: FloorHit[] = [];
  const has = (value: string) => value.toLocaleLowerCase("de").includes(needle);
  for (const city of tree.cities) {
    if (has(city.name)) {
      hits.push({ kind: "Stadt", name: city.name, path: "", href: levelPath("stadt", city.id) });
    }
    for (const site of city.sites) {
      if (has(site.name)) {
        hits.push({
          kind: "Standort",
          name: site.name,
          path: city.name,
          href: levelPath("standort", site.id),
        });
      }
      for (const section of site.sections) {
        if (has(section.name)) {
          hits.push({
            kind: "Abschnitt",
            name: section.name,
            path: `${city.name} › ${site.name}`,
            href: levelPath("abschnitt", section.id),
          });
        }
        for (const floor of section.floors) {
          const where = `${site.name} › ${section.name}`;
          if (has(floor.name)) {
            hits.push({
              kind: "Etage",
              name: floor.name,
              path: where,
              href: locationPath(floor.id),
            });
          }
          for (const room of floor.rooms) {
            if (has(room.name)) {
              hits.push({
                kind: "Raum",
                name: room.name,
                path: `${where} › ${floor.name}`,
                href: locationPath(floor.id, room.id),
              });
            }
          }
        }
      }
    }
  }
  return hits.slice(0, 12);
}

export function firstFloorId(tree: Locations): number | null {
  for (const city of tree.cities) {
    for (const site of city.sites) {
      for (const section of site.sections) {
        const floor = section.floors[0];
        if (floor) {
          return floor.id;
        }
      }
    }
  }
  return null;
}

/** Raum als Eintrag für die Auswahl mit Suche (z. B. beim Bearbeiten eines Arbeitsplatzes). */
/** Standort eines Geräts als Eintrag für die Raumauswahl (wie die Suche ihn liefert). */
export function locationItem(location: DeviceLocation): LookupItem {
  return {
    id: location.room_id,
    label: `Raum ${location.room}`,
    detail: `${location.city} / ${location.site} / ${location.section} / ${location.floor}`,
    floor_id: location.floor_id,
  };
}

export function roomItem(tree: Locations, roomId: number | null): LookupItem | null {
  if (roomId === null) {
    return null;
  }
  for (const city of tree.cities) {
    for (const site of city.sites) {
      for (const section of site.sections) {
        for (const floor of section.floors) {
          const room = floor.rooms.find((entry) => entry.id === roomId);
          if (room) {
            return {
              id: room.id,
              label: `Raum ${room.name}`,
              detail: `${city.name} / ${site.name} / ${section.name} / ${floor.name}`,
              floor_id: floor.id,
            };
          }
        }
      }
    }
  }
  return null;
}

// --- Stellen und Arbeitsplätze ---------------------------------------------------------------

export interface Person {
  oid: string;
  name: string;
  upn: string;
  department?: string;
  job_title?: string;
  enabled?: boolean;
}

export interface PositionBrief {
  id: number;
  number: string;
  name: string;
  person_name: string;
}

export interface WorkplaceBrief {
  id: number;
  number: string;
  name: string;
  shared: boolean;
  place: string | null;
  pool?: boolean;
}

export interface PositionSummary {
  id: number;
  number: string;
  name: string;
  department_id: number | null;
  department: string;
  person: Person | null;
  workplaces: number;
  hardware: number;
  /** Standorte der Arbeitsplätze, z. B. „Haus Nord, Haus Süd“; leer ohne Arbeitsplatz */
  sites: string;
}

/** Hardware an einem Arbeitsplatz der Stelle (nicht direkt an der Stelle). */
export interface WorkplaceHardware {
  workplace: WorkplaceBrief;
  /** Wie viele Stellen den Arbeitsplatz nutzen */
  positions: number;
  devices: HardwareSummary[];
}

export interface Position extends PositionSummary {
  note: string;
  created_at: string;
  workplace_list: WorkplaceBrief[];
  /** Nur Hardware, die direkt an der Stelle hängt */
  hardware_list: HardwareSummary[];
  workplace_hardware: WorkplaceHardware[];
  events: HardwareEvent[];
}

export interface PositionInput {
  name: string;
  department_id: number | null;
  person: Person | null;
  note: string;
}

export interface EquipmentRow {
  label: string;
  need: number;
  have: number;
  kinds: string[];
  devices: string[];
}

export interface Equipment {
  kit: string;
  complete: boolean;
  missing: number;
  rows: EquipmentRow[];
}

export interface WorkplaceSummary {
  id: number;
  number: string;
  name: string;
  shared: boolean;
  /** Pool-Arbeitsplatz: absichtlich ohne Stelle, mit Zweck und freiwilliger Abteilung */
  pool: boolean;
  purpose_id: number | null;
  purpose: string | null;
  department_id: number | null;
  department: string | null;
  room_id: number | null;
  place: string | null;
  positions: PositionBrief[];
  kit_id: number | null;
  kit: string | null;
  /** null ohne Vorlage */
  complete: boolean | null;
  missing: number;
}

export interface Workplace extends WorkplaceSummary {
  note: string;
  location: DeviceLocation | null;
  /** Platz im Raum in Prozent des Raums; null = nicht gesetzt */
  spot_x: number | null;
  spot_y: number | null;
  created_at: string;
  hardware_list: HardwareSummary[];
  equipment: Equipment | null;
  events: HardwareEvent[];
}

export interface WorkplaceInput {
  room_id: number | null;
  shared: boolean;
  pool: boolean;
  purpose_id: number | null;
  department_id: number | null;
  kit_id: number | null;
  position_ids: number[];
  note: string;
}

export interface Assignees {
  positions: PositionBrief[];
  workplaces: WorkplaceBrief[];
}

export interface NumberRange {
  key: "stelle" | "arbeitsplatz" | "vorgang" | "verleih";
  label: string;
  prefix: string;
  next_number: string;
}

export type PositionTab = "uebersicht" | "arbeitsplaetze" | "standort" | "hardware" | "verlauf";

export const POSITION_TABS: { id: PositionTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "arbeitsplaetze", label: "Arbeitsplätze" },
  { id: "standort", label: "Standort" },
  { id: "hardware", label: "Hardware" },
  { id: "verlauf", label: "Verlauf" },
];

export type WorkplaceTab = "uebersicht" | "ausstattung" | "hardware" | "standort" | "verlauf";

export const WORKPLACE_TABS: { id: WorkplaceTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "ausstattung", label: "Ausstattung" },
  { id: "hardware", label: "Hardware" },
  { id: "standort", label: "Standort" },
  { id: "verlauf", label: "Verlauf" },
];

function detailPath(base: string, id: number, tab: string): string {
  return tab === "uebersicht" ? `${base}/${id}` : `${base}/${id}/${tab}`;
}

function parseDetailPath<T extends string>(
  base: string,
  path: string,
  tabs: readonly { id: T }[],
): { id: number; tab: T } | null {
  if (!path.startsWith(`${base}/`)) {
    return null;
  }
  const match = /^(\d{1,9})(?:\/([a-z]{1,20}))?$/.exec(path.slice(base.length + 1));
  if (!match) {
    return null;
  }
  const tab = (match[2] ?? "uebersicht") as T;
  if (!tabs.some((entry) => entry.id === tab) || (match[2] && tab === "uebersicht")) {
    return null;
  }
  return { id: Number(match[1]), tab };
}

export function positionPath(id: number, tab: PositionTab = "uebersicht"): string {
  return detailPath(INVENTORY_POSITIONS_PATH, id, tab);
}

export function parsePositionPath(path: string): { id: number; tab: PositionTab } | null {
  return parseDetailPath(INVENTORY_POSITIONS_PATH, path, POSITION_TABS);
}

export function workplacePath(id: number, tab: WorkplaceTab = "uebersicht"): string {
  return detailPath(INVENTORY_WORKPLACES_PATH, id, tab);
}

export function parseWorkplacePath(path: string): { id: number; tab: WorkplaceTab } | null {
  return parseDetailPath(INVENTORY_WORKPLACES_PATH, path, WORKPLACE_TABS);
}

export function searchPeople(query: string): Promise<Person[]> {
  return getJson(`${BASE}/people?q=${encodeURIComponent(query)}`);
}

export interface PageOf<T> {
  items: T[];
  total: number;
}

export function fetchPositions(
  query = "",
  offset = 0,
  limit = PAGE_SIZE,
): Promise<PageOf<PositionSummary>> {
  return getJson(`${BASE}/positions?${listQuery({}, query, offset, limit)}`);
}

export function fetchPosition(id: number): Promise<Position> {
  return getJson(`${BASE}/positions/${id}`);
}

export function createPosition(body: PositionInput): Promise<Position> {
  return postJson(`${BASE}/positions`, body, { quiet: true });
}

export function updatePosition(id: number, body: PositionInput): Promise<Position> {
  return putJson(`${BASE}/positions/${id}`, body, { quiet: true });
}

export function deletePosition(id: number): Promise<{ id: number }> {
  return deleteJson(`${BASE}/positions/${id}`, { quiet: true });
}

export function fetchWorkplaces(
  filter: WorkplaceFilter = "alle",
  query = "",
  offset = 0,
  limit = PAGE_SIZE,
): Promise<PageOf<WorkplaceSummary>> {
  const base: Record<string, string> = filter === "alle" ? {} : { filter };
  return getJson(`${BASE}/workplaces?${listQuery(base, query, offset, limit)}`);
}

export function fetchWorkplace(id: number): Promise<Workplace> {
  return getJson(`${BASE}/workplaces/${id}`);
}

/** Neuer Arbeitsplatz: Raum ist Pflicht, der Platz im Grundriss freiwillig (Prozent des Raums). */
export interface WorkplaceNew extends WorkplaceInput {
  spot_x?: number | null;
  spot_y?: number | null;
}

export function createWorkplace(body: WorkplaceNew): Promise<Workplace> {
  return postJson(`${BASE}/workplaces`, body, { quiet: true });
}

export function updateWorkplace(id: number, body: WorkplaceInput): Promise<Workplace> {
  return putJson(`${BASE}/workplaces/${id}`, body, { quiet: true });
}

/** Platz im Raum setzen (Prozent des Raums) oder mit null entfernen. */
export function setWorkplaceSpot(
  id: number,
  spot: { x: number; y: number } | null,
): Promise<Workplace> {
  return putJson(`${BASE}/workplaces/${id}/spot`, spot ?? { x: null, y: null }, { quiet: true });
}

export type PlaceKind = "stelle" | "arbeitsplatz" | "geraet";

export interface PlaceInfo {
  /** beim Gerät: woher der Ort kommt, wenn es keinen eigenen Raum hat */
  via: { kind: "stelle" | "arbeitsplatz"; id: number; label: string } | null;
  floors: { floor_id: number; rooms: DeviceLocation[]; workplace_ids: number[] }[];
}

export function fetchPlaceInfo(kind: PlaceKind, id: number): Promise<PlaceInfo> {
  return getJson(`${BASE}/whereabouts/${kind}/${id}`);
}

/** Punkt in Prozent der Etage → Prozent im Raum; null, wenn er außerhalb des Raums liegt. */
export function spotInRoom(
  point: { x: number; y: number },
  room: RoomRect,
): { x: number; y: number } | null {
  if (room.w <= 0 || room.h <= 0) {
    return null;
  }
  const x = ((point.x - room.x) / room.w) * 100;
  const y = ((point.y - room.y) / room.h) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) {
    return null;
  }
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** „Raum 2.14 · 1. OG · Abschnitt A · Verwaltung Nord · Beispielstadt“ */
export function placeLine(location: DeviceLocation): string {
  return [
    `Raum ${location.room}`,
    location.floor,
    location.section,
    location.site,
    location.city,
  ].join(" · ");
}

export function deleteWorkplace(id: number): Promise<{ id: number }> {
  return deleteJson(`${BASE}/workplaces/${id}`, { quiet: true });
}

export function fetchAssignees(): Promise<Assignees> {
  return getJson(`${BASE}/assignees`);
}

export function fetchNumberRanges(): Promise<NumberRange[]> {
  return getJson(`${BASE}/number-ranges`);
}

export function updateNumberRange(key: NumberRange["key"], prefix: string): Promise<NumberRange[]> {
  return putJson(`${BASE}/number-ranges/${key}`, { prefix }, { quiet: true });
}

/** Eingaben eines Arbeitsplatzes aus seinem aktuellen Stand, z. B. vor einer Änderung. */
/** Art eines Arbeitsplatzes für Listen: „Pool“, „geteilt“ oder „einzeln“. */
export function workplaceKind(entry: Pick<WorkplaceSummary, "pool" | "shared">): string {
  return entry.pool ? "Pool" : entry.shared ? "geteilt" : "einzeln";
}

export function workplaceInput(workplace: WorkplaceSummary & { note?: string }): WorkplaceInput {
  return {
    room_id: workplace.room_id,
    shared: workplace.shared,
    pool: workplace.pool,
    purpose_id: workplace.purpose_id,
    department_id: workplace.department_id,
    kit_id: workplace.kit_id,
    position_ids: workplace.positions.map((entry) => entry.id),
    note: workplace.note ?? "",
  };
}

export type WorkplaceFilter = "alle" | "einzeln" | "geteilt" | "pool" | "frei" | "unvollstaendig";

export const WORKPLACE_FILTERS: { id: WorkplaceFilter; label: string }[] = [
  { id: "alle", label: "Alle" },
  { id: "einzeln", label: "Einzeln" },
  { id: "geteilt", label: "Geteilt" },
  { id: "pool", label: "Pool" },
  { id: "frei", label: "Frei" },
  { id: "unvollstaendig", label: "Ausstattung fehlt" },
];

/** Text zur Ausstattung, z. B. „vollständig“, „2 fehlen“ oder „keine Vorlage“. */
export function equipmentLabel(entry: Pick<WorkplaceSummary, "complete" | "missing">): string {
  if (entry.complete === null) {
    return "keine Vorlage";
  }
  if (entry.complete) {
    return "vollständig";
  }
  return entry.missing === 1 ? "1 fehlt" : `${entry.missing} fehlen`;
}

/** Arbeitsplätze heißen nach ihrer Nummer; der Raum steht jeweils daneben. */
export function workplaceName(entry: Pick<WorkplaceSummary, "number">): string {
  return entry.number;
}

// --- Ausstattungsvorlagen ---------------------------------------------------------------------

export interface DraftRow {
  label: string;
  count: string;
  kindIds: number[];
}

export function draftRows(rows: KitRow[]): DraftRow[] {
  return rows.map((row) => ({ label: row.label, count: String(row.count), kindIds: row.kind_ids }));
}

/** Prüft eine Vorlage; liefert einen Fehlertext oder die Zeilen zum Speichern. */
export function kitProblem(name: string, rows: DraftRow[]): string | KitRow[] {
  if (!name.trim()) {
    return "Bitte trag einen Namen für die Vorlage ein.";
  }
  if (rows.length === 0) {
    return "Eine Vorlage braucht mindestens eine Zeile.";
  }
  const result: KitRow[] = [];
  for (const [index, row] of rows.entries()) {
    const count = Number(row.count);
    if (!row.label.trim()) {
      return `Zeile ${index + 1}: Bitte trag eine Bezeichnung ein.`;
    }
    if (row.kindIds.length === 0) {
      return `Zeile ${index + 1}: Bitte wähle mindestens eine passende Hardware-Art.`;
    }
    if (!Number.isInteger(count) || count < 1 || count > 9) {
      return `Zeile ${index + 1}: Die Anzahl muss zwischen 1 und 9 liegen.`;
    }
    result.push({ label: row.label.trim(), count, kind_ids: row.kindIds });
  }
  return result;
}

// --- NinjaOne und Vorgänge ----------------------------------------------------------------------

export interface NinjaSettings {
  enabled: boolean;
  region: string;
  client_id: string;
  secret_set: boolean;
  secret_storage_available: boolean;
  regions: { id: string; name: string; host: string }[];
  /** Auswahl für neue Geräte; leer heißt: alle */
  organization_ids: number[];
  role_ids: number[];
  /** interner Name des Custom Fields mit den Monitoren; leer: keine Monitore */
  monitor_field: string;
}

export interface NinjaUpdate {
  enabled: boolean;
  region: string;
  client_id: string;
  organization_ids: number[];
  role_ids: number[];
  monitor_field: string;
  /** Weglassen: bleibt. Leerer Text: löschen. */
  client_secret?: string;
}

export interface NinjaTest {
  devices: number;
  notebooks: number;
  pcs: number;
  /** davon in der gespeicherten Auswahl */
  in_scope: number;
  /** Monitore im Custom Field */
  monitors: number;
}

export interface NinjaOptions {
  organizations: { id: number; name: string }[];
  roles: { id: number; name: string }[];
}

export function fetchNinjaOptions(): Promise<NinjaOptions> {
  return postJson(`${NINJA_ADMIN}/options`, undefined, { quiet: true });
}

const NINJA_ADMIN = "/api/admin/settings/ninjaone";

export function fetchNinjaSettings(): Promise<NinjaSettings> {
  return getJson(NINJA_ADMIN);
}

export function saveNinjaSettings(update: NinjaUpdate): Promise<NinjaSettings> {
  return putJson(NINJA_ADMIN, update);
}

export function testNinja(): Promise<NinjaTest> {
  return postJson(`${NINJA_ADMIN}/test`);
}

/** Kenndaten aus NinjaOne am Gerät (Stand des letzten Abgleichs). */
export interface NinjaFacts {
  hostname?: string;
  serial?: string;
  kind?: string;
  maker?: string;
  model?: string;
  os?: string;
  ip?: string[];
  last_contact?: string | null;
  ram_gb?: number | null;
  policy?: string;
  organization?: string;
  role?: string;
  name?: string;
  maker_code?: string;
  product_code?: string;
  built?: string;
  connector?: string;
  monitor_seen?: string;
  host?: string;
  host_id?: number;
  suggest_workplace_id?: number | null;
  last_seen?: string | null;
  ninja_id?: number;
  /** Vorgänge zum Verleih */
  loan_id?: number;
  loan_number?: string;
  devices?: string[];
  person?: string;
  due_on?: string;
  /** Vorgang „Person nicht mehr aktiv“ */
  person_oid?: string;
  upn?: string;
  reason?: "deaktiviert" | "geloescht";
  position_id?: number;
  position_number?: string;
  position_name?: string;
}

export interface NinjaInfo {
  /** null bei Monitoren aus dem Custom Field */
  ninja_id: number | null;
  facts: NinjaFacts;
  seen_at: string | null;
  missing_since: string | null;
}

export type CaseState = "neu" | "arbeit" | "fertig";
export type CaseKind = "neu" | "weg" | "monitor" | "rueckgabe" | "ueberfaellig" | "person_inaktiv";

export interface LinkedDevice {
  id: number;
  name: string;
  hostname: string;
  serial: string;
  status: HardwareStatus;
}

export interface CaseSummary {
  id: number;
  number: string;
  kind: CaseKind;
  kind_label: string;
  status: CaseState;
  title: string;
  created_at: string;
  assignee: string | null;
}

export interface HardwareRef {
  id: number;
  name: string;
  hostname: string;
  serial: string;
  status: HardwareStatus;
}

export interface Case extends CaseSummary {
  facts: NinjaFacts;
  decision: string;
  decision_label: string;
  closed_at: string | null;
  hardware: HardwareRef | null;
  hint: HardwareRef | null;
  events: HardwareEvent[];
}

export interface CaseList {
  cases: CaseSummary[];
  open: number;
  /** Treffer insgesamt (Status und Suche) */
  total: number;
}

export type CaseFilter = "offen" | "neu" | "arbeit" | "fertig" | "alle";

export const CASE_FILTERS: { id: CaseFilter; label: string }[] = [
  { id: "offen", label: "Offen" },
  { id: "neu", label: "Neu" },
  { id: "arbeit", label: "In Bearbeitung" },
  { id: "fertig", label: "Fertig" },
  { id: "alle", label: "Alle" },
];

export const CASE_STATES: Record<CaseState, { label: string; pill: string }> = {
  neu: { label: "Neu", pill: "pill-info" },
  arbeit: { label: "In Bearbeitung", pill: "pill-todo" },
  fertig: { label: "Fertig", pill: "pill-ok" },
};

export interface DecisionOption {
  id: string;
  label: string;
  hint: string;
  /** Nur für Vorgänge zu einer Stelle oder zu einem Verleih */
  only?: "stelle" | "verleih";
  /** Überschrift der Gruppe, wenn die Möglichkeiten gruppiert stehen */
  group?: string;
}

const ASSIGN = "Zuordnen";
const UNASSIGNED = "Ohne Zuordnung";
const NOT_NEW = "Nicht neu anlegen";

export const DECISION_OPTIONS: Record<CaseKind, DecisionOption[]> = {
  neu: [
    {
      id: "stelle",
      label: "Einer Stelle zuordnen",
      hint: "Das Gerät gehört dann zur Stelle.",
      group: ASSIGN,
    },
    {
      id: "arbeitsplatz",
      label: "Einem Arbeitsplatz zuordnen",
      hint: "Zum Beispiel ein fester PC am Platz.",
      group: ASSIGN,
    },
    {
      id: "lager",
      label: "Ins Lager",
      hint: "Nicht zugeordnet, auf Wunsch mit Raum.",
      group: UNASSIGNED,
    },
    {
      id: "gleich",
      label: "Ist dasselbe Gerät",
      hint: "Ein Gerät im Bestand übernimmt den Eintrag aus NinjaOne, z. B. nach einem Mainboardtausch.",
      group: NOT_NEW,
    },
    {
      id: "uebergehen",
      label: "Nicht in den Bestand aufnehmen",
      hint: "Zum Beispiel ein Testgerät. Der Abgleich meldet es nicht wieder.",
      group: NOT_NEW,
    },
  ],
  monitor: [
    {
      id: "arbeitsplatz",
      label: "Am Arbeitsplatz anlegen",
      hint: "Der Monitor bleibt am Schreibtisch, auch wenn das Notebook woanders ist.",
      group: ASSIGN,
    },
    {
      id: "stelle",
      label: "Der Stelle zuordnen",
      hint: "Wenn der Monitor mit dem Notebook mitgeht, zum Beispiel ein mobiler Monitor.",
      group: ASSIGN,
    },
    {
      id: "uebergehen",
      label: "Nicht übernehmen",
      hint: "Der Monitor wird nicht erfasst und beim nächsten Abgleich nicht wieder gemeldet.",
      group: NOT_NEW,
    },
  ],
  rueckgabe: [
    {
      id: "lager",
      label: "Geprüft, zurück ins Lager",
      hint: "Alles in Ordnung; auf Wunsch mit Raum. Danach kannst du es wieder verleihen.",
    },
    {
      id: "defekt",
      label: "Defekt oder unvollständig",
      hint: "Steht im Verlauf der Geräte. Reparieren oder ausmustern kannst du danach.",
    },
  ],
  person_inaktiv: [
    {
      id: "frei",
      label: "Stelle frei machen",
      hint: "Die Person wird aus der Stelle entfernt. Die Geräte bleiben an der Stelle.",
      only: "stelle",
    },
    {
      id: "nachfolge",
      label: "Neue Person eintragen",
      hint: "Die Stelle bekommt eine neue Person aus Entra.",
      only: "stelle",
    },
    {
      id: "lassen",
      label: "Erst mal so lassen",
      hint: "Die Person bleibt eingetragen, zum Beispiel in der Elternzeit.",
      only: "stelle",
    },
    {
      id: "geklaert",
      label: "Geklärt",
      hint: "Die Rückgabe trägst du beim Verleih ein; dann schließt sich der Vorgang selbst.",
      only: "verleih",
    },
  ],
  ueberfaellig: [
    {
      id: "verlaengert",
      label: "Rückgabe verlängern",
      hint: "Neues Datum; die Erinnerungen richten sich danach.",
    },
    {
      id: "geklaert",
      label: "Geklärt",
      hint: "Zum Beispiel mit der Person gesprochen. Die Rückgabe trägst du beim Verleih ein.",
    },
  ],
  weg: [
    {
      id: "ausgemustert",
      label: "Gerät ist ausgemustert",
      hint: "Erst das Gerät ausmustern (mit Grund und Verbleib), dann hier abschließen.",
    },
    {
      id: "verloren",
      label: "Verloren oder gestohlen",
      hint: "Steht im Verlauf des Geräts; ausmustern kannst du es später.",
    },
    {
      id: "pruefen",
      label: "Prüfen, der Agent fehlt vielleicht nur",
      hint: "Gerät bleibt im Bestand. Taucht es wieder auf, schließt sich der Vorgang.",
    },
  ],
};

export interface DecisionInput {
  decision: string;
  position_id?: number;
  workplace_id?: number;
  room_id?: number;
  hardware_id?: number;
  /** bei „verlaengert“: neues Rückgabedatum (JJJJ-MM-TT) */
  due_on?: string;
  /** bei „nachfolge“: neue Person (Objekt-ID aus Entra) */
  person_oid?: string;
}

export interface SyncRun {
  started_at: string;
  finished_at: string | null;
  status: "ok" | "fehlgeschlagen";
  devices: number;
  updated: number;
  new_cases: number;
  missing_cases: number;
  error: string;
}

export interface SyncStatus {
  enabled: boolean;
  interval_minutes: number;
  last_run: SyncRun | null;
  next_run_at: string | null;
}

export function casePath(id: number): string {
  return `${INVENTORY_CASES_PATH}/${id}`;
}

export function parseCasePath(path: string): { id: number | null } | null {
  if (path === INVENTORY_CASES_PATH) {
    return { id: null };
  }
  const match = /^\/bestand\/vorgaenge\/(\d{1,9})$/.exec(path);
  return match ? { id: Number(match[1]) } : null;
}

/** Einträge je Seite in den seitenweisen Listen (Hardware, Stellen, Arbeitsplätze, Vorgänge, Verleih) */
export const PAGE_SIZE = 50;

function pageQuery(filter: string, query: string, offset: number, limit: number): string {
  return listQuery({ state: filter }, query, offset, limit);
}

/** Suche und Seite als Abfrage, dazu feste Filter wie ``state``. */
function listQuery(
  base: Record<string, string>,
  query: string,
  offset: number,
  limit: number,
): string {
  const params = new URLSearchParams(base);
  if (query.trim()) {
    params.set("q", query.trim().slice(0, 100));
  }
  if (offset > 0) {
    params.set("offset", String(offset));
  }
  if (limit !== PAGE_SIZE) {
    params.set("limit", String(limit));
  }
  return params.toString();
}

export function fetchCases(
  filter: CaseFilter,
  query = "",
  offset = 0,
  limit = PAGE_SIZE,
  kind: CaseKind | "alle" = "alle",
): Promise<CaseList> {
  const params = pageQuery(filter, query, offset, limit);
  return getJson(`${BASE}/cases?${params}${kind === "alle" ? "" : `&kind=${kind}`}`);
}

// --- Suche für Auswahlfelder --------------------------------------------------------------

export type LookupKind = "position" | "workplace" | "room" | "hardware";

export interface LookupItem {
  id: number;
  label: string;
  detail: string;
  /** nur bei Räumen: Etage für den Grundriss */
  floor_id?: number | null;
}

export interface LookupResult {
  items: LookupItem[];
  total: number;
}

/** Höchstens 20 Treffer für ein Auswahlfeld; `computers` nur Notebooks und PCs. */
export function lookup(
  kind: LookupKind,
  query: string,
  options: { computers?: boolean } = {},
): Promise<LookupResult> {
  const params = new URLSearchParams({ kind });
  if (query.trim()) {
    params.set("q", query.trim().slice(0, 100));
  }
  if (options.computers) {
    params.set("computers", "true");
  }
  return getJson(`${BASE}/lookup?${params.toString()}`);
}

export function fetchCase(id: number): Promise<Case> {
  return getJson(`${BASE}/cases/${id}`);
}

export function takeCase(id: number): Promise<Case> {
  return postJson(`${BASE}/cases/${id}/take`, undefined, { quiet: true });
}

export function setCaseStatus(id: number, state: "neu" | "arbeit"): Promise<Case> {
  return postJson(`${BASE}/cases/${id}/status`, { status: state }, { quiet: true });
}

export function addCaseNote(id: number, text: string): Promise<Case> {
  return postJson(`${BASE}/cases/${id}/note`, { text }, { quiet: true });
}

export function decideCase(id: number, body: DecisionInput): Promise<Case> {
  return postJson(`${BASE}/cases/${id}/decide`, body, { quiet: true });
}

export function fetchSyncStatus(): Promise<SyncStatus> {
  return getJson(`${BASE}/ninjaone/status`);
}

export function runSyncNow(): Promise<{ scheduled_at: string }> {
  return postJson(`${BASE}/ninjaone/run`, undefined, { quiet: true });
}

/** Kenndaten aus NinjaOne als Liste für die Anzeige; leere Werte fallen weg. */
export function ninjaFactRows(
  facts: NinjaFacts,
): { label: string; value: string; mono?: boolean }[] {
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  const add = (label: string, value: string | null | undefined, mono = false) => {
    if (value) {
      rows.push({ label, value, mono });
    }
  };
  add("Hostname", facts.hostname, true);
  add("Seriennummer", facts.serial, true);
  add("Typ laut NinjaOne", facts.kind);
  add("Hersteller und Modell", [facts.maker, facts.model].filter(Boolean).join(" "));
  add("Product Code", facts.product_code, true);
  add("Baujahr", facts.built);
  add("Anschluss", facts.connector);
  add("Angeschlossen an", facts.host, true);
  add("Zuletzt gesehen (Skript)", facts.monitor_seen ? formatDate(facts.monitor_seen) : "");
  add("Betriebssystem", facts.os);
  add("IP-Adresse", (facts.ip ?? []).join(", "), true);
  add("Arbeitsspeicher", facts.ram_gb ? `${facts.ram_gb} GB` : "");
  add("Organisation", facts.organization);
  add("Geräterolle", facts.role);
  add("Richtlinie", facts.policy);
  add("Zuletzt online", facts.last_contact ? formatDate(facts.last_contact) : "");
  add("Bezeichnung im Bestand", facts.name);
  add("Zuletzt in NinjaOne", facts.last_seen ? formatDate(facts.last_seen) : "");
  return rows;
}

// --- Verleih ------------------------------------------------------------------------------

export type LoanState = "geplant" | "offen" | "ueberfaellig" | "zurueck";
export type LoanFilter = "offen" | "geplant" | "ueberfaellig" | "zurueck" | "alle";

export interface LoanRef {
  id: number;
  number: string;
  person_name: string;
  due_on: string;
}

export interface LoanSummary {
  id: number;
  number: string;
  person_name: string;
  issued_on: string;
  due_on: string;
  returned_on: string | null;
  state: LoanState;
  items: number;
  items_open: number;
}

export interface LoanItem {
  hardware_id: number;
  name: string;
  kind: string;
  serial: string;
  inventory_no: string | null;
  returned_on: string | null;
}

export type LoanMessageStatus = "offen" | "gesendet" | "fehler" | "aus";

export interface LoanMessage {
  kind: string;
  kind_label: string;
  channel: "mail" | "teams";
  status: LoanMessageStatus;
  created_at: string;
  sent_at: string | null;
}

export interface Loan extends LoanSummary {
  person_upn: string;
  has_address: boolean;
  note: string;
  created_at: string;
  entries: LoanItem[];
  messages: LoanMessage[];
  cases: { id: number; number: string; kind: CaseKind; status: CaseState }[];
}

export interface LoanList {
  loans: LoanSummary[];
  open: number;
  overdue: number;
  /** Treffer insgesamt (Status und Suche) */
  total: number;
}

export interface LoanableDevice {
  id: number;
  name: string;
  kind: string;
  serial: string;
  inventory_no: string | null;
}

export interface LoanInput {
  person: { oid: string };
  /** Beginn; später als heute plant den Verleih vor (Geräte reserviert). */
  start_on: string;
  due_on: string;
  hardware_ids: number[];
  note: string;
}

export const LOAN_FILTERS: { id: LoanFilter; label: string }[] = [
  { id: "offen", label: "Ausgeliehen" },
  { id: "geplant", label: "Geplant" },
  { id: "ueberfaellig", label: "Überfällig" },
  { id: "zurueck", label: "Zurück" },
  { id: "alle", label: "Alle" },
];

export const LOAN_STATES: Record<LoanState, { label: string; pill: string }> = {
  geplant: { label: "Geplant", pill: "pill-neutral" },
  offen: { label: "Ausgeliehen", pill: "pill-info" },
  ueberfaellig: { label: "Überfällig", pill: "pill-bad" },
  zurueck: { label: "Zurück", pill: "pill-ok" },
};

export const MESSAGE_STATES: Record<LoanMessageStatus, string> = {
  offen: "wird verschickt",
  gesendet: "verschickt",
  fehler: "fehlgeschlagen",
  aus: "nicht verschickt",
};

export function loanPath(id: number | "neu"): string {
  return `${INVENTORY_LOANS_PATH}/${id}`;
}

export function parseLoanPath(path: string): { id: number | "neu" | null } | null {
  if (path === INVENTORY_LOANS_PATH) {
    return { id: null };
  }
  if (path === `${INVENTORY_LOANS_PATH}/neu`) {
    return { id: "neu" };
  }
  const match = /^\/bestand\/verleih\/(\d{1,9})$/.exec(path);
  return match ? { id: Number(match[1]) } : null;
}

export function fetchLoans(
  filter: LoanFilter,
  query = "",
  offset = 0,
  limit = PAGE_SIZE,
): Promise<LoanList> {
  return getJson(`${BASE}/loans?${pageQuery(filter, query, offset, limit)}`);
}

export function fetchLoan(id: number): Promise<Loan> {
  return getJson(`${BASE}/loans/${id}`);
}

export function fetchLoanable(): Promise<LoanableDevice[]> {
  return getJson(`${BASE}/loans/available`);
}

export function createLoan(body: LoanInput): Promise<Loan> {
  return postJson(`${BASE}/loans`, body, { quiet: true });
}

export function returnLoanItems(id: number, hardwareIds: number[]): Promise<Loan> {
  return postJson(`${BASE}/loans/${id}/return`, { hardware_ids: hardwareIds }, { quiet: true });
}

export function changeLoanDue(id: number, dueOn: string): Promise<Loan> {
  return putJson(`${BASE}/loans/${id}/due`, { due_on: dueOn }, { quiet: true });
}

/** Datum in einigen Tagen als JJJJ-MM-TT (lokale Zeit). */
export function daysFrom(start: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = start.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return today(date);
}

/** Ein Gerät passt zur Suche, wenn Name, Art, Seriennummer oder Inventurnummer passen. */
export function filterLoanable(list: LoanableDevice[], query: string): LoanableDevice[] {
  const term = query.trim().toLowerCase();
  if (!term) {
    return list;
  }
  return list.filter((item) =>
    [item.name, item.kind, item.serial, item.inventory_no ?? ""].some((value) =>
      value.toLowerCase().includes(term),
    ),
  );
}

/** Möglichkeiten nach Gruppe, in der Reihenfolge des ersten Auftretens; ohne Gruppen eine Gruppe. */
export function groupOptions(
  options: DecisionOption[],
): { title: string; options: DecisionOption[] }[] {
  const groups: { title: string; options: DecisionOption[] }[] = [];
  for (const option of options) {
    const title = option.group ?? "";
    const group = groups.find((entry) => entry.title === title);
    if (group) {
      group.options.push(option);
    } else {
      groups.push({ title, options: [option] });
    }
  }
  return groups;
}

/** Entscheidungen, die zu diesem Vorgang passen (bei „Person nicht mehr aktiv“: Stelle oder Verleih). */
export function decisionOptions(entry: { kind: CaseKind; facts: NinjaFacts }): DecisionOption[] {
  const context = entry.facts.loan_id !== undefined ? "verleih" : "stelle";
  return DECISION_OPTIONS[entry.kind].filter((option) => !option.only || option.only === context);
}

export const CASE_KIND_SHORT: Record<CaseKind, string> = {
  neu: "Neues Gerät",
  weg: "Gerät fehlt",
  monitor: "Neuer Monitor",
  rueckgabe: "Rückgabe prüfen",
  ueberfaellig: "Verleih überfällig",
  person_inaktiv: "Person nicht mehr aktiv",
};

// --- Statistik ----------------------------------------------------------------------------

export interface StatCount {
  label: string;
  count: number;
  /** Wert für den Filter, wenn ein Klick auf den Balken die Seite filtert */
  value?: number | null;
  /** hervorheben (z. B. Betriebssystem ohne Support); steht immer auch im Text */
  warn?: boolean;
}

export type StatFilterKey = "maker" | "kind" | "site" | "department";

export interface StatChart {
  key: string;
  title: string;
  items: StatCount[];
  filter: StatFilterKey | null;
  note: string;
  unit: string;
}

export interface StatSection {
  key: string;
  title: string;
  intro: string;
  charts: StatChart[];
}

export interface StatOption {
  /** 0 = ohne */
  id: number;
  name: string;
  count: number;
}

export interface StatFilters {
  maker: number | null;
  kind: number | null;
  site: number | null;
  department: number | null;
}

export interface InventoryStatistics {
  makers: StatOption[];
  kinds: StatOption[];
  sites: StatOption[];
  departments: StatOption[];
  maker_id: number | null;
  kind_id: number | null;
  site_id: number | null;
  department_id: number | null;
  year_label: string;
  kpis: {
    total: number;
    new_this_month: number;
    free: number;
    loans_open: number;
    loans_overdue: number;
    /** null: für keine Art ist eine Nutzungsdauer eingetragen */
    renewal_due: number | null;
    workplaces_gap: number;
    missing: number;
  };
  sections: StatSection[];
}

export function statisticsQuery(filters: StatFilters): string {
  const params = new URLSearchParams();
  for (const key of ["maker", "kind", "site", "department"] as const) {
    const value = filters[key];
    if (value !== null) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchInventoryStatistics(filters: StatFilters): Promise<InventoryStatistics> {
  return getJson(`${BASE}/statistics${statisticsQuery(filters)}`);
}

export function setKindLifetime(kindId: number, years: number | null): Promise<MasterData> {
  return putJson(`${BASE}/kinds/${kindId}/lifetime`, { years });
}

/** „2026-03“ → „03/26“ */
export function monthLabel(value: string): string {
  const [year = "", month = ""] = value.split("-");
  return `${month}/${year.slice(2)}`;
}

/** Anteil in Prozent, gerundet; „<1 %“ für kleine Anteile. */
export function percentText(count: number, total: number): string {
  if (total <= 0) {
    return "0 %";
  }
  const value = (count / total) * 100;
  return value > 0 && value < 1 ? "<1 %" : `${Math.round(value)} %`;
}

/** Höchstens ``max`` Stücke für das Kreisdiagramm; der Rest als „Andere“. */
export function pieSlices(items: StatCount[], max = 8): StatCount[] {
  if (items.length <= max) {
    return items;
  }
  const head = items.slice(0, max - 1);
  const rest = items.slice(max - 1).reduce((sum, item) => sum + item.count, 0);
  const other = head.find((item) => item.label === "Andere");
  if (other) {
    return head.map((item) => (item === other ? { ...item, count: item.count + rest } : item));
  }
  return [...head, { label: "Andere", count: rest }];
}
