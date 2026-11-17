import { deleteJson, getJson, postJson, putJson } from "../../api";

const BASE = "/api/m365-config";

export interface Snapshot {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  source_status: Record<string, boolean>;
  /** Fehlertext der Quelle je nicht vollständig gelesenem Ressourcentyp. */
  source_errors?: Record<string, string>;
  change_count: number;
  resource_count: number;
}

export interface DayCount {
  /** Kalendertag JJJJ-MM-TT in der Zeitzone des Browsers. */
  day: string;
  count: number;
}

export interface Overview {
  collector_configured: boolean;
  collect_pending: boolean;
  last_snapshot: Snapshot | null;
  settings_total: number;
  described_total: number;
  open_changes: number;
  open_critical: number;
  changes_last_7_days: number;
  changes_last_30_days: number;
  changes_per_day: DayCount[];
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
  /** Anzahl noch nicht bewerteter Änderungen. */
  open_changes?: number;
  /** Der Soll-Wert stammt aus einem Evergreen-Vorgang. */
  from_evergreen?: boolean;
  /** Angezeigt wird ein KI-Text, den noch niemand geprüft hat. */
  ai_unreviewed?: boolean;
}

/** KI-Text für diese Art von Einstellung. */
export interface AiText {
  text: string;
  state: "ungeprueft" | "geprueft";
  model: string;
  generated_at: string;
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
  workload: string;
  /** Bereich (Ressourcentyp), z. B. „conditionalAccessPolicy“ */
  area: string;
  object_name: string | null;
  property: string;
  criticality: string | null;
  description: string | null;
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
  ai_text?: AiText | null;
  /** Zugeordnete Empfehlungen aus Microsoft Secure Score. */
  recommendations?: Recommendation[];
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

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function fetchOverview(): Promise<Overview> {
  const params = new URLSearchParams({ tz: browserTimezone() });
  return getJson(`${BASE}/overview?${params.toString()}`);
}

export function fetchSnapshots(): Promise<Snapshot[]> {
  return getJson(`${BASE}/snapshots`);
}

export type DifferenceKind = "neu" | "geaendert" | "entfernt";

export interface SnapshotDifference {
  path: string;
  workload: string;
  area: string;
  object_name: string | null;
  property: string;
  kind: DifferenceKind;
  old_value: unknown;
  new_value: unknown;
}

export interface SnapshotComparison {
  from_id: number;
  to_id: number;
  from_at: string;
  to_at: string;
  total: number;
  counts: Record<DifferenceKind, number>;
  differences: SnapshotDifference[];
  truncated: boolean;
}

/** Unterschiede zwischen zwei Abrufen; der ältere gilt immer als „vorher“. */
export function compareSnapshots(from: number, to: number): Promise<SnapshotComparison> {
  const params = new URLSearchParams({ from: String(from), to: String(to) });
  return getJson(`${BASE}/snapshots/compare?${params.toString()}`);
}

export function snapshotExportUrl(id: number, format: "json" | "csv"): string {
  return `${BASE}/snapshots/${id}/export.${format}`;
}

/** Filter als Parameter; gilt für Liste und Baum. */
function settingParams(filter: SettingFilter): URLSearchParams {
  const params = new URLSearchParams();
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
  return params;
}

export function fetchSettings(
  filter: SettingFilter,
  offset: number,
  place?: { area: string; objectId: string },
): Promise<{ entries: Setting[]; has_more: boolean }> {
  const params = settingParams(filter);
  params.set("offset", String(offset));
  params.set("limit", "200");
  if (place) {
    params.set("area", place.area);
    params.set("object_id", place.objectId);
  }
  return getJson(`${BASE}/settings?${params.toString()}`);
}

interface TreeCounts {
  settings: number;
  open_changes: number;
  deviating: number;
}

export interface TreeObject extends TreeCounts {
  object_id: string;
  object_name: string | null;
  /** Mindestens eine Einstellung ist noch im Tenant */
  active: boolean;
}

export interface TreeArea extends TreeCounts {
  area: string;
  objects: TreeObject[];
}

export interface TreeWorkload extends TreeCounts {
  workload: string;
  areas: TreeArea[];
}

export interface SettingTree extends TreeCounts {
  workloads: TreeWorkload[];
}

/** Dienst › Bereich › Objekt mit Zählern; Eigenschaften lädt fetchSettings je Objekt. */
export function fetchSettingTree(filter: SettingFilter): Promise<SettingTree> {
  return getJson(`${BASE}/settings/tree?${settingParams(filter).toString()}`);
}

export function fetchSetting(id: number): Promise<SettingDetail> {
  return getJson(`${BASE}/settings/${id}`);
}

/** Gibt den KI-Text frei oder verwirft ihn; gilt für alle Einstellungen derselben Art. */
export function reviewAiText(
  id: number,
  action: "freigeben" | "verwerfen",
): Promise<AiText | null> {
  return postJson(`${BASE}/settings/${id}/ai-text`, { action });
}

export function updateMeta(id: number, update: MetaUpdate): Promise<Meta> {
  return putJson(`${BASE}/settings/${id}/meta`, update);
}

export interface ChangeCounts {
  alle: number;
  offen: number;
  gewollt: number;
  ungewollt: number;
}

export interface ChangeGroup {
  workload: string;
  area: string;
  count: number;
}

export interface ChangeList {
  entries: Change[];
  has_more: boolean;
  counts?: ChangeCounts;
  /** Änderungen je Dienst und Bereich (mit dem Status-Filter) */
  groups?: ChangeGroup[];
}

export function fetchChanges(
  status: string,
  offset: number,
  limit = 50,
  place: { workload?: string; area?: string } = {},
): Promise<ChangeList> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (status) {
    params.set("status", status);
  }
  if (place.workload) {
    params.set("workload", place.workload);
  }
  if (place.area) {
    params.set("area", place.area);
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

const WORKLOAD_LABELS: Record<string, string> = {
  entra: "Entra",
  exchange: "Exchange",
  intune: "Intune",
  teams: "Teams",
  sharepoint: "SharePoint",
};

export function workloadLabel(workload: string): string {
  return WORKLOAD_LABELS[workload] ?? workload.charAt(0).toUpperCase() + workload.slice(1);
}

/** Verständliche Namen für die Bereiche (Ressourcentypen von Microsoft, klein geschrieben). */
const AREA_LABELS: Record<string, string> = {
  // Entra
  conditionalaccesspolicy: "Bedingter Zugriff",
  namedlocationpolicy: "Benannte Standorte",
  authorizationpolicy: "Autorisierungsrichtlinie",
  // Exchange: Organisation und Transport
  organizationconfig: "Organisation",
  transportconfig: "Transport",
  transportrule: "Transportregeln",
  accepteddomain: "Akzeptierte Domänen",
  remotedomain: "Remotedomänen",
  inboundconnector: "Eingehende Connectors",
  outboundconnector: "Ausgehende Connectors",
  dkimsigningconfig: "DKIM",
  // Exchange: Schutz
  antiphishpolicy: "Anti-Phishing",
  hostedcontentfilterpolicy: "Anti-Spam (eingehend)",
  hostedoutboundspamfilterpolicy: "Anti-Spam (ausgehend)",
  malwarefilterpolicy: "Anti-Malware",
  safeattachmentpolicy: "Sichere Anlagen",
  safelinkspolicy: "Sichere Links",
  quarantinepolicy: "Quarantäne",
  atppolicyforo365: "Defender für Office 365",
  // Exchange: Zugriff und Freigabe
  owamailboxpolicy: "Outlook im Web",
  mobiledevicemailboxpolicy: "Mobilgeräte",
  sharingpolicy: "Freigaberichtlinien",
  authenticationpolicy: "Authentifizierungsrichtlinien",
  // Teams: Zugriff und Gäste
  federationconfiguration: "Externer Zugriff",
  guestmeetingconfiguration: "Gäste: Besprechungen",
  guestmessagingconfiguration: "Gäste: Chat",
  guestcallingconfiguration: "Gäste: Anrufe",
  clientconfiguration: "Teams-Client",
  // Teams: Besprechungen, Chat und Anrufe
  meetingpolicy: "Besprechungsrichtlinien",
  meetingconfiguration: "Besprechungen (Organisation)",
  messagingpolicy: "Chat-Richtlinien",
  channelspolicy: "Teams und Kanäle",
  eventspolicy: "Veranstaltungen",
  filespolicy: "Dateien",
  callingpolicy: "Anrufrichtlinien",
  // Teams: Apps und Updates
  apppermissionpolicy: "App-Berechtigungen",
  appsetuppolicy: "App-Einrichtung",
  updatemanagementpolicy: "Updates",
  upgradeconfiguration: "Upgrade",
  // Intune: Compliance
  devicecompliancepolicywindows10: "Compliance: Windows",
  devicecompliancepolicyios: "Compliance: iOS/iPadOS",
  devicecompliancepolicymacos: "Compliance: macOS",
  devicecompliancepolicyandroid: "Compliance: Android (Geräteadministrator)",
  devicecompliancepolicyandroiddeviceowner:
    "Compliance: Android Enterprise (vollständig verwaltet)",
  devicecompliancepolicyandroidworkprofile: "Compliance: Android Enterprise (Arbeitsprofil)",
  // Intune: Konfigurationsprofile
  deviceconfigurationpolicywindows10: "Konfiguration: Windows (Geräteeinschränkungen)",
  deviceconfigurationpolicyios: "Konfiguration: iOS/iPadOS",
  deviceconfigurationpolicymacos: "Konfiguration: macOS",
  deviceconfigurationpolicyandroidworkprofile: "Konfiguration: Android (Arbeitsprofil)",
  deviceconfigurationpolicyandroiddeviceowner: "Konfiguration: Android (vollständig verwaltet)",
  deviceconfigurationendpointprotectionpolicywindows10: "Konfiguration: Endpunktschutz (Windows)",
  deviceconfigurationidentityprotectionpolicywindows10: "Konfiguration: Identitätsschutz (Windows)",
  settingcatalogcustompolicywindows10: "Einstellungskatalog (Windows)",
  windowsupdateforbusinessringupdateprofilewindows10: "Windows Update: Updateringe",
  windowsupdateforbusinessfeatureupdateprofilewindows10: "Windows Update: Funktionsupdates",
  // Intune: Endpunktsicherheit
  antiviruspolicywindows10settingcatalog: "Endpunktsicherheit: Antivirus",
  accountprotectionpolicy: "Endpunktsicherheit: Kontoschutz",
  endpointdetectionandresponsepolicywindows10: "Endpunktsicherheit: EDR",
  settingcatalogasrrulespolicywindows10:
    "Endpunktsicherheit: Regeln zur Verringerung der Angriffsfläche",
  exploitprotectionpolicywindows10settingcatalog: "Endpunktsicherheit: Exploit-Schutz",
  // Intune: Apps
  appprotectionpolicyios: "App-Schutz: iOS/iPadOS",
  appprotectionpolicyandroid: "App-Schutz: Android",
  appconfigurationpolicy: "App-Konfiguration",
  // Intune: Registrierung
  deviceenrollmentplatformrestriction: "Registrierung: Plattformbeschränkungen",
  deviceenrollmentlimitrestriction: "Registrierung: Gerätelimit",
  deviceenrollmentstatuspagewindows10: "Registrierung: Statusseite (Windows)",
  windowsautopilotdeploymentprofileazureadjoined: "Autopilot: Entra-Join",
  windowsautopilotdeploymentprofileazureadhybridjoined: "Autopilot: Hybrid-Join",
  // SharePoint und OneDrive (eigener Abruf über Microsoft Graph)
  tenantsettings: "Mandanteneinstellungen",
};

/** Name eines Bereichs; unbekannte Bereiche erscheinen mit ihrem technischen Namen. */
export function areaLabel(area: string): string {
  return AREA_LABELS[area.toLowerCase()] ?? area;
}

/** CSS-Klasse für den Status einer Änderung (Farbe nach docs/design.md, Kapitel 4). */
export function statusClass(status: string): string {
  if (status === "gewollt") {
    return "pill pill-ok";
  }
  return status === "ungewollt" ? "pill pill-bad" : "pill pill-todo";
}

// --- Empfehlungen (Microsoft Secure Score) ---------------------------------------------

export interface Recommendation {
  id: number;
  control_id: string;
  title: string;
  category: string | null;
  service: string | null;
  user_impact: string | null;
  implementation_cost: string | null;
  rank: number | null;
  score: number | null;
  max_score: number;
  fulfilled: boolean;
  status_text: string | null;
  deprecated: boolean;
  active: boolean;
  linked_settings: number;
}

export type RecommendationView = "offen" | "erfuellt" | "alle";

export interface RecommendationList {
  /** Der Abruf ist in dieser Installation eingeschaltet. */
  enabled: boolean;
  fetched_at: string | null;
  score: number;
  max_score: number;
  open_count: number;
  fulfilled_count: number;
  entries: Recommendation[];
}

export interface LinkedSetting {
  id: number;
  path: string;
  workload: string;
  object_name: string | null;
  property: string;
  active: boolean;
}

export interface RecommendationDetail {
  recommendation: Recommendation;
  remediation: string | null;
  action_url: string | null;
  action_type: string | null;
  fetched_at: string;
  settings: LinkedSetting[];
}

export function fetchRecommendations(view: RecommendationView): Promise<RecommendationList> {
  return getJson(`${BASE}/recommendations?${new URLSearchParams({ view }).toString()}`);
}

export function fetchRecommendation(id: number): Promise<RecommendationDetail> {
  return getJson(`${BASE}/recommendations/${id}`);
}

export function linkRecommendation(id: number, settingId: number): Promise<RecommendationDetail> {
  return postJson(`${BASE}/recommendations/${id}/links`, { setting_id: settingId });
}

export function unlinkRecommendation(id: number, settingId: number): Promise<RecommendationDetail> {
  return deleteJson(`${BASE}/recommendations/${id}/links/${settingId}`);
}

/** Punkte ohne unnötige Nachkommastellen, z. B. „7,5 von 10“. */
export function formatScore(score: number | null, maxScore: number): string {
  const format = (value: number) =>
    new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
  return score === null ? `– von ${format(maxScore)}` : `${format(score)} von ${format(maxScore)}`;
}

const LEVELS: Record<string, string> = { low: "gering", moderate: "mittel", high: "hoch" };

/** Microsofts Stufen (Low, Moderate, High) auf Deutsch. */
export function levelLabel(value: string | null): string {
  return value ? (LEVELS[value.toLowerCase()] ?? value) : "–";
}
