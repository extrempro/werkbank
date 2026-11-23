import { deleteJson, getJson, postJson } from "../../api";

const BASE = "/api/devices";

/** Anmeldung mit dem Admin-Konto: läuft über den Server, nie im Browser (spec.md 7c). */
export const ADMIN_LOGIN_URL = `${BASE}/admin/login`;

export type DeviceStatus =
  "freigabe" | "vorab" | "zugeordnet" | "registriert" | "nicht_abgeschlossen";
export type DeviceView = "alle" | "freigabe" | "offen" | "abgeschlossen" | "nicht_abgeschlossen";

export const STATUS: Record<DeviceStatus, { label: string; pill: string; level: number }> = {
  freigabe: { label: "Wartet auf Freigabe", pill: "pill-todo", level: 0 },
  vorab: { label: "Vorab zugeordnet", pill: "pill-info", level: 1 },
  zugeordnet: { label: "Zugeordnet", pill: "pill-info", level: 2 },
  registriert: { label: "In Intune registriert", pill: "pill-ok", level: 3 },
  nicht_abgeschlossen: { label: "Nicht abgeschlossen", pill: "pill-bad", level: 1 },
};

export const VIEWS: { id: DeviceView; label: string; count?: keyof Counts | "offen" }[] = [
  { id: "alle", label: "Alle" },
  { id: "freigabe", label: "Wartet auf Freigabe", count: "freigabe" },
  { id: "offen", label: "Offen", count: "offen" },
  { id: "abgeschlossen", label: "Abgeschlossen", count: "registriert" },
  { id: "nicht_abgeschlossen", label: "Nicht abgeschlossen", count: "nicht_abgeschlossen" },
];

export interface Admin {
  connected: boolean;
  upn: string | null;
  name: string | null;
  expires_at: string | null;
}

export interface Policy {
  id: string;
  name: string;
}

export interface Duplicate {
  graph_id: string;
  association_state: string;
  entry_id: number | null;
}

/** Fehler von Microsoft, für die Oberfläche aufbereitet (immer mit Request-ID, falls bekannt). */
export interface Problem {
  kind: string;
  title: string;
  detail: string;
  requirements?: string[];
  request_id?: string | null;
}

export interface ScanResult {
  serial_number: string;
  manufacturer: string;
  model: string;
  link_id: string;
  generated_at: string;
  admin_connected: boolean;
  admin_upn: string | null;
  tenant_name: string | null;
  policies: Policy[];
  duplicate: Duplicate | null;
  problem: Problem | null;
}

export interface Device {
  id: number;
  serial_number: string;
  manufacturer: string;
  model: string;
  status: DeviceStatus;
  association_state: string | null;
  policy_name: string | null;
  scanned_by: string | null;
  scanned_at: string;
  approved_by: string | null;
  approved_admin: string | null;
  approved_at: string | null;
  associated_at: string | null;
  enrolled_at: string | null;
  link_expires_at: string | null;
  request_id: string | null;
  last_error: string | null;
  device_name: string | null;
  compliance: string | null;
  user_principal_name: string | null;
  managed_device_id: string | null;
  last_checked_at: string | null;
}

export interface Counts {
  freigabe: number;
  vorab: number;
  zugeordnet: number;
  registriert: number;
  nicht_abgeschlossen: number;
}

export interface DeviceList {
  entries: Device[];
  /** Treffer insgesamt; angezeigt werden höchstens die neuesten 500 */
  total: number;
  counts: Counts;
  last_run: string | null;
  monitor: boolean;
}

export interface ImportResult {
  ok: boolean;
  entry: Device | null;
  duplicate: Duplicate | null;
  error: Problem | null;
}

export function countFor(counts: Counts, key: keyof Counts | "offen"): number {
  return key === "offen" ? counts.vorab + counts.zugeordnet : counts[key];
}

/** Grobe Prüfung im Browser: fremde QR-Codes übergeht der Scanner still. */
export function looksLikeDeviceLink(text: string): boolean {
  return /^devicelink:\/1\/\?/i.test(text.trim());
}

export function fetchAdmin(): Promise<Admin> {
  return getJson(`${BASE}/admin`);
}

export function disconnectAdmin(): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/admin/logout`, {}, { quiet: true });
}

export function fetchDevices(view: DeviceView, query: string): Promise<DeviceList> {
  const params = new URLSearchParams({ view });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return getJson(`${BASE}/entries?${params.toString()}`);
}

export function scanCode(qr: string): Promise<ScanResult> {
  return postJson(`${BASE}/scan`, { qr }, { quiet: true });
}

export function importNow(qr: string, policyId: string | null): Promise<ImportResult> {
  return postJson(`${BASE}/entries/import`, { qr, policy_id: policyId });
}

export function sendForApproval(qr: string, policyId: string | null): Promise<Device> {
  return postJson(`${BASE}/entries/pending`, { qr, policy_id: policyId });
}

export function approve(id: number, policyId: string | null): Promise<ImportResult> {
  return postJson(`${BASE}/entries/${id}/approve`, { policy_id: policyId });
}

export function discard(id: number): Promise<{ ok: boolean }> {
  return deleteJson(`${BASE}/entries/${id}`);
}

export function refreshOne(id: number): Promise<Device> {
  return postJson(`${BASE}/entries/${id}/refresh`, {}, { quiet: true });
}

export function refreshAll(): Promise<{ checked: number }> {
  return postJson(`${BASE}/refresh`, {}, { quiet: true });
}

export function fetchPolicies(): Promise<{
  tenant_name: string | null;
  policies: Policy[];
  problem: Problem | null;
}> {
  return getJson(`${BASE}/policies`);
}

/** Link ins Intune-Admin-Center zum registrierten Gerät (nur mit Kennung von Microsoft). */
export function intuneUrl(device: Device): string | null {
  const id = device.managed_device_id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return null;
  }
  return `https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsMenuBlade/~/overview/mdmDeviceId/${id}`;
}

export function fetchDevice(id: number): Promise<Device> {
  return getJson(`${BASE}/entries/${id}`);
}
