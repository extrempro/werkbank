import { getJson, postJson, putJson } from "../../../api";

/* IT-Monitoring › NetBird (nur lesend) und Verwaltung › NetBird. */

const BASE = "/api/monitoring/netbird";
const ADMIN = "/api/admin/settings/netbird";

export const NB_READER = "NetBird.Reader";

export type NbLevel = "kritisch" | "warnung" | "info";
export type NbStatus = "verbunden" | "offline" | "freigabe" | "abgelaufen";

export interface NbHint {
  key: string;
  level: NbLevel;
  code: string;
  title: string;
  text: string;
  link: string;
}

export interface NbBase {
  configured: boolean;
  data_at: string | null;
  last_run_at: string | null;
  last_ok: boolean | null;
  error: string | null;
  notes: string[];
  dashboard_url: string;
}

export interface NbOverview extends NbBase {
  can_refresh: boolean;
  networks_total: number;
  networks_ok: number;
  networks_single: number;
  services_total: number;
  services_ok: number;
  services_checked: number;
  peers: number;
  connected: number;
  routers: number;
  routers_offline: number;
  hint_counts: Record<NbLevel, number>;
  hints: NbHint[];
  latest_version: string;
  versions: { neuestes: number; eins: number; zwei: number; unbekannt: number };
  systems: { name: string; total: number; online: number }[];
  chart_days: number;
  chart: { day: string; weekend: boolean; max_connected: number | null; total: number | null }[];
  events_available: boolean;
  events: NbEvent[];
}

export interface NbPeerRow {
  id: string;
  name: string;
  person: string;
  status: NbStatus;
  status_label: string;
  last_seen: string | null;
  ip: string;
  os: string;
  os_family: string;
  version: string;
  behind: number | null;
  router: boolean;
  groups: string[];
  hints: NbHint[];
}

export interface NbPeers extends NbBase {
  rows: NbPeerRow[];
  total: number;
  counts: Record<NbStatus, number>;
  groups: { id: string; name: string }[];
  families: string[];
  approval_known: boolean;
  can_export: boolean;
}

export interface NbPeerDetail extends NbPeerRow {
  hostname: string;
  dns_label: string;
  kernel: string;
  login_expires: string | null;
  login_expired: boolean;
  country: string;
  group_names: string[];
  history: { day: string; connected: boolean; known: boolean }[];
  latest_version: string;
  asset: { id: number; name: string; inventory_no: string } | null;
  policies_available: boolean;
  targets: { target: string; ports: string; policy: string }[];
}

export interface NbPeerFilter {
  q: string;
  state: string;
  group: string;
  os: string;
  hinted: boolean;
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

export function fetchNbOverview(days = 14): Promise<NbOverview> {
  return getJson(`${BASE}/overview?days=${days}`);
}

export function fetchNbPeers(filter: NbPeerFilter): Promise<NbPeers> {
  return getJson(
    `${BASE}/peers${params({
      q: filter.q,
      state: filter.state,
      group: filter.group,
      os: filter.os,
      hinted: filter.hinted ? "true" : "",
    })}`,
  );
}

export function fetchNbPeer(id: string): Promise<NbPeerDetail> {
  return getJson(`${BASE}/peers/${encodeURIComponent(id)}`);
}

export const PEERS_CSV_URL = `${BASE}/peers.csv`;

export type NbNetworkState = "erreichbar" | "ohne_ausfallweg" | "nicht_erreichbar" | "ohne_router";

export interface NbNetwork {
  id: string;
  name: string;
  kind: string;
  ranges: string[];
  routers: { id: string; name: string; connected: boolean }[];
  connected: number;
  total: number;
  state: NbNetworkState;
  state_label: string;
  target: string;
  ping: boolean | null;
}

export interface NbService {
  id: string;
  domain: string;
  target: string;
  access: string;
  private: boolean;
  status_code: number | null;
  answered: boolean | null;
  error: string;
  ms: number | null;
  availability: number | null;
  cert_expires: string | null;
  crowdsec_mode: string;
  blocked_24h: number;
  observed_24h: number;
  crowdsec_exempt: boolean;
}

export interface NbTcp {
  target: string;
  ok: boolean;
  ms: number | null;
  error: string;
}

export interface NbNetworks extends NbBase {
  components: {
    management: { ok: boolean; ms: number | null };
    signal: NbTcp | null;
    relay: NbTcp | null;
    proxy: { services: number; errors: number; online: boolean | null; crowdsec: boolean };
    crowdsec: {
      configured: boolean;
      ok: boolean | null;
      total: number | null;
      own: number | null;
      error: string;
      blocked_24h: number | null;
      observed_24h: number | null;
    };
  };
  ping_enabled: boolean;
  proxy_log_available: boolean;
  networks: NbNetwork[];
  services: NbService[];
}

export function fetchNbNetworks(): Promise<NbNetworks> {
  return getJson(`${BASE}/networks`);
}

// --- Richtlinien & Ereignisse --------------------------------------------------------------

export type NbEventKind =
  "peer" | "policy" | "group" | "setupkey" | "user" | "network" | "service" | "account" | "other";

export interface NbEvent {
  id: string;
  at: string;
  category: NbEventKind;
  label: string;
  object: string;
  initiator: string;
  change: string;
}

export interface NbFinding {
  key: string;
  level: NbLevel;
  code: string;
  title: string;
  text: string;
}

export interface NbPolicy {
  id: string;
  name: string;
  sources: string[];
  destinations: string[];
  ports: string;
  posture_checks: string[];
  enabled: boolean;
  disabled_days: number | null;
  changed_at: string | null;
}

export interface NbSetupKey {
  id: string;
  name: string;
  type: string;
  groups: string[];
  expires: string | null;
  days_left: number | null;
  state: string;
  active: boolean;
  used_times: number;
  usage_limit: number;
  ephemeral: boolean;
}

export interface NbPolicies extends NbBase {
  policies_available: boolean;
  setup_keys_available: boolean;
  events_available: boolean;
  server_groups: string[];
  findings: NbFinding[];
  policies: NbPolicy[];
  setup_keys: NbSetupKey[];
  categories: { value: NbEventKind; label: string }[];
}

export interface NbEvents {
  total: number;
  days: number;
  items: NbEvent[];
}

export function fetchNbPolicies(): Promise<NbPolicies> {
  return getJson(`${BASE}/policies`);
}

export function fetchNbEvents(filter: {
  kind: string;
  days: number;
  offset: number;
  limit: number;
}): Promise<NbEvents> {
  return getJson(
    `${BASE}/events${params({
      kind: filter.kind,
      days: String(filter.days),
      offset: filter.offset ? String(filter.offset) : "",
      limit: String(filter.limit),
    })}`,
  );
}

// --- Gruppen & Policies -----------------------------------------------------------------

export type NbChangeStatus = "offen" | "bestaetigt" | "automatisch";

export interface NbChange {
  id: number;
  detected_at: string;
  kind: "group" | "policy";
  object_id: string;
  object_name: string;
  action: string;
  action_label: string;
  summary: string;
  initiator: string;
  initiator_kind: "person" | "scim" | "unbekannt";
  flag: "" | "fremde_gruppe" | "von_hand";
  critical: boolean;
  status: NbChangeStatus;
}

export interface NbChangeDetail extends NbChange {
  fields: [string, string, string, boolean][];
  via: string;
  flag_text: string;
  notified: string;
  reported: boolean;
  confirmed_by_name: string;
  confirmed_at: string | null;
  comment: string;
  related: number;
  can_confirm?: boolean;
}

export interface NbWatchPreview {
  groups: string[];
  policies: string[];
  policies_by_prefix: number;
  policies_by_group: number;
  policies_known: boolean;
}

export interface NbChanges extends NbBase {
  watch: NbWatchPreview & {
    active: boolean;
    group_prefixes: string[];
    policy_prefixes: string[];
    by_group: boolean;
  };
  open_count: number;
  total: number;
  items: NbChange[];
  can_confirm: boolean;
  can_configure: boolean;
}

export interface NbChangeFilter {
  q: string;
  state: string;
  kind: string;
  action: string;
  initiator: string;
  days: string;
  object: string;
}

export function fetchNbChanges(filter: NbChangeFilter, limit: number): Promise<NbChanges> {
  return getJson(
    `${BASE}/changes${params({
      q: filter.q,
      state: filter.state,
      kind: filter.kind,
      action: filter.action,
      initiator: filter.initiator,
      days: filter.days,
      object_id: filter.object,
      limit: String(limit),
    })}`,
  );
}

export function fetchNbChange(id: number): Promise<NbChangeDetail> {
  return getJson(`${BASE}/changes/${id}`);
}

export function confirmNbChange(id: number, comment: string): Promise<NbChangeDetail> {
  return postJson(`${BASE}/changes/${id}/confirm`, { comment });
}

export function confirmAllNbChanges(): Promise<{ confirmed: number }> {
  return postJson(`${BASE}/changes/confirm-all`);
}

export function refreshNetbird(): Promise<{ scheduled: boolean }> {
  return postJson(`${BASE}/refresh`);
}

// --- Verwaltung ---------------------------------------------------------------------------

export interface NbAdminSettings {
  url: string;
  token_set: boolean;
  ping: boolean;
  signal: string;
  relay: string;
  server_groups: string;
  token_storage_available: boolean;
  last_run_at: string | null;
  last_ok: boolean | null;
  last_error: string | null;
}

export function fetchNbAdmin(): Promise<NbAdminSettings> {
  return getJson(ADMIN);
}

export function saveNbAdmin(update: {
  url: string;
  token?: string;
  ping: boolean;
  signal: string;
  relay: string;
  server_groups: string;
}): Promise<NbAdminSettings> {
  return putJson(ADMIN, update);
}

export function testNbConnection(): Promise<{
  peers: number;
  groups: number;
  policies: number | null;
}> {
  return postJson(`${ADMIN}/test`);
}

export interface NbCrowdSecSettings {
  url: string;
  key_set: boolean;
  exempt: string;
  token_storage_available: boolean;
}

export function fetchNbCrowdSec(): Promise<NbCrowdSecSettings> {
  return getJson(`${ADMIN}/crowdsec`);
}

export function saveNbCrowdSec(update: {
  url: string;
  key?: string;
  exempt: string;
}): Promise<NbCrowdSecSettings> {
  return putJson(`${ADMIN}/crowdsec`, update);
}

export function testNbCrowdSec(): Promise<{ total: number; own: number }> {
  return postJson(`${ADMIN}/crowdsec/test`);
}

export interface NbNotify {
  policy_change: boolean;
  policy_toggle: boolean;
  group_change: boolean;
  members_manual: boolean;
  members_scim: boolean;
}

export interface NbWatchInput {
  group_prefixes: string;
  policy_prefixes: string;
  by_prefix: boolean;
  by_group: boolean;
  notify: NbNotify;
  critical_mail: boolean;
  retention: "unbegrenzt" | "3j" | "1j" | "90t";
  reminder: 3 | 7 | 0;
  auto_confirm: boolean;
}

export interface NbWatchSettings extends NbWatchInput {
  preview: NbWatchPreview;
}

export function fetchNbWatch(): Promise<NbWatchSettings> {
  return getJson(`${ADMIN}/watch`);
}

export function previewNbWatch(input: NbWatchInput): Promise<NbWatchPreview> {
  return postJson(`${ADMIN}/watch/preview`, input);
}

export function saveNbWatch(input: NbWatchInput): Promise<NbWatchSettings> {
  return putJson(`${ADMIN}/watch`, input);
}
