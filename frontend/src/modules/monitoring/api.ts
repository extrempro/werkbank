import { getJson, postJson, putJson } from "../../api";

export type DnsStatus = "ok" | "abweichend" | "fehlt" | "inaktiv" | "fehler";

export interface DnsRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "fehlgeschlagen";
  error: string | null;
  zones: number;
  records: number;
  queries: number;
  counts: Partial<Record<DnsStatus, number>>;
  /** Extern verwaltete Subdomains (NS-Delegation in NetBox), nicht geprüft */
  delegations: string[];
  /** Typen aus NetBox, die der Abgleich nicht abfragt, mit Anzahl */
  skipped_types: Record<string, number>;
}

export interface DnsRow {
  key: string;
  fqdn: string;
  type: string;
  zone: string;
  status: DnsStatus;
  /** Seit dem vorletzten Lauf als Problem hinzugekommen */
  new: boolean;
  netbox: string[];
  inactive: string[];
  public: string[];
  missing: string[];
  extra: string[];
  notes: string[];
  netbox_url: string | null;
}

export interface DnsHistory {
  started_at: string;
  status: "ok" | "fehlgeschlagen";
  counts: Partial<Record<DnsStatus, number>>;
}

export interface DnsOverview {
  enabled: boolean;
  interval_hours: number;
  last_run: DnsRun | null;
  result_run: DnsRun | null;
  next_run_at: string | null;
  rows: DnsRow[];
  history: DnsHistory[];
}

export function fetchDnsOverview(): Promise<DnsOverview> {
  return getJson("/api/monitoring/dns");
}

export function runDnsCheckNow(): Promise<{ scheduled_at: string }> {
  return postJson("/api/monitoring/dns/run");
}

export const PROBLEM_STATUSES: readonly DnsStatus[] = ["abweichend", "fehlt", "fehler"];

export const STATUS_LABELS: Record<DnsStatus, string> = {
  ok: "in Ordnung",
  abweichend: "abweichend",
  fehlt: "fehlt öffentlich",
  inaktiv: "inaktiv",
  fehler: "Fehler",
};

export type DnsView = "probleme" | "neu" | "alle";

/** Zeilen für die gewählte Ansicht und den Suchtext (Name, Zone, Typ, Werte). */
export function filterRows(rows: DnsRow[], view: DnsView, query: string): DnsRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (view === "probleme" && !PROBLEM_STATUSES.includes(row.status)) {
      return false;
    }
    if (view === "neu" && !row.new) {
      return false;
    }
    const text = [row.fqdn, row.zone, row.type, ...row.netbox, ...row.public]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Zeilen nach Zone gruppiert, Zonen alphabetisch. */
export function groupByZone(rows: DnsRow[]): [string, DnsRow[]][] {
  const groups = new Map<string, DnsRow[]>();
  for (const row of rows) {
    groups.set(row.zone, [...(groups.get(row.zone) ?? []), row]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Je Tag der letzte erfolgreiche Lauf, für das Diagramm (Tage in UTC). */
export function dailyHistory(
  history: DnsHistory[],
): { day: string; counts: DnsHistory["counts"] }[] {
  const byDay = new Map<string, DnsHistory["counts"]>();
  for (const run of history) {
    if (run.status === "ok") {
      byDay.set(run.started_at.slice(0, 10), run.counts);
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({ day, counts }));
}

/** Ansicht aus der Adresse (…?ansicht=neu); sonst Probleme. */
export function viewFromSearch(search: string): DnsView {
  const value = new URLSearchParams(search).get("ansicht");
  return value === "neu" || value === "alle" ? value : "probleme";
}

// --- Verwaltung ---

export interface NetboxSettings {
  enabled: boolean;
  url: string;
  token_set: boolean;
  token_storage_available: boolean;
  view_id: number | null;
  resolver: string;
  compare_ttl: boolean;
  ca_set: boolean;
  resolvers: { id: string; name: string }[];
}

export interface NetboxUpdate {
  enabled: boolean;
  url: string;
  /** Weglassen: bleibt. Leerer Text: löschen. */
  token?: string;
  view_id: number | null;
  resolver: string;
  compare_ttl: boolean;
  /** Weglassen: bleibt. Leerer Text: löschen. */
  ca_pem?: string;
}

export interface NetboxTest {
  version: string;
  dns_plugin: string | null;
  views: { id: number; name: string }[];
  zones: number;
}

export function fetchNetboxSettings(): Promise<NetboxSettings> {
  return getJson("/api/admin/settings/netbox");
}

export function saveNetboxSettings(update: NetboxUpdate): Promise<NetboxSettings> {
  return putJson("/api/admin/settings/netbox", update);
}

export function testNetbox(): Promise<NetboxTest> {
  return postJson("/api/admin/settings/netbox/test");
}
