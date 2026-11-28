import { deleteJson, getJson, postJson, putJson } from "../../../api";

/* IT-Monitoring › FortiGate (nur lesend) und Verwaltung › FortiGate. */

const BASE = "/api/monitoring/fortigate";
const ADMIN = "/api/admin/settings/fortigate";

export const FG_READER = "FortiGate.Reader";
export const FG_EDITOR = "FortiGate.Editor";

export interface FgDeviceState {
  id: number;
  name: string;
  hostname: string;
  model: string;
  version: string;
  ha: string;
  fabric: string;
  policies: number;
  last_run_at: string | null;
  last_ok: boolean | null;
  error: string | null;
  data_at: string | null;
  notes: string[];
}

export interface FgOverview {
  configured: boolean;
  can_refresh: boolean;
  devices: FgDeviceState[];
  reachable: number;
  policies: number;
  disabled: number;
  changes_24h: number;
}

export interface FgOpen {
  srcintf: boolean;
  dstintf: boolean;
  srcaddr: boolean;
  dstaddr: boolean;
  service: boolean;
}

export interface FgPolicy {
  device: string;
  id: number;
  position: number;
  name: string;
  status: boolean;
  srcintf: string[];
  dstintf: string[];
  srcaddr: string[];
  dstaddr: string[];
  srcaddr_negate: boolean;
  dstaddr_negate: boolean;
  internet_service: string[];
  service: string[];
  service_negate: boolean;
  action: string;
  nat: string;
  poolname: string[];
  schedule: string;
  log: string;
  profiles: Record<string, string>;
  users: string[];
  comments: string;
  hits: number | null;
  last_used: string | null;
  first_used: string | null;
  bytes: number | null;
  open: FgOpen;
  pair: string;
  match: string;
}

export type FgQueryKind = "" | "ip" | "port" | "id" | "text";

export interface FgPolicies {
  rows: FgPolicy[];
  total: number;
  devices: string[];
  pairs: string[];
  query: FgQueryKind;
}

export interface FgPolicyFilter {
  q: string;
  device: string;
  pair: string;
  action: string;
  state: string;
}

export type FgKind = "addresses" | "address_groups" | "services" | "service_groups" | "vips";

export interface FgObjectDevice {
  device: string;
  value: string;
  fabric: boolean;
  members: string[];
  groups: string[];
  comment: string;
}

export interface FgUsedIn {
  device: string;
  id: number;
  name: string;
  field: string;
  via_group: boolean;
}

export interface FgObject {
  name: string;
  value: string;
  same_value: boolean;
  devices: FgObjectDevice[];
  uses: number;
  used_in: FgUsedIn[];
  match: string;
  member_table?: { member: string; devices: Record<string, boolean> }[];
}

export interface FgObjects {
  kind: FgKind;
  rows: FgObject[];
  counts: Record<FgKind, number>;
  devices: string[];
  query: FgQueryKind;
}

function params(values: Record<string, string>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) {
      query.set(key, value);
    }
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function fetchFgOverview(): Promise<FgOverview> {
  return getJson(`${BASE}/overview`);
}

export function policyQuery(filter: FgPolicyFilter): string {
  return params({ ...filter });
}

export function fetchFgPolicies(filter: FgPolicyFilter): Promise<FgPolicies> {
  return getJson(`${BASE}/policies${policyQuery(filter)}`);
}

export function policiesCsvUrl(filter: FgPolicyFilter): string {
  return `${BASE}/policies.csv${policyQuery(filter)}`;
}

export function objectQuery(kind: FgKind, q: string, device: string): string {
  return params({ kind, q, device });
}

export function fetchFgObjects(kind: FgKind, q: string, device: string): Promise<FgObjects> {
  return getJson(`${BASE}/objects${objectQuery(kind, q, device)}`);
}

export function objectsCsvUrl(kind: FgKind, q: string, device: string): string {
  return `${BASE}/objects.csv${objectQuery(kind, q, device)}`;
}

export function refreshFortigate(): Promise<{ scheduled_at: string }> {
  return postJson(`${BASE}/refresh`);
}

// --- Verwaltung ---------------------------------------------------------------------------

export interface FgAdminDevice {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  token_set: boolean;
  last_run_at: string | null;
  last_ok: boolean | null;
  last_error: string | null;
}

export interface FgAdminSettings {
  interval_minutes: number;
  intervals: number[];
  retention_months: number;
  ca_set: boolean;
  analyzer_enabled: boolean;
  analyzer_url: string;
  analyzer_adom: string;
  analyzer_key_set: boolean;
  token_storage_available: boolean;
  devices: FgAdminDevice[];
}

export interface FgSettingsUpdate {
  interval_minutes: number;
  retention_months: number;
  /** undefined: unverändert, leer: löschen */
  ca_pem?: string;
  analyzer_enabled: boolean;
  analyzer_url: string;
  analyzer_adom: string;
  analyzer_key?: string;
}

export interface FgDeviceInput {
  name: string;
  url: string;
  enabled: boolean;
  token?: string;
}

export function fetchFgAdmin(): Promise<FgAdminSettings> {
  return getJson(ADMIN);
}

export function saveFgSettings(update: FgSettingsUpdate): Promise<FgAdminSettings> {
  return putJson(ADMIN, update);
}

export function fetchRetentionPreview(
  months: number,
): Promise<{ runs: number; snapshots: number }> {
  return getJson(`${ADMIN}/retention-preview?months=${months}`);
}

export function createFgDevice(input: FgDeviceInput): Promise<FgAdminSettings> {
  return postJson(`${ADMIN}/devices`, input);
}

export function updateFgDevice(id: number, input: FgDeviceInput): Promise<FgAdminSettings> {
  return putJson(`${ADMIN}/devices/${id}`, input);
}

export function deleteFgDevice(id: number): Promise<FgAdminSettings> {
  return deleteJson(`${ADMIN}/devices/${id}`);
}

export function testFgDevice(
  id: number,
): Promise<{ hostname: string; model: string; version: string; policies: number }> {
  return postJson(`${ADMIN}/devices/${id}/test`);
}
