import { deleteJson, getJson, postJson, putJson } from "../../../api";

export interface DeviceRef {
  id: number;
  name: string;
  inventory_no: string | null;
  serial: string;
  kind: string;
}

/** Verknüpfung mit dem IT-Bestand: über die Seriennummer oder von Hand. */
export type DeviceMatch = "seriennummer" | "hand";
/** Lücke zwischen Zabbix und IT-Bestand. */
export type InventoryGap = "ohne_bestand" | "seriennummer_fehlt";

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
  todo: {
    long_open: number;
    unmonitored: number;
    no_inventory: number;
    no_serial: number;
    certificates: ZbxProblem[];
    certificate_tag: string | null;
  };
  sites: string[];
  site_health: ZbxSiteHealth[];
  history: ZbxHour[];
}

/** Ein Host als Kästchen: „ok“, „1“ bis „5“ (schlimmster offener Schweregrad), „down“, „wartung“. */
export interface ZbxHostCell {
  hostid: string;
  name: string;
  state: string;
}

export interface ZbxSiteHealth {
  /** null: ohne Standort */
  name: string | null;
  hosts: number;
  unreachable: number;
  maintenance: number;
  problems: number;
  worst: number | null;
  cells: ZbxHostCell[];
}

export interface ZbxHour {
  hour: string;
  /** null: in dieser Stunde kein Abruf */
  open: number | null;
  high: number | null;
}

/** Kurzfassung des Stands für die farbige Karte oben in der Übersicht. */
export function overviewHeadline(data: Pick<ZbxOverview, "kpis" | "site_health">): {
  tone: "ok" | "warn" | "bad";
  title: string;
  text: string;
} {
  const count = (value: number) => data.kpis.by_severity[String(value)] ?? 0;
  const severe = count(5) + count(4);
  const parts = SEVERITIES.filter((entry) => count(entry.value) > 0).map(
    (entry) => `${count(entry.value)} ${entry.label}`,
  );
  if (data.kpis.unreachable > 0) {
    parts.push(
      `${data.kpis.unreachable} ${data.kpis.unreachable === 1 ? "Host" : "Hosts"} nicht erreichbar`,
    );
  }
  const worst = data.site_health
    .filter((site) => site.worst !== null || site.unreachable > 0)
    .sort(
      (left, right) =>
        (right.worst ?? 0) - (left.worst ?? 0) || right.unreachable - left.unreachable,
    )[0];
  if (worst && (severe > 0 || data.kpis.unreachable > 0)) {
    parts.push(`am meisten betroffen: ${worst.name ?? "ohne Standort"}`);
  }
  if (severe > 0) {
    return {
      tone: "bad",
      title: severe === 1 ? "1 schweres Problem offen" : `${severe} schwere Probleme offen`,
      text: parts.join(" · "),
    };
  }
  if (data.kpis.problems > 0 || data.kpis.unreachable > 0) {
    const title =
      data.kpis.problems === 0
        ? "Keine Probleme, aber Hosts nicht erreichbar"
        : `${data.kpis.problems} ${data.kpis.problems === 1 ? "Problem" : "Probleme"} offen, nichts Schweres`;
    return { tone: "warn", title, text: parts.join(" · ") };
  }
  return {
    tone: "ok",
    title: "Alles in Ordnung",
    text: `Keine offenen Probleme, alle ${data.kpis.hosts} überwachten Hosts erreichbar.`,
  };
}

/** Beschriftung eines Host-Kästchens für Tooltip und Screenreader. */
export function cellLabel(cell: ZbxHostCell): string {
  if (cell.state === "ok") {
    return `${cell.name}: in Ordnung`;
  }
  if (cell.state === "down") {
    return `${cell.name}: nicht erreichbar`;
  }
  if (cell.state === "wartung") {
    return `${cell.name}: in Wartung`;
  }
  return `${cell.name}: ${severityLabel(Number(cell.state))}`;
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
  device: DeviceRef | null;
  match: DeviceMatch | null;
  gap: InventoryGap | null;
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
  device: DeviceRef | null;
  match: DeviceMatch | null;
  gap: InventoryGap | null;
  can_link: boolean;
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
  kinds: { id: number; name: string }[];
  kind_ids: number[];
  target: number;
}

export interface ZbxOptionsUpdate {
  mapping: { groupid: string; group_name: string; site_id: number }[];
  certificate_tag: string;
  certificate_value: string;
  kind_ids: number[];
  target: number;
}

export interface UnmonitoredRow extends DeviceRef {
  reason: string | null;
}

export interface ZbxUnmonitored {
  missing: UnmonitoredRow[];
  excluded: UnmonitoredRow[];
  kinds_set: boolean;
}

export const fetchZabbixUnmonitored = (): Promise<ZbxUnmonitored> =>
  getJson("/api/monitoring/zabbix/unmonitored");
export const markUnmonitored = (hardwareId: number, reason: string): Promise<ZbxUnmonitored> =>
  putJson(`/api/monitoring/zabbix/devices/${hardwareId}/unmonitored`, { reason });
export const unmarkUnmonitored = (hardwareId: number): Promise<ZbxUnmonitored> =>
  deleteJson(`/api/monitoring/zabbix/devices/${hardwareId}/unmonitored`);
export const linkHost = (hostid: string, hardwareId: number): Promise<ZbxHostDetail> =>
  postJson(`/api/monitoring/zabbix/hosts/${encodeURIComponent(hostid)}/link`, {
    hardware_id: hardwareId,
  });
export const unlinkHost = (hostid: string): Promise<ZbxHostDetail> =>
  deleteJson(`/api/monitoring/zabbix/hosts/${encodeURIComponent(hostid)}/link`);

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
  link_url: string;
  token_set: boolean;
  token_storage_available: boolean;
  ca_set: boolean;
}

export interface ZabbixSettingsUpdate {
  enabled: boolean;
  url: string;
  link_url: string;
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

// ---------- Berichte ----------

export type ReportSplit = "standort" | "gruppe";

export interface ZbxReportMonth {
  month: string;
  label: string;
  availability: number | null;
  downtime_s: number;
}

export interface ZbxReportRow {
  name: string;
  hosts: number;
  availability: number | null;
  downtime_s: number;
  maintenance_s: number;
  months: (number | null)[];
}

export interface ZbxReportTrigger {
  name: string;
  host: string;
  count: number;
  duration_s: number;
}

export interface ZbxReportOutage {
  host: string;
  site: string | null;
  name: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number;
}

export interface ZbxReport {
  year_label: string;
  years: { year: number; name: string }[];
  year: number;
  name: string;
  first_day: string;
  last_day: string;
  since: string | null;
  days: number;
  target: number;
  split: ReportSplit;
  availability: number | null;
  downtime_s: number;
  maintenance_s: number;
  hosts: number;
  months: ZbxReportMonth[];
  rows: ZbxReportRow[];
  detail: boolean;
  triggers: ZbxReportTrigger[] | null;
  outages: ZbxReportOutage[] | null;
}

function reportQuery(year: number | null, split: ReportSplit): string {
  const params = new URLSearchParams({ split });
  if (year !== null) {
    params.set("year", String(year));
  }
  return params.toString();
}

export const fetchZabbixReport = (year: number | null, split: ReportSplit): Promise<ZbxReport> =>
  getJson(`/api/monitoring/zabbix/reports?${reportQuery(year, split)}`);

export const reportCsvUrl = (year: number, split: ReportSplit): string =>
  `/api/monitoring/zabbix/reports/export.csv?${reportQuery(year, split)}`;

/** Hält den Druck (oder „als PDF speichern“) im Audit fest. */
export const reportPrinted = (year: number, split: ReportSplit): Promise<{ ok: boolean }> =>
  postJson("/api/monitoring/zabbix/reports/printed", { year, split }, { quiet: true });
