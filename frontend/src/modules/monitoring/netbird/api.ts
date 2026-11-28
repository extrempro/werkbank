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
  };
  ping_enabled: boolean;
  networks: NbNetwork[];
  services: NbService[];
}

export function fetchNbNetworks(): Promise<NbNetworks> {
  return getJson(`${BASE}/networks`);
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
