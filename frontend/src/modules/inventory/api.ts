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
  /** Technische Daten des Modells aus Lenovo PSREF; null, wenn nie abgefragt */
  psref: PsrefInfo | null;
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

export interface MasterData {
  kinds: Kind[];
  makers: Maker[];
  reasons: Reason[];
  departments: Department[];
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

export function fetchHardwareList(state: ListState): Promise<HardwareSummary[]> {
  return getJson(`${BASE}/hardware?state=${state}`);
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

export function refreshPsref(id: number): Promise<Hardware> {
  return postJson(`${BASE}/hardware/${id}/psref`, {}, { quiet: true });
}

export function reactivateHardware(id: number): Promise<Hardware> {
  return postJson(`${BASE}/hardware/${id}/reactivate`, {}, { quiet: true });
}

export function fetchMasterData(): Promise<MasterData> {
  return getJson(`${BASE}/master-data`);
}

export type MasterKind = "kinds" | "makers" | "reasons" | "departments";

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
export function filterHardware(
  list: readonly HardwareSummary[],
  query: string,
  kindId: number | null,
): HardwareSummary[] {
  const needle = query.trim().toLocaleLowerCase("de");
  return list.filter((device) => {
    if (kindId !== null && device.kind_id !== kindId) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return [
      device.name,
      device.kind,
      device.maker ?? "",
      device.model ?? "",
      device.serial,
      device.inventory_no ?? "",
      device.hostname,
      device.place ?? "",
      device.holder ?? "",
    ].some((value) => value.toLocaleLowerCase("de").includes(needle));
  });
}

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
  x: number;
  y: number;
  w: number;
  h: number;
  hardware: number;
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
  plan: { url: string; width: number; height: number } | null;
  rooms: Room[];
}

/** Etage und Raum aus dem Pfad, z. B. „/bestand/standorte/etage/4/raum/9“. */
export function parseLocationPath(
  path: string,
): { floorId: number | null; roomId: number | null } | null {
  if (path === INVENTORY_LOCATIONS_PATH) {
    return { floorId: null, roomId: null };
  }
  const match = /^\/bestand\/standorte\/etage\/(\d{1,9})(?:\/raum\/(\d{1,9}))?$/.exec(path);
  if (!match) {
    return null;
  }
  return { floorId: Number(match[1]), roomId: match[2] ? Number(match[2]) : null };
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

export function createRoom(floorId: number, body: RoomRect & { name: string }): Promise<Floor> {
  return postJson(`${BASE}/floors/${floorId}/rooms`, body, { quiet: true });
}

export function updateRoom(id: number, body: RoomRect & { name: string }): Promise<Floor> {
  return putJson(`${BASE}/rooms/${id}`, body, { quiet: true });
}

export function deleteRoom(id: number): Promise<Floor> {
  return deleteJson(`${BASE}/rooms/${id}`, { quiet: true });
}

export function deletePlan(floorId: number): Promise<Floor> {
  return deleteJson(`${BASE}/floors/${floorId}/plan`, { quiet: true });
}

export const PLAN_TYPES = ["image/png", "image/jpeg", "image/webp"];

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
  floorId: number;
  roomId: number | null;
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
    const firstFloor = city.sites[0]?.sections[0]?.floors[0];
    if (has(city.name) && firstFloor) {
      hits.push({ kind: "Stadt", name: city.name, path: "", floorId: firstFloor.id, roomId: null });
    }
    for (const site of city.sites) {
      const siteFloor = site.sections[0]?.floors[0];
      if (has(site.name) && siteFloor) {
        hits.push({
          kind: "Standort",
          name: site.name,
          path: city.name,
          floorId: siteFloor.id,
          roomId: null,
        });
      }
      for (const section of site.sections) {
        const sectionFloor = section.floors[0];
        if (has(section.name) && sectionFloor) {
          hits.push({
            kind: "Abschnitt",
            name: section.name,
            path: `${city.name} › ${site.name}`,
            floorId: sectionFloor.id,
            roomId: null,
          });
        }
        for (const floor of section.floors) {
          const where = `${site.name} › ${section.name}`;
          if (has(floor.name)) {
            hits.push({
              kind: "Etage",
              name: floor.name,
              path: where,
              floorId: floor.id,
              roomId: null,
            });
          }
          for (const room of floor.rooms) {
            if (has(room.name)) {
              hits.push({
                kind: "Raum",
                name: room.name,
                path: `${where} › ${floor.name}`,
                floorId: floor.id,
                roomId: room.id,
              });
            }
          }
        }
      }
    }
  }
  return hits.slice(0, 12);
}

/** Erste Etage im Baum, z. B. als Vorauswahl; null ohne Etagen. */
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

/** Alle Räume mit Ort, z. B. für die Auswahl am Gerät. */
export function roomChoices(tree: Locations): { label: string; rooms: RoomBrief[] }[] {
  const groups: { label: string; rooms: RoomBrief[] }[] = [];
  for (const city of tree.cities) {
    for (const site of city.sites) {
      for (const section of site.sections) {
        for (const floor of section.floors) {
          if (floor.rooms.length > 0) {
            groups.push({
              label: `${city.name} › ${site.name} › ${section.name} › ${floor.name}`,
              rooms: floor.rooms,
            });
          }
        }
      }
    }
  }
  return groups;
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

export interface Position extends PositionSummary {
  note: string;
  created_at: string;
  workplace_list: WorkplaceBrief[];
  hardware_list: HardwareSummary[];
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
  created_at: string;
  hardware_list: HardwareSummary[];
  equipment: Equipment | null;
  events: HardwareEvent[];
}

export interface WorkplaceInput {
  name: string;
  room_id: number | null;
  shared: boolean;
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

export type PositionTab = "uebersicht" | "arbeitsplaetze" | "hardware" | "verlauf";

export const POSITION_TABS: { id: PositionTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "arbeitsplaetze", label: "Arbeitsplätze" },
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

export function fetchPositions(): Promise<PositionSummary[]> {
  return getJson(`${BASE}/positions`);
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

export function deletePosition(id: number): Promise<PositionSummary[]> {
  return deleteJson(`${BASE}/positions/${id}`, { quiet: true });
}

export function fetchWorkplaces(): Promise<WorkplaceSummary[]> {
  return getJson(`${BASE}/workplaces`);
}

export function fetchWorkplace(id: number): Promise<Workplace> {
  return getJson(`${BASE}/workplaces/${id}`);
}

export function createWorkplace(body: WorkplaceInput): Promise<Workplace> {
  return postJson(`${BASE}/workplaces`, body, { quiet: true });
}

export function updateWorkplace(id: number, body: WorkplaceInput): Promise<Workplace> {
  return putJson(`${BASE}/workplaces/${id}`, body, { quiet: true });
}

export function deleteWorkplace(id: number): Promise<WorkplaceSummary[]> {
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
export function workplaceInput(workplace: WorkplaceSummary & { note?: string }): WorkplaceInput {
  return {
    name: workplace.name,
    room_id: workplace.room_id,
    shared: workplace.shared,
    kit_id: workplace.kit_id,
    position_ids: workplace.positions.map((entry) => entry.id),
    note: workplace.note ?? "",
  };
}

/** Suche in Stellen über Nummer, Bezeichnung, Person, Abteilung und Standorte. */
export function filterPositions(
  list: readonly PositionSummary[],
  query: string,
): PositionSummary[] {
  const needle = query.trim().toLocaleLowerCase("de");
  if (!needle) {
    return [...list];
  }
  return list.filter((entry) =>
    [
      entry.number,
      entry.name,
      entry.person?.name ?? "",
      entry.person?.upn ?? "",
      entry.department,
      entry.sites,
    ].some((value) => value.toLocaleLowerCase("de").includes(needle)),
  );
}

export type WorkplaceFilter = "alle" | "einzeln" | "geteilt" | "frei" | "unvollstaendig";

export const WORKPLACE_FILTERS: { id: WorkplaceFilter; label: string }[] = [
  { id: "alle", label: "Alle" },
  { id: "einzeln", label: "Einzeln" },
  { id: "geteilt", label: "Geteilt" },
  { id: "frei", label: "Frei" },
  { id: "unvollstaendig", label: "Ausstattung fehlt" },
];

export function filterWorkplaces(
  list: readonly WorkplaceSummary[],
  filter: WorkplaceFilter,
): WorkplaceSummary[] {
  return list.filter((entry) => {
    switch (filter) {
      case "einzeln":
        return !entry.shared;
      case "geteilt":
        return entry.shared;
      case "frei":
        return entry.positions.length === 0;
      case "unvollstaendig":
        return entry.complete === false;
      default:
        return true;
    }
  });
}

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

export function workplaceName(entry: Pick<WorkplaceSummary, "number" | "name">): string {
  return entry.name ? `${entry.number} ${entry.name}` : entry.number;
}

/** Wert im Auswahlfeld „Zugeordnet zu“: „s:4“ für Stelle 4, „w:2“ für Arbeitsplatz 2. */
export function holderValue(positionId: number | null, workplaceId: number | null): string {
  if (positionId !== null) {
    return `s:${positionId}`;
  }
  return workplaceId !== null ? `w:${workplaceId}` : "";
}

export function parseHolder(value: string): {
  position_id: number | null;
  workplace_id: number | null;
} {
  const match = /^([sw]):(\d{1,9})$/.exec(value);
  if (!match) {
    return { position_id: null, workplace_id: null };
  }
  const id = Number(match[2]);
  return match[1] === "s"
    ? { position_id: id, workplace_id: null }
    : { position_id: null, workplace_id: id };
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
    return "Bitte einen Namen für die Vorlage eintragen.";
  }
  if (rows.length === 0) {
    return "Eine Vorlage braucht mindestens eine Zeile.";
  }
  const result: KitRow[] = [];
  for (const [index, row] of rows.entries()) {
    const count = Number(row.count);
    if (!row.label.trim()) {
      return `Zeile ${index + 1}: Bitte eine Bezeichnung eintragen.`;
    }
    if (row.kindIds.length === 0) {
      return `Zeile ${index + 1}: Bitte mindestens eine passende Hardware-Art wählen.`;
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
  /** Technische Daten von Lenovo-Modellen aus Lenovo PSREF holen */
  psref_enabled: boolean;
}

export interface NinjaUpdate {
  enabled: boolean;
  region: string;
  client_id: string;
  organization_ids: number[];
  role_ids: number[];
  monitor_field: string;
  psref_enabled: boolean;
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

export type PsrefStatus = "ok" | "nicht_gefunden" | "fehler";

export interface PsrefInfo {
  url: string;
  name: string;
  status: PsrefStatus;
  checked_at: string | null;
  /** Kamera, Mikrofon, Lautsprecher, soweit PSREF sie nennt */
  av: Partial<Record<"camera" | "microphone" | "speakers", string>>;
  specs: { group: string; name: string; value: string }[];
}

export const PSREF_STATUS_LABELS: Record<PsrefStatus, string> = {
  ok: "gefunden",
  nicht_gefunden: "nicht gefunden",
  fehler: "Abruf fehlgeschlagen",
};

export const AV_LABELS: { key: keyof PsrefInfo["av"]; label: string }[] = [
  { key: "camera", label: "Kamera" },
  { key: "microphone", label: "Mikrofon" },
  { key: "speakers", label: "Lautsprecher" },
];

const PSREF_KEY_SPECS =
  /\b(?:processor|memory|storage|graphics|display|resolution|panel|ports?)\b/i;

/** Wichtigste Angaben: Kamera, Mikrofon, Lautsprecher und die Eckdaten (höchstens 8). */
export function psrefHighlights(psref: PsrefInfo): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const entry of AV_LABELS) {
    const value = psref.av[entry.key];
    if (value) {
      rows.push({ label: entry.label, value });
    }
  }
  const seen = new Set<string>();
  for (const spec of psref.specs) {
    if (rows.length >= 8) {
      break;
    }
    if (PSREF_KEY_SPECS.test(spec.name) && !seen.has(spec.name)) {
      seen.add(spec.name);
      rows.push({ label: spec.name, value: spec.value });
    }
  }
  return rows;
}

/** Merkmale nach Gruppe, in der Reihenfolge aus PSREF. */
export function psrefGroups(
  specs: PsrefInfo["specs"],
): { group: string; rows: PsrefInfo["specs"] }[] {
  const groups: { group: string; rows: PsrefInfo["specs"] }[] = [];
  for (const spec of specs) {
    const group = spec.group || "Allgemein";
    const last = groups[groups.length - 1];
    if (last && last.group === group) {
      last.rows.push(spec);
    } else {
      groups.push({ group, rows: [spec] });
    }
  }
  return groups;
}

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
}

export const DECISION_OPTIONS: Record<CaseKind, DecisionOption[]> = {
  neu: [
    { id: "stelle", label: "Einer Stelle zuordnen", hint: "Das Gerät gehört dann zur Stelle." },
    {
      id: "arbeitsplatz",
      label: "Einem Arbeitsplatz zuordnen",
      hint: "Zum Beispiel ein fester PC am Platz.",
    },
    { id: "lager", label: "Ins Lager", hint: "Nicht zugeordnet, auf Wunsch mit Raum." },
    {
      id: "gleich",
      label: "Ist dasselbe Gerät",
      hint: "Ein Gerät im Bestand übernimmt den Eintrag aus NinjaOne, z. B. nach einem Mainboardtausch.",
    },
    {
      id: "uebergehen",
      label: "Nicht in den Bestand aufnehmen",
      hint: "Zum Beispiel ein Testgerät. Der Abgleich meldet es nicht wieder.",
    },
  ],
  monitor: [
    {
      id: "arbeitsplatz",
      label: "Am Arbeitsplatz anlegen",
      hint: "Der Monitor bleibt am Schreibtisch, auch wenn das Notebook woanders ist.",
    },
    {
      id: "stelle",
      label: "Der Stelle zuordnen",
      hint: "Wenn der Monitor mit dem Notebook mitgeht, zum Beispiel ein mobiler Monitor.",
    },
    {
      id: "uebergehen",
      label: "Nicht übernehmen",
      hint: "Der Monitor wird nicht erfasst und beim nächsten Abgleich nicht wieder gemeldet.",
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

/** Einträge je Seite in den Listen „Vorgänge“ und „Verleih“ */
export const PAGE_SIZE = 50;

function pageQuery(filter: string, query: string, offset: number, limit: number): string {
  const params = new URLSearchParams({ state: filter });
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
): Promise<CaseList> {
  return getJson(`${BASE}/cases?${pageQuery(filter, query, offset, limit)}`);
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

export type LoanState = "offen" | "ueberfaellig" | "zurueck";
export type LoanFilter = "offen" | "ueberfaellig" | "zurueck" | "alle";

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
  due_on: string;
  hardware_ids: number[];
  note: string;
}

export const LOAN_FILTERS: { id: LoanFilter; label: string }[] = [
  { id: "offen", label: "Ausgeliehen" },
  { id: "ueberfaellig", label: "Überfällig" },
  { id: "zurueck", label: "Zurück" },
  { id: "alle", label: "Alle" },
];

export const LOAN_STATES: Record<LoanState, { label: string; pill: string }> = {
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
}

export interface StatChart {
  key: string;
  title: string;
  /** feste Reihenfolge (z. B. Altersgruppen) statt nach Größe */
  ordered: boolean;
  items: StatCount[];
}

export interface InventoryStatistics {
  /** Hersteller für den Filter; id 0 = ohne Hersteller */
  makers: { id: number; name: string; count: number }[];
  maker_id: number | null;
  total: number;
  charts: StatChart[];
  loans: { open: number; overdue: number; months: StatCount[] };
  retired: { year: number; count: number; reasons: StatCount[] }[];
}

export function fetchInventoryStatistics(makerId: number | null): Promise<InventoryStatistics> {
  return getJson(`${BASE}/statistics${makerId === null ? "" : `?maker=${makerId}`}`);
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
