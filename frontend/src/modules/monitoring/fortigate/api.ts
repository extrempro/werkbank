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

export interface FgSyncDevice {
  device: string;
  role: string;
  synchronisiert: number;
  lokal: number;
  abweichend: number;
  kandidaten: number;
}

export interface FgOverview {
  configured: boolean;
  can_refresh: boolean;
  devices: FgDeviceState[];
  sync: FgSyncDevice[];
  reachable: number;
  policies: number;
  disabled: number;
  changes_24h: number;
  findings: Record<FgSeverity, number> & { excepted: number };
}

export interface FgOpen {
  srcintf: boolean;
  dstintf: boolean;
  srcaddr: boolean;
  dstaddr: boolean;
  service: boolean;
}

export interface FgPolicyFinding {
  code: string;
  rule: string;
  severity: FgSeverity;
}

export interface FgPolicy {
  findings: FgPolicyFinding[];
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

export type FgSyncState = "synchronisiert" | "abweichend" | "lokal" | "lokal_mehrfach";

export interface FgObject {
  name: string;
  sync: { state: FgSyncState; label: string; candidate: boolean } | null;
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
  sync_bar: FgSyncDevice[];
  unused: number;
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

export function objectQuery(kind: FgKind, q: string, device: string, sync = ""): string {
  return params({ kind, q, device, sync });
}

export function fetchFgObjects(
  kind: FgKind,
  q: string,
  device: string,
  sync = "",
): Promise<FgObjects> {
  return getJson(`${BASE}/objects${objectQuery(kind, q, device, sync)}`);
}

export function objectsCsvUrl(kind: FgKind, q: string, device: string, sync = ""): string {
  return `${BASE}/objects.csv${objectQuery(kind, q, device, sync)}`;
}

// --- Unbenutzte Objekte -------------------------------------------------------------------

export type FgUnusedKind = FgKind | "ippools";

export interface FgUnusedRow {
  kind: FgUnusedKind;
  name: string;
  value: string;
  devices: string[];
  reasons: string[];
  since: string | null;
  fabric: boolean;
}

export interface FgUnused {
  rows: FgUnusedRow[];
  counts: Record<FgUnusedKind, number>;
  devices: string[];
}

export interface FgUnusedFilter {
  device: string;
  kind: string;
  days: string;
  disabled: boolean;
  groups: boolean;
  defaults: boolean;
}

export function unusedQuery(filter: FgUnusedFilter): string {
  return params({
    device: filter.device,
    kind: filter.kind,
    days: filter.days,
    disabled: filter.disabled ? "" : "false",
    groups: filter.groups ? "" : "false",
    defaults: filter.defaults ? "true" : "",
  });
}

export function fetchFgUnused(filter: FgUnusedFilter): Promise<FgUnused> {
  return getJson(`${BASE}/unused${unusedQuery(filter)}`);
}

export function unusedCsvUrl(filter: FgUnusedFilter): string {
  return `${BASE}/unused.csv${unusedQuery(filter)}`;
}

/** Aufräumliste der gewählten Objekte als CSV herunterladen. */
export async function downloadCleanupList(
  items: { kind: FgUnusedKind; name: string }[],
  filter: FgUnusedFilter,
): Promise<void> {
  const response = await fetch(`${BASE}/unused/cleanup.csv`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items,
      disabled: filter.disabled,
      groups: filter.groups,
      defaults: filter.defaults,
    }),
  });
  if (!response.ok) {
    throw new Error("Die Aufräumliste konnte nicht erstellt werden.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "fortigate-aufraeumliste.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// --- Befunde ------------------------------------------------------------------------------

export type FgSeverity = "hoch" | "mittel" | "hinweis";

export interface FgRule {
  code: string;
  severity: FgSeverity;
  title: string;
  description: string;
  active: boolean;
}

export interface FgException {
  id: number;
  reason: string;
  expires_at: string | null;
  created_at: string;
  created_by: string;
}

export interface FgFinding {
  key: string;
  code: string;
  rule: string;
  severity: FgSeverity;
  device: string;
  label: string;
  detail: string;
  policy_id: number | null;
  since: string | null;
  link: string;
  exception: FgException | null;
}

export interface FgFindings {
  rows: FgFinding[];
  counts: Record<FgSeverity, number>;
  excepted: number;
  devices: string[];
  rules: FgRule[];
  can_except: boolean;
}

export interface FgFindingFilter {
  severity: string;
  device: string;
  code: string;
  excepted: boolean;
}

export function findingQuery(filter: FgFindingFilter): string {
  return params({
    severity: filter.severity,
    device: filter.device,
    code: filter.code,
    excepted: filter.excepted ? "true" : "",
  });
}

export function fetchFgFindings(filter: FgFindingFilter): Promise<FgFindings> {
  return getJson(`${BASE}/findings${findingQuery(filter)}`);
}

export function findingsCsvUrl(filter: FgFindingFilter): string {
  return `${BASE}/findings.csv${findingQuery(filter)}`;
}

export function createFgException(
  key: string,
  reason: string,
  months: 0 | 6 | 12,
): Promise<{ id: number; expires_at: string | null }> {
  return postJson(`${BASE}/exceptions`, { key, reason, months });
}

export function deleteFgException(id: number): Promise<{ id: number }> {
  return deleteJson(`${BASE}/exceptions/${id}`);
}

// --- Pfad-Analyse, Internet-Ausgang, Topologie --------------------------------------------

export type FgProto = "tcp" | "udp" | "icmp";

export interface FgHop {
  device: string;
  ingress: string;
  src: string;
  dst: string;
  dnat: string;
  route: string;
  egress: string;
  policy: { id: number; name: string; action: string } | null;
  why: string[];
  skipped: string[];
  snat: string;
  profiles: Record<string, string>;
  notes: string[];
  outcome: string;
  check: { ok: boolean; text: string } | null;
  findings: FgPolicyFinding[];
}

export interface FgPath {
  hops: FgHop[];
  verdict: string;
  allowed: boolean;
  limits: string;
  devices: string[];
  data_at: string | null;
}

export interface FgPathQuery {
  src: string;
  dst: string;
  proto: FgProto;
  port: string;
  device: string;
  check: boolean;
}

export function fetchFgPath(query: FgPathQuery): Promise<FgPath> {
  return getJson(
    `${BASE}/path${params({
      src: query.src.trim(),
      dst: query.dst.trim(),
      proto: query.proto,
      port: query.proto === "icmp" ? "" : query.port.trim(),
      device: query.device,
      check: query.check ? "true" : "",
    })}`,
  );
}

export interface FgExit {
  device: string;
  interface: string;
  network: string;
  allowed: boolean;
  verdict: string;
  exit: string;
  path: string[];
  policies: string[];
  snat: string;
  profiles: Record<string, string>;
}

export interface FgTopology {
  nodes: { name: string; internet: string[] }[];
  links: { a: string; b: string; kind: string; label: string }[];
}

export interface FgExits {
  exits: FgExit[];
  topology: FgTopology;
  probe: string;
  limits: string;
}

export function fetchFgExits(): Promise<FgExits> {
  return getJson(`${BASE}/exits`);
}

// --- Änderungen ---------------------------------------------------------------------------

export interface FgChangeField {
  field: string;
  before: string;
  after: string;
}

export interface FgChange {
  section: string;
  label: string;
  kind: "neu" | "entfernt" | "geändert";
  key: string;
  title: string;
  fields: FgChangeField[];
  who: { user: string; ui: string; time: string }[];
}

export interface FgChangeEntry {
  snapshot_id: number;
  previous_id: number;
  device: string;
  at: string;
  since: string;
  analyzer: boolean;
  analyzer_error: string | null;
  changes: FgChange[];
}

export interface FgChanges {
  entries: FgChangeEntry[];
  devices: string[];
  kinds: string[];
}

export function fetchFgChanges(device: string, kind: string, days: string): Promise<FgChanges> {
  return getJson(`${BASE}/changes${params({ device, kind, days })}`);
}

export function fetchFgSnapshots(
  device: string,
): Promise<{ device: string; snapshots: { id: number; taken_at: string; seen_at: string }[] }> {
  return getJson(`${BASE}/snapshots${params({ device })}`);
}

export interface FgCompare {
  device: string;
  from: { id: number; taken_at: string };
  to: { id: number; taken_at: string };
  changes: FgChange[];
}

export function fetchFgCompare(device: string, a: number, b: number): Promise<FgCompare> {
  return getJson(`${BASE}/compare${params({ device, a: String(a), b: String(b) })}`);
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

export interface FgRules {
  rules: FgRule[];
  sensitive: string[];
  unused_days: number;
  unused_days_options: number[];
}

export function fetchFgRules(): Promise<FgRules> {
  return getJson(`${ADMIN}/rules`);
}

export function saveFgRules(update: {
  disabled: string[];
  sensitive: string[];
  unused_days: number;
}): Promise<FgRules> {
  return putJson(`${ADMIN}/rules`, update);
}

export function testFgAnalyzer(): Promise<{ device: string; events: number }> {
  return postJson(`${ADMIN}/analyzer/test`);
}
