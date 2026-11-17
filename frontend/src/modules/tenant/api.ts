import { getJson } from "../../api";

const BASE = "/api/tenant";

export interface License {
  id: number;
  sku_id: string;
  part_number: string;
  name: string;
  applies_to: string | null;
  capability_status: string | null;
  total: number;
  consumed: number;
  /** Kann negativ sein, wenn mehr zugewiesen als gekauft ist. */
  free: number;
  warning: number;
  suspended: number;
  locked_out: number;
  next_lifecycle: string | null;
  trial: boolean;
  active: boolean;
}

export interface LicenseList {
  /** `false`: Der Abruf ist in dieser Installation nicht eingeschaltet. */
  enabled: boolean;
  fetched_at: string | null;
  total: number;
  consumed: number;
  entries: License[];
}

export interface LicenseSample {
  day: string;
  total: number;
  consumed: number;
}

export interface LicenseDetail {
  license: License;
  fetched_at: string;
  samples: LicenseSample[];
}

export interface UserSample {
  day: string;
  total: number;
  members: number;
  guests: number;
  enabled: number;
  disabled: number;
  guests_disabled: number;
  licensed: number | null;
}

export interface Users {
  enabled: boolean;
  fetched_at: string | null;
  current: UserSample | null;
  samples: UserSample[];
}

/** Zeiträume für den Verlauf, in Tagen. */
export const PERIODS: { days: number; label: string }[] = [
  { days: 30, label: "30 Tage" },
  { days: 90, label: "90 Tage" },
  { days: 365, label: "1 Jahr" },
  { days: 1095, label: "3 Jahre" },
];

export function fetchLicenses(): Promise<LicenseList> {
  return getJson(`${BASE}/licenses`);
}

export function fetchLicense(id: number, days: number): Promise<LicenseDetail> {
  return getJson(`${BASE}/licenses/${id}?days=${days}`);
}

export function fetchUsers(days: number): Promise<Users> {
  return getJson(`${BASE}/users?days=${days}`);
}

const numberFormat = new Intl.NumberFormat("de-DE");

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

const DAY_MS = 86_400_000;
/** Ab so vielen Tagen vor dem Stichtag eines Abos gibt es einen Hinweis. */
export const LIFECYCLE_WARN_DAYS = 30;

/** Ganze Tage bis zu einem Zeitpunkt; negativ, wenn er vorbei ist. */
export function daysUntil(iso: string, now: number): number {
  return Math.ceil((Date.parse(iso) - now) / DAY_MS);
}

export interface LicenseNote {
  text: string;
  tone: "ok" | "todo" | "bad" | "neutral";
}

/** Hinweise zu einer Lizenz: aufgebraucht, überbucht, Stichtag nah, Testabo, gesperrte Einheiten. */
export function licenseNotes(license: License, now: number): LicenseNote[] {
  const notes: LicenseNote[] = [];
  if (license.free < 0) {
    notes.push({ text: `${formatCount(-license.free)} mehr zugewiesen als gekauft`, tone: "bad" });
  } else if (license.free === 0 && license.total > 0) {
    notes.push({ text: "aufgebraucht", tone: "todo" });
  }
  if (license.warning > 0) {
    notes.push({ text: `${formatCount(license.warning)} in Kulanzfrist`, tone: "todo" });
  }
  if (license.suspended + license.locked_out > 0) {
    notes.push({
      text: `${formatCount(license.suspended + license.locked_out)} gesperrt`,
      tone: "bad",
    });
  }
  if (license.next_lifecycle) {
    const days = daysUntil(license.next_lifecycle, now);
    if (days < 0) {
      notes.push({ text: "Stichtag überschritten", tone: "bad" });
    } else if (days <= LIFECYCLE_WARN_DAYS) {
      notes.push({
        text: days === 0 ? "Stichtag heute" : `Stichtag in ${days} Tagen`,
        tone: "todo",
      });
    }
  }
  if (license.trial) {
    notes.push({ text: "Testabo", tone: "neutral" });
  }
  return notes;
}

export type CredentialLevel = "abgelaufen" | "dringend" | "warnung" | "hinweis" | "ok";

export interface Credential {
  id: number;
  /** „app“: App-Registrierung; „sso“: Unternehmensanwendung mit Signaturzertifikat. */
  owner_kind: string;
  owner_name: string;
  app_id: string | null;
  /** „secret“ oder „zertifikat“. */
  kind: string;
  name: string | null;
  starts_at: string | null;
  expires_at: string | null;
  /** Ganze Tage bis zum Ablauf; negativ, wenn abgelaufen. */
  days_left: number | null;
  level: CredentialLevel;
}

export interface CredentialList {
  enabled: boolean;
  fetched_at: string | null;
  /** Vorlauf in Tagen: Hinweis, Warnung, dringend. */
  warn_days: number[];
  total: number;
  attention: number;
  entries: Credential[];
}

export function fetchCredentials(): Promise<CredentialList> {
  return getJson(`${BASE}/credentials`);
}

/** Art des Eintrags in Worten. */
export function credentialKind(entry: Credential): string {
  if (entry.kind === "secret") {
    return "Secret";
  }
  return entry.owner_kind === "sso" ? "Signaturzertifikat (SAML)" : "Zertifikat";
}

/** Restlaufzeit in Worten. */
export function remainingText(days: number | null): string {
  if (days === null) {
    return "ohne Ablaufdatum";
  }
  if (days < 0) {
    return days === -1 ? "seit 1 Tag abgelaufen" : `seit ${-days} Tagen abgelaufen`;
  }
  if (days === 0) {
    return "läuft heute ab";
  }
  return days === 1 ? "noch 1 Tag" : `noch ${formatCount(days)} Tage`;
}

export const LEVEL_INFO: Record<
  CredentialLevel,
  { text: string; tone: "ok" | "todo" | "bad" | "neutral" }
> = {
  abgelaufen: { text: "abgelaufen", tone: "bad" },
  dringend: { text: "dringend", tone: "bad" },
  warnung: { text: "läuft bald ab", tone: "todo" },
  hinweis: { text: "im Blick behalten", tone: "neutral" },
  ok: { text: "in Ordnung", tone: "ok" },
};

// --- Dienststatus ---

export interface ServiceReason {
  issue_id: string;
  title: string;
  /** „incident“ (Störung) oder „advisory“ (Hinweis) */
  classification: string;
}

export interface ServiceHealth {
  service_id: string;
  name: string;
  /** Status laut Übersicht von Microsoft, z. B. „serviceDegradation“ (nur zur Information) */
  status: string;
  /** Aus den offenen Meldungen: offene Störung, nur Hinweise oder nichts */
  level: HealthLevel;
  open_incidents: number;
  open_advisories: number;
  /** Die offenen Meldungen des Dienstes, Störungen zuerst */
  reasons: ServiceReason[];
}

export interface ServiceIssue {
  issue_id: string;
  service_id: string;
  service_name: string;
  title: string;
  /** „incident“ (Störung) oder „advisory“ (Hinweis) */
  classification: string;
  status: string;
  feature_group: string | null;
  feature: string | null;
  impact: string | null;
  resolved: boolean;
  start_at: string | null;
  end_at: string | null;
  modified_at: string | null;
}

export interface ServiceIssueDetail extends ServiceIssue {
  posts: { at: string | null; type: string; text: string }[];
}

export interface OutageStat {
  year: number;
  service_id: string;
  service_name: string;
  incidents: number;
  advisories: number;
  incident_hours: number;
}

export interface MonthStat {
  /** Monat des Beginns als JJJJ-MM */
  month: string;
  service_id: string;
  incidents: number;
}

/** Zustand eines Tages in der Zeitleiste: die schwerste Meldung, die an dem Tag lief. */
export type DayLevel = "ok" | "hinweis" | "stoerung";

export interface ServiceTimeline {
  service_id: string;
  service_name: string;
  /** Ein Eintrag je Tag aus `timeline_days`, ältester zuerst */
  days: DayLevel[];
}

export interface Health {
  enabled: boolean;
  fetched_at: string | null;
  services: ServiceHealth[];
  open: ServiceIssue[];
  recent: ServiceIssue[];
  stats: OutageStat[];
  months: MonthStat[];
  /** Tage als JJJJ-MM-TT, ältester zuerst */
  timeline_days: string[];
  timeline: ServiceTimeline[];
  /** Meldungen, die in diesen Tagen liefen, neueste zuerst */
  timeline_issues: ServiceIssue[];
}

/** Die Meldung im Microsoft 365 Admin Center (dort ist eine Anmeldung nötig). */
export function adminCenterUrl(issueId: string): string {
  return `https://admin.microsoft.com/Adminportal/Home#/servicehealth/:/alerts/${encodeURIComponent(issueId)}`;
}

/** Störungen je Monat, aufsteigend; ohne Dienst die Summe aller Dienste. */
export function monthlyIncidents(
  months: MonthStat[],
  serviceId: string | null,
): { month: string; incidents: number }[] {
  const totals = new Map<string, number>();
  for (const entry of months) {
    if (serviceId === null || entry.service_id === serviceId) {
      totals.set(entry.month, (totals.get(entry.month) ?? 0) + entry.incidents);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, incidents]) => ({ month, incidents }));
}

export function fetchHealth(): Promise<Health> {
  return getJson(`${BASE}/health`);
}

export function fetchIssue(id: string): Promise<ServiceIssueDetail> {
  return getJson(`${BASE}/health/issues/${encodeURIComponent(id)}`);
}

/** Zustand eines Dienstes in drei Stufen, aus den offenen Meldungen. */
export type HealthLevel = "ok" | "hinweis" | "stoerung";

const STATUS_TEXT: Record<string, string> = {
  serviceoperational: "In Ordnung",
  investigating: "Wird untersucht",
  restoringservice: "Wird wiederhergestellt",
  verifyingservice: "Behebung wird geprüft",
  servicerestored: "Wiederhergestellt",
  postincidentreviewpublished: "Bericht veröffentlicht",
  servicedegradation: "Eingeschränkt",
  serviceinterruption: "Unterbrochen",
  extendedrecovery: "Längere Wiederherstellung",
  falsepositive: "Fehlalarm",
  investigationsuspended: "Untersuchung ausgesetzt",
  resolved: "Behoben",
  mitigatedexternal: "Extern abgemildert",
  mitigated: "Abgemildert",
  resolvedexternal: "Extern behoben",
  confirmed: "Bestätigt",
  reported: "Gemeldet",
};

export function healthStatusText(status: string): string {
  return STATUS_TEXT[status.toLowerCase()] ?? status;
}

export const HEALTH_LEVEL: Record<HealthLevel, { label: string; pill: string; kpi: string }> = {
  ok: { label: "In Ordnung", pill: "pill pill-ok", kpi: "kpi kpi-ok" },
  hinweis: { label: "Hinweis", pill: "pill pill-todo", kpi: "kpi kpi-warn" },
  stoerung: { label: "Störung", pill: "pill pill-bad", kpi: "kpi kpi-bad" },
};

export function issueKind(classification: string): string {
  return classification === "incident" ? "Störung" : "Hinweis";
}

const DURATION_HOURS = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Dauer einer Meldung, z. B. „3,5 Std.“ oder „2 Tage“; laufende bis jetzt. */
export function issueDuration(issue: ServiceIssue, now: Date = new Date()): string {
  if (!issue.start_at) {
    return "–";
  }
  const end = issue.end_at ? new Date(issue.end_at) : now;
  const hours = Math.max(end.getTime() - new Date(issue.start_at).getTime(), 0) / 3_600_000;
  return hours < 48
    ? `${DURATION_HOURS.format(hours)} Std.`
    : `${DURATION_HOURS.format(hours / 24)} Tage`;
}

/** Tage (ISO, UTC) in Wochen-Spalten mit Montag oben; Lücken vor dem ersten Tag sind null. */
export function weekColumns(days: string[]): (number | null)[][] {
  if (days.length === 0) {
    return [];
  }
  // getUTCDay zählt ab Sonntag (0)
  const offset = (new Date(`${days[0] ?? ""}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...days.map((_, index) => index),
  ];
  const columns: (number | null)[][] = [];
  for (let start = 0; start < cells.length; start += 7) {
    columns.push(cells.slice(start, start + 7));
  }
  return columns;
}

/** „1 Tag Störung, 2 Tage Hinweis“ oder „ohne Meldung“ für einen Kalender. */
export function calendarSummary(levels: readonly DayLevel[]): string {
  const incidents = levels.filter((level) => level === "stoerung").length;
  const advisories = levels.filter((level) => level === "hinweis").length;
  if (incidents === 0 && advisories === 0) {
    return "ohne Meldung";
  }
  return [
    incidents > 0 && `${incidents} ${incidents === 1 ? "Tag" : "Tage"} Störung`,
    advisories > 0 && `${advisories} ${advisories === 1 ? "Tag" : "Tage"} Hinweis`,
  ]
    .filter(Boolean)
    .join(", ");
}
