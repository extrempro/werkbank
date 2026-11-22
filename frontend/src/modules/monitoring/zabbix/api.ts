import { getJson, postJson, putJson } from "../../../api";

/** Schweregrade wie in Zabbix: 0 nicht klassifiziert … 5 Katastrophe. */
export const SEVERITIES = [
  { value: 5, label: "Katastrophe" },
  { value: 4, label: "Hoch" },
  { value: 3, label: "Durchschnitt" },
  { value: 2, label: "Warnung" },
  { value: 1, label: "Information" },
  { value: 0, label: "Nicht klassifiziert" },
] as const;

export function severityLabel(value: number): string {
  return SEVERITIES.find((entry) => entry.value === value)?.label ?? "Information";
}

/** Nicht klassifiziert sieht aus wie Information. */
export function severityClass(value: number): string {
  return `zbx-sev zbx-sev-${Math.max(1, Math.min(5, value))}`;
}

export interface DataState {
  configured: boolean;
  data_at: string | null;
  stale: boolean;
  error: string | null;
  failures: number;
  next_at: string | null;
  zabbix_url: string | null;
}

export interface ZbxProblem {
  eventid: string;
  name: string;
  severity: number;
  since: string;
  acknowledged: boolean;
  suppressed: boolean;
  tags: string[];
  hostid: string | null;
  host: string | null;
  site: string | null;
  link: string | null;
}

export interface ZbxMaintenance {
  maintenanceid: string;
  name: string;
  state: "laeuft" | "demnaechst" | "geplant" | "abgelaufen";
  with_data: boolean;
  active_since: string;
  active_till: string;
  windows: [string, string][];
  recurring: string[];
  hosts: number;
  host_names: string[];
  groups: string[];
}

export const MAINTENANCE_STATES: Record<ZbxMaintenance["state"], string> = {
  laeuft: "läuft",
  demnaechst: "demnächst",
  geplant: "geplant",
  abgelaufen: "abgelaufen",
};

export interface ZbxOverview {
  state: DataState;
  kpis: {
    problems: number;
    by_severity: Record<string, number>;
    hosts: number;
    unreachable: number;
    maintenance: number;
  };
  problems: ZbxProblem[];
  unreachable: {
    hostid: string;
    name: string;
    site: string | null;
    since: string | null;
    link: string | null;
  }[];
  maintenances: ZbxMaintenance[];
  todo: { long_open: number; certificates: ZbxProblem[]; certificate_tag: string | null };
  sites: string[];
}

export interface ZbxHostRow {
  hostid: string;
  name: string;
  host: string;
  monitored: boolean;
  reachable: boolean | null;
  in_maintenance: boolean;
  site: string | null;
  groups: string[];
  problems: number;
  worst: number | null;
  serial: string;
}

export interface ZbxHostDetail {
  hostid: string;
  name: string;
  host: string;
  monitored: boolean;
  reachable: boolean | null;
  in_maintenance: boolean;
  maintenance: string | null;
  site: string | null;
  groups: string[];
  templates: string[];
  interfaces: {
    type: string;
    address: string;
    port: string;
    main: boolean;
    available: boolean | null;
  }[];
  serial: string;
  model: string;
  kind: string;
  last_seen_at: string | null;
  updated_at: string;
  problems: ZbxProblem[];
  link: string | null;
}

export interface ZbxTask {
  task: string;
  label: string;
  methods: string[];
  interval_minutes: number;
  last_at: string | null;
  duration_ms: number | null;
  ok: boolean | null;
  error: string | null;
  counts: Record<string, number>;
}

export interface ZbxConnection {
  state: DataState;
  enabled: boolean;
  url: string | null;
  version: string | null;
  checked_at: string | null;
  role: string | null;
  methods: string[];
  needed: string[];
  findings: string[];
  token_expires_at: string | null;
  token_never_expires: boolean;
  token_warning: boolean;
  tasks: ZbxTask[];
  groups: {
    groupid: string;
    name: string;
    hosts: number;
    site_id: number | null;
    position: number | null;
  }[];
  sites: { id: number; name: string }[];
  certificate_tag: string;
  certificate_value: string;
}

export interface ZbxOptionsUpdate {
  mapping: { groupid: string; group_name: string; site_id: number }[];
  certificate_tag: string;
  certificate_value: string;
}

export const fetchZabbixOverview = (): Promise<ZbxOverview> => getJson("/api/monitoring/zabbix");
export const fetchZabbixHosts = (): Promise<ZbxHostRow[]> =>
  getJson("/api/monitoring/zabbix/hosts");
export const fetchZabbixHost = (hostid: string): Promise<ZbxHostDetail> =>
  getJson(`/api/monitoring/zabbix/hosts/${encodeURIComponent(hostid)}`);
export const fetchZabbixMaintenances = (): Promise<ZbxMaintenance[]> =>
  getJson("/api/monitoring/zabbix/maintenances");
export const fetchZabbixConnection = (): Promise<ZbxConnection> =>
  getJson("/api/monitoring/zabbix/connection");
export const saveZabbixOptions = (update: ZbxOptionsUpdate): Promise<ZbxConnection> =>
  putJson("/api/monitoring/zabbix/connection", update);

// ---------- Verwaltung › Verbindungen ----------

export interface ZabbixSettings {
  enabled: boolean;
  url: string;
  token_set: boolean;
  token_storage_available: boolean;
  ca_set: boolean;
}

export interface ZabbixSettingsUpdate {
  enabled: boolean;
  url: string;
  token?: string;
  ca_pem?: string;
}

export interface ZabbixTest {
  version: string;
  supported: boolean;
  role: string | null;
  methods: string[];
  findings: string[];
  token_expires_at: string | null;
  token_never_expires: boolean;
  hosts: number;
}

export const fetchZabbixSettings = (): Promise<ZabbixSettings> =>
  getJson("/api/admin/settings/zabbix");
export const saveZabbixSettings = (update: ZabbixSettingsUpdate): Promise<ZabbixSettings> =>
  putJson("/api/admin/settings/zabbix", update);
export const testZabbix = (): Promise<ZabbixTest> => postJson("/api/admin/settings/zabbix/test");
