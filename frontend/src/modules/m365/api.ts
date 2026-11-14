import { getJson, postJson, putJson } from "../../api";

const BASE = "/api/m365-config";

export interface Snapshot {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  source_status: Record<string, boolean>;
  change_count: number;
  resource_count: number;
}

export interface Overview {
  collector_configured: boolean;
  collect_pending: boolean;
  last_snapshot: Snapshot | null;
  settings_total: number;
  open_changes: number;
  deviations: number;
  resources_this_month: number;
  monthly_limit: number;
  workloads: string[];
}

export interface Setting {
  id: number;
  path: string;
  workload: string;
  area: string;
  object_id: string;
  object_name: string | null;
  property: string;
  source: string;
  active: boolean;
  value: unknown;
  valid_from: string | null;
  criticality: string | null;
  deviates: boolean;
}

export interface Meta {
  description: string | null;
  reasoning: string | null;
  criticality: string | null;
  owner: string | null;
  learn_url: string | null;
  target_set: boolean;
  target_value: unknown;
  target_source: string | null;
}

export interface MetaHistoryEntry {
  id: number;
  field: string;
  old_value: unknown;
  new_value: unknown;
  user: string | null;
  changed_at: string;
}

export interface MetaUpdate {
  description: string;
  reasoning: string;
  criticality: string | null;
  owner: string;
  learn_url: string;
  target_set: boolean;
  target_value: unknown;
}

export interface Version {
  id: number;
  value: unknown;
  valid_from: string;
  valid_to: string | null;
}

export interface Change {
  id: number;
  setting_id: number;
  path: string;
  object_name: string | null;
  property: string;
  kind: string;
  status: string;
  detected_at: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  comment: string | null;
}

export interface SettingDetail {
  setting: Setting;
  meta: Meta;
  meta_history: MetaHistoryEntry[];
  versions: Version[];
  changes: Change[];
}

export interface SettingFilter {
  search: string;
  workload: string;
  includeRemoved: boolean;
  onlyDeviating: boolean;
}

export type ReviewStatus = "offen" | "gewollt" | "ungewollt";

export function fetchOverview(): Promise<Overview> {
  return getJson(`${BASE}/overview`);
}

export function fetchSnapshots(): Promise<Snapshot[]> {
  return getJson(`${BASE}/snapshots`);
}

export function fetchSettings(
  filter: SettingFilter,
  offset: number,
): Promise<{ entries: Setting[]; has_more: boolean }> {
  const params = new URLSearchParams({ offset: String(offset), limit: "50" });
  if (filter.search) {
    params.set("search", filter.search);
  }
  if (filter.workload) {
    params.set("workload", filter.workload);
  }
  if (filter.includeRemoved) {
    params.set("include_removed", "true");
  }
  if (filter.onlyDeviating) {
    params.set("only_deviating", "true");
  }
  return getJson(`${BASE}/settings?${params.toString()}`);
}

export function fetchSetting(id: number): Promise<SettingDetail> {
  return getJson(`${BASE}/settings/${id}`);
}

export function updateMeta(id: number, update: MetaUpdate): Promise<Meta> {
  return putJson(`${BASE}/settings/${id}/meta`, update);
}

export function fetchChanges(
  status: string,
  offset: number,
): Promise<{ entries: Change[]; has_more: boolean }> {
  const params = new URLSearchParams({ offset: String(offset), limit: "50" });
  if (status) {
    params.set("status", status);
  }
  return getJson(`${BASE}/changes?${params.toString()}`);
}

export function reviewChanges(
  ids: number[],
  status: ReviewStatus,
  comment: string,
): Promise<{ updated: number }> {
  return postJson(`${BASE}/changes/review`, { ids, status, comment: comment || null });
}

export function startCollect(): Promise<{ queued: boolean }> {
  return postJson(`${BASE}/collect`);
}

const KIND_LABELS: Record<string, string> = {
  neu: "Neu",
  geaendert: "Geändert",
  entfernt: "Entfernt",
};

const STATUS_LABELS: Record<string, string> = {
  offen: "Offen",
  gewollt: "Gewollt",
  ungewollt: "Ungewollt",
};

const SNAPSHOT_LABELS: Record<string, string> = {
  ok: "Erfolgreich",
  teilweise: "Teilweise",
  fehler: "Fehlgeschlagen",
  laeuft: "Läuft",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function snapshotLabel(status: string): string {
  return SNAPSHOT_LABELS[status] ?? status;
}

/** Wert einer Einstellung als Text. Ohne Wert (z. B. vor „neu“) ein Gedankenstrich. */
export function formatValue(value: unknown, pretty = false): string {
  if (value === undefined || value === null) {
    return "–";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}

export function settingTitle(item: { object_name: string | null; property: string }): string {
  return item.object_name ? `${item.object_name} – ${item.property}` : item.property;
}

const CRITICALITY_LABELS: Record<string, string> = {
  niedrig: "Niedrig",
  mittel: "Mittel",
  hoch: "Hoch",
};

const META_FIELD_LABELS: Record<string, string> = {
  beschreibung: "Beschreibung",
  begruendung: "Begründung",
  kritikalitaet: "Kritikalität",
  verantwortlich: "Verantwortlich",
  learn_url: "Link zu Microsoft Learn",
  soll_wert: "Soll-Wert",
};

export function criticalityLabel(value: string | null): string {
  return value ? (CRITICALITY_LABELS[value] ?? value) : "Nicht festgelegt";
}

export function metaFieldLabel(field: string): string {
  return META_FIELD_LABELS[field] ?? field;
}

/** Wert im Verlauf der Angaben: Der Soll-Wert steckt in einer Hülle, damit „kein Soll-Wert“ erkennbar bleibt. */
export function formatMetaValue(field: string, value: unknown): string {
  if (field === "soll_wert" && typeof value === "object" && value !== null && "wert" in value) {
    return formatValue((value as { wert: unknown }).wert);
  }
  if (field === "kritikalitaet" && typeof value === "string") {
    return criticalityLabel(value);
  }
  return formatValue(value);
}

/** Eingabe für den Soll-Wert: gültiges JSON wird als JSON übernommen, alles andere als Text. */
export function parseTargetInput(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

/** Soll-Wert als Text für das Eingabefeld (Umkehrung von parseTargetInput). */
export function targetInputText(value: unknown): string {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return JSON.stringify(value);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}
