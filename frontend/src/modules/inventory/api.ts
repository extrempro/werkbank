import { deleteJson, getJson, postJson, putJson } from "../../api";
import { INVENTORY_HARDWARE_PATH } from "../../navigation";

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

export interface Hardware extends HardwareSummary {
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

export interface MasterData {
  kinds: Kind[];
  makers: Maker[];
  reasons: Reason[];
}

/** Die Reiter eines Geräts; der erste hat keinen eigenen Pfadteil. */
export type HardwareTab = "uebersicht" | "verlauf";

export const HARDWARE_TABS: { id: HardwareTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "verlauf", label: "Verlauf" },
];

export function hardwarePath(id: number, tab: HardwareTab = "uebersicht"): string {
  return tab === "uebersicht"
    ? `${INVENTORY_HARDWARE_PATH}/${id}`
    : `${INVENTORY_HARDWARE_PATH}/${id}/${tab}`;
}

/** Gerät und Reiter aus dem Pfad, z. B. „/bestand/hardware/7/verlauf“; sonst null. */
export function parseHardwarePath(path: string): { id: number; tab: HardwareTab } | null {
  const match = /^\/bestand\/hardware\/(\d{1,9})(?:\/(verlauf))?$/.exec(path);
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

export function reactivateHardware(id: number): Promise<Hardware> {
  return postJson(`${BASE}/hardware/${id}/reactivate`, {}, { quiet: true });
}

export function fetchMasterData(): Promise<MasterData> {
  return getJson(`${BASE}/master-data`);
}

export type MasterKind = "kinds" | "makers" | "reasons";

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

export function deleteEntry(kind: MasterKind | "models", id: number): Promise<MasterData> {
  return deleteJson(`${BASE}/${kind}/${id}`, { quiet: true });
}

export function createModel(makerId: number, name: string): Promise<MasterData> {
  return postJson(`${BASE}/makers/${makerId}/models`, { name }, { quiet: true });
}

export function updateModel(id: number, name: string): Promise<MasterData> {
  return putJson(`${BASE}/models/${id}`, { name }, { quiet: true });
}

/** Text für Hersteller und Modell, z. B. „Hersteller A Monitor 27“; ohne Modell „–“. */
export function modelLabel(device: Pick<HardwareSummary, "maker" | "model">): string {
  return device.model ? `${device.maker ?? ""} ${device.model}`.trim() : "–";
}

/** Suche über Bezeichnung, Art, Modell, Seriennummer, Inventurnummer und Hostname. */
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
