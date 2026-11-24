import { deleteJson, getJson, patchJson, postJson, putJson } from "../../api";

const BASE = "/api/tickets";

import { TICKETS_PATH } from "../../navigation";

export { TICKETS_NEW_PATH, TICKETS_PATH, TICKETS_SETTINGS_PATH } from "../../navigation";

export type AreaRole = "admin" | "edit";
export type TicketStatus =
  "new" | "in_progress" | "waiting" | "reminder" | "solved" | "closed" | "merged";
export type Priority = "low" | "medium" | "high";
export type Channel = "mail" | "manual" | "phone";
export type EntryKind = "inbound" | "reply" | "note" | "system" | "forward";
export type View = "open" | "mine" | "unassigned" | "waiting" | "reminder" | "done" | "all";

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "Neu",
  in_progress: "In Arbeit",
  waiting: "Wartet auf Rückmeldung",
  reminder: "Erinnerung",
  solved: "Gelöst",
  closed: "Geschlossen",
  merged: "Zusammengeführt",
};
/** Status, die man im Ticketkopf von Hand wählen kann. */
export const SETTABLE_STATUSES: TicketStatus[] = [
  "in_progress",
  "waiting",
  "reminder",
  "solved",
  "closed",
];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};
export const CHANNEL_LABELS: Record<Channel, string> = {
  mail: "E-Mail",
  manual: "Von Hand erfasst",
  phone: "Anruf",
};
export const ROLE_LABELS: Record<AreaRole, string> = {
  admin: "Bereichsverwaltung",
  edit: "Bearbeiten",
};
export const VIEW_LABELS: Record<View, string> = {
  open: "Offen",
  mine: "Mir zugewiesen",
  unassigned: "Nicht zugewiesen",
  waiting: "Wartet",
  reminder: "Erinnerung",
  done: "Gelöst und geschlossen",
  all: "Alle",
};

export interface AreaRef {
  id: number;
  name: string;
  role: AreaRole | null;
}

export interface TicketAccess {
  manager: boolean;
  settings: boolean;
  areas: AreaRef[];
}

export interface TicketItem {
  number: number;
  subject: string;
  area: AreaRef;
  status: TicketStatus;
  priority: Priority;
  assignee_oid: string | null;
  assignee_name: string;
  reporter_name: string;
  channel: Channel;
  created_at: string;
  updated_at: string;
  category: string;
  reminder_at: string | null;
  /** Frist (nur bei Bereichen mit Fristen). */
  sla_solution_due: string | null;
  sla_overdue: boolean;
}

export interface TicketList {
  items: TicketItem[];
  total: number;
  has_more: boolean;
}

export interface Participant {
  name: string;
  mail: string;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  original: boolean;
  /** Grund, warum der Anhang entfernt wurde (dann ohne Download). */
  removed_reason: string;
  /** Eingebettetes Bild: Nummer in der Nachricht, passend zu „[Bild n]“ im Text. */
  inline_number: number | null;
  /** Vorschau: Bild, PDF (neuer Tab), Text (Auszug) oder leer (nur Download). */
  preview: "image" | "pdf" | "text" | "";
}

export interface TextPreview {
  text: string;
  /** Nur die ersten 200 KB. */
  truncated: boolean;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  body: string;
  /** Zitat aus früheren Mails (eingeklappt). */
  quote: string;
  /** Beim Zusammenführen übernommen: Nummer des Quelltickets. */
  from_number: number | null;
  /** Eingehende Mails: vom Melder, von Beteiligten oder von außen. */
  origin: "reporter" | "participant" | "external" | "";
  /** Empfänger gesendeter Antworten und Weiterleitungen. */
  recipients: string;
  author_name: string;
  original: boolean;
  created_at: string;
  attachments: Attachment[];
}

export interface Person {
  oid: string;
  name: string;
}

export interface Ticket extends TicketItem {
  reporter_mail: string;
  created_by: string;
  participants: Participant[];
  entries: Entry[];
  permissions: { edit: boolean; note: boolean; assign_any: boolean; move: boolean };
  assignees: Person[];
  move_targets: AreaRef[];
  /** Eigene Objekt-ID (für „Mir zuweisen“). */
  me_oid: string;
  /** Antwort an den Melder möglich? Sonst der Grund. */
  can_reply: boolean;
  reply_hint: string;
  category_id: number | null;
  categories: Category[];
  /** Lösung (bei „Gelöst“ und danach), sonst null */
  solution: Solution | null;
  /** Aktive Lösungsarten des Bereichs zur Auswahl */
  solution_types: SolutionType[];
  reminder_note: string;
  sla: Sla | null;
  /** Rechte im IT-Bestand: Angaben zum Melder sichtbar. */
  inventory: boolean;
  reporter_inventory: ReporterInventory | null;
  merged_into: number | null;
  retention: TicketRetention;
  anonymized_at: string | null;
}

export interface SolutionType {
  id: number;
  name: string;
}

export interface Solution {
  type_id: number | null;
  type_name: string;
  text: string;
  /** In der Mail an den Melder zeigen */
  public: boolean;
}

/** Eingabe beim Wechsel auf „Gelöst“; alles freiwillig */
export interface SolutionInput {
  type_id: number | null;
  text: string;
  public: boolean;
}

export const EMPTY_SOLUTION: SolutionInput = { type_id: null, text: "", public: true };

export interface TicketRetention {
  /** Gilt im Bereich eine Aufbewahrungsfrist? */
  active: boolean;
  months: number;
  action: RetentionAction | "";
  hold_until: string | null;
  hold_reason: string;
  hold_by: string;
  /** Darf Ausnahmen setzen (Bereichsverwaltung). */
  can_manage: boolean;
}

export interface Category {
  id: number;
  name: string;
  default_priority: Priority;
}

export interface Sla {
  response_due: string | null;
  solution_due: string | null;
  response_met: boolean | null;
  solution_met: boolean | null;
  paused: boolean;
}

export interface ReporterInventory {
  positions: {
    id: number;
    number: string;
    name: string;
    department: string;
    workplaces: { id: number; number: string; room: string }[];
    devices: { id: number; name: string; kind: string; inventory_no: string }[];
  }[];
  loans: { id: number; number: string; due_on: string; overdue: boolean; items: number }[];
}

export function ticketLabel(number: number): string {
  return `T-${number}`;
}

export function ticketPath(number: number): string {
  return `${TICKETS_PATH}/${number}`;
}

/** Ticketseite aus dem Pfad: `/tickets/1042` → 1042. */
export function parseTicketPath(path: string): number | null {
  const match = /^\/tickets\/(\d{1,12})$/.exec(path);
  return match ? Number(match[1]) : null;
}

export function fetchTicketAccess(): Promise<TicketAccess> {
  return getJson(`${BASE}/me`);
}

export function fetchTickets(params: {
  view: View;
  area: number | null;
  q: string;
  offset: number;
}): Promise<TicketList> {
  const query = new URLSearchParams({ view: params.view, offset: String(params.offset) });
  if (params.area !== null) {
    query.set("area", String(params.area));
  }
  if (params.q.trim()) {
    query.set("q", params.q.trim());
  }
  return getJson(`${BASE}?${query.toString()}`);
}

export interface NewTicket {
  area_id: number;
  subject: string;
  reporter_name: string;
  reporter_mail: string | null;
  priority: Priority;
  channel: "manual" | "phone";
  body: string;
  participants: Participant[];
  assign_to_me: boolean;
  category_id: number | null;
}

export function createTicket(body: NewTicket): Promise<Ticket> {
  return postJson(BASE, body);
}

export function fetchTicket(number: number): Promise<Ticket> {
  return getJson(`${BASE}/${number}`);
}

export interface TicketChange {
  expected_status: TicketStatus;
  expected_assignee_oid: string | null;
  status: TicketStatus | null;
  change_assignee: boolean;
  assignee_oid: string | null;
  handover_note: string;
  notify_assignee: boolean;
  reminder_at: string | null;
  reminder_note: string;
  /** Bei „Gelöst“: Lösung (freiwillig) */
  solution?: SolutionInput | null;
}

export function changeTicket(number: number, body: TicketChange): Promise<Ticket> {
  return patchJson(`${BASE}/${number}`, body);
}

export function changeDetails(
  number: number,
  body: { priority: Priority; participants: Participant[]; category_id: number | null },
): Promise<Ticket> {
  return putJson(`${BASE}/${number}/details`, body);
}

export function moveTicket(
  number: number,
  areaId: number,
): Promise<{ visible: boolean; ticket: Ticket | null }> {
  return postJson(`${BASE}/${number}/move`, { area_id: areaId });
}

export function addNote(number: number, body: string): Promise<Ticket> {
  return postJson(`${BASE}/${number}/notes`, { body });
}

export type StatusAfter = "" | "waiting" | "solved";

export function sendReply(
  number: number,
  body: string,
  statusAfter: StatusAfter,
  replyAll = false,
  solution: SolutionInput | null = null,
): Promise<Ticket> {
  return postJson(`${BASE}/${number}/replies`, {
    body,
    status_after: statusAfter,
    reply_all: replyAll,
    solution: statusAfter === "solved" ? solution : null,
  });
}

export interface ForwardInput {
  to: string[];
  text: string;
  /** Eintrag, der weitergeleitet wird; null = die ursprüngliche Meldung. */
  entry_id: string | null;
  attachments: boolean;
}

export function forwardTicket(number: number, body: ForwardInput): Promise<Ticket> {
  return postJson(`${BASE}/${number}/forward`, body);
}

export function attachmentUrl(number: number, id: string): string {
  return `${BASE}/${number}/attachments/${id}`;
}

/** Bild oder PDF im Browser anzeigen (statt herunterladen). */
export function attachmentViewUrl(number: number, id: string): string {
  return `${attachmentUrl(number, id)}?view=true`;
}

/** Textdatei als Auszug (die ersten 200 KB). */
export function attachmentText(number: number, id: string): Promise<TextPreview> {
  return getJson(`${attachmentUrl(number, id)}/text`);
}

/** Größe lesbar: „12 KB“, „1,4 MB“. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

// --- Einstellungen ------------------------------------------------------------------------

export interface Grant {
  id: number;
  role: AreaRole;
  kind: "group" | "person";
  oid: string;
  name: string;
  mail: string;
  members: number | null;
}

export interface AreaSettings {
  id: number;
  name: string;
  mailbox: string;
  assignment: "first" | "round_robin";
  active: boolean;
  manage: boolean;
  grants: Grant[];
}

export interface TicketSettings {
  manager: boolean;
  areas: AreaSettings[];
}

export interface GrantInput {
  role: AreaRole;
  kind: "group" | "person";
  oid: string;
  name: string;
  mail: string;
}

export interface Found {
  oid: string;
  name: string;
  mail: string;
  detail: string;
}

const SETTINGS = `${BASE}/settings`;

export function fetchTicketSettings(): Promise<TicketSettings> {
  return getJson(SETTINGS);
}

export function createArea(body: {
  name: string;
  mailbox: string;
  admin: GrantInput;
}): Promise<AreaSettings> {
  return postJson(`${SETTINGS}/areas`, body);
}

export function updateArea(
  id: number,
  body: { name: string; mailbox: string; active: boolean },
): Promise<AreaSettings> {
  return putJson(`${SETTINGS}/areas/${id}`, body);
}

export function updateAssignment(
  id: number,
  assignment: "first" | "round_robin",
): Promise<AreaSettings> {
  return putJson(`${SETTINGS}/areas/${id}/assignment`, { assignment });
}

export function addGrant(id: number, body: GrantInput): Promise<AreaSettings> {
  return postJson(`${SETTINGS}/areas/${id}/grants`, body);
}

export function removeGrant(id: number, grantId: number): Promise<AreaSettings> {
  return deleteJson(`${SETTINGS}/areas/${id}/grants/${grantId}`);
}

export function searchEntra(kind: "group" | "person", q: string): Promise<Found[]> {
  const path = kind === "group" ? "groups" : "people";
  return getJson(`${SETTINGS}/${path}?${new URLSearchParams({ q }).toString()}`);
}

// --- E-Mail ---------------------------------------------------------------------------------

export type MailEvent = "in_progress" | "assignee" | "waiting" | "solved" | "closed" | "sla_missed";
export const MAIL_EVENT_LABELS: Record<MailEvent, string> = {
  in_progress: "In Arbeit",
  assignee: "Wechsel der Zuständigkeit",
  waiting: "Wartet auf Rückmeldung",
  solved: "Gelöst",
  closed: "Geschlossen",
  sla_missed: "Frist nicht eingehalten",
};
export const TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  gif: "GIF",
  webp: "WebP",
  docx: "Word (.docx)",
  xlsx: "Excel (.xlsx)",
  pptx: "PowerPoint (.pptx)",
  txt: "Text",
  csv: "CSV",
  eml: "Mail (.eml)",
  msg: "Outlook-Mail (.msg)",
  zip: "ZIP",
};

export interface MailSettings {
  external_policy: "accept" | "review" | "reject";
  max_attachment_mb: number;
  allowed_types: string[];
  processed_days: number;
  ignored_days: number;
  /** „Letzte Eingänge“ ohne Ticket löschen nach (Tagen) */
  intake_log_days: number;
  /** „Zu prüfen“ ohne Entscheidung verwerfen nach (Tagen) */
  review_days: number;
  reopen_policy: "days" | "always" | "new";
  reopen_days: number;
  sender_name: string;
  header_title: string;
  signature: string;
  ack_enabled: boolean;
  ack_text: string;
  mail_events: Record<MailEvent, boolean>;
}

export interface MailSettingsOut extends MailSettings {
  area_id: number;
  mailbox: string;
  mail_configured: boolean;
  internal_domains: string[];
  checked_at: string | null;
  error: string;
  default_ack: string;
  event_texts: Record<MailEvent, string>;
  all_types: string[];
}

export function fetchMailSettings(areaId: number): Promise<MailSettingsOut> {
  return getJson(`${SETTINGS}/areas/${areaId}/mail`);
}

export function saveMailSettings(areaId: number, body: MailSettings): Promise<MailSettingsOut> {
  return putJson(`${SETTINGS}/areas/${areaId}/mail`, body);
}

export interface Block {
  id: number;
  value: string;
}

export function fetchBlocks(areaId: number): Promise<Block[]> {
  return getJson(`${SETTINGS}/areas/${areaId}/blocks`);
}

export function addBlock(areaId: number, value: string): Promise<Block[]> {
  return postJson(`${SETTINGS}/areas/${areaId}/blocks`, { value });
}

export function removeBlock(areaId: number, id: number): Promise<Block[]> {
  return deleteJson(`${SETTINGS}/areas/${areaId}/blocks/${id}`);
}

export interface Intake {
  created_at: string;
  sender: string;
  subject: string;
  result: string;
  detail: string;
  ticket_number: number | null;
}

export const INTAKE_LABELS: Record<string, string> = {
  neu: "Neues Ticket",
  antwort: "Antwort",
  doppelt: "Schon verarbeitet",
  ignoriert: "Ignoriert",
  abgelehnt: "Abgelehnt",
  zu_pruefen: "Zu prüfen",
  fehler: "Fehler",
};

export function fetchIntake(areaId: number): Promise<Intake[]> {
  return getJson(`${SETTINGS}/areas/${areaId}/intake`);
}

export interface Review {
  id: number;
  sender: string;
  sender_name: string;
  subject: string;
  received_at: string;
}

export function fetchReview(areaId: number): Promise<Review[]> {
  return getJson(`${SETTINGS}/areas/${areaId}/review`);
}

export function actOnReview(
  areaId: number,
  id: number,
  action: "anlegen" | "verwerfen" | "sperren",
): Promise<{ items: Review[]; ticket_number: number | null }> {
  return postJson(`${SETTINGS}/areas/${areaId}/review/${id}/${action}`, {});
}

// --- Arbeitshilfen (Phase 3) ---------------------------------------------------------------

export function fetchAreaCategories(areaId: number): Promise<(Category & { active: boolean })[]> {
  return getJson(`${BASE}/areas/${areaId}/categories`);
}

export interface Candidate {
  number: number;
  subject: string;
  reporter_name: string;
  status: TicketStatus;
}

export function fetchMergeCandidates(number: number, q: string): Promise<Candidate[]> {
  return getJson(`${BASE}/${number}/merge-candidates?${new URLSearchParams({ q }).toString()}`);
}

export function mergeTicket(
  number: number,
  target: number,
  notifyReporter: boolean,
): Promise<Ticket> {
  return postJson(`${BASE}/${number}/merge`, { target, notify_reporter: notifyReporter });
}

export interface TicketRefs {
  items: { number: number; subject: string; status: TicketStatus }[];
  hidden: number;
}

export interface Template {
  id: number;
  name: string;
  shortcut: string;
  kind: "reply" | "note";
  status_after: StatusAfter;
  body: string;
}

export interface TemplatesForTicket {
  templates: Template[];
  values: Record<string, string>;
  signature: string;
}

export function fetchTicketTemplates(number: number): Promise<TemplatesForTicket> {
  return getJson(`${BASE}/${number}/templates`);
}

/** Platzhalter einsetzen; unbekannte bleiben stehen. */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{(Nr|Betreff|Name|Vorname|Bearbeiter|Datum)\}/g, (match, key: string) =>
    key in values ? (values[key] ?? match) : match,
  );
}

export interface CategorySetting {
  id: number;
  name: string;
  default_priority: Priority;
  active: boolean;
}

export interface SolutionTypeSetting {
  id: number;
  name: string;
  active: boolean;
}

export function fetchSolutionTypes(areaId: number): Promise<SolutionTypeSetting[]> {
  return getJson(`${SETTINGS}/areas/${areaId}/solution-types`);
}

export function addSolutionType(
  areaId: number,
  body: { name: string; active: boolean },
): Promise<SolutionTypeSetting[]> {
  return postJson(`${SETTINGS}/areas/${areaId}/solution-types`, body);
}

export function updateSolutionType(
  areaId: number,
  id: number,
  body: { name: string; active: boolean },
): Promise<SolutionTypeSetting[]> {
  return putJson(`${SETTINGS}/areas/${areaId}/solution-types/${id}`, body);
}

export function fetchCategories(areaId: number): Promise<CategorySetting[]> {
  return getJson(`${SETTINGS}/areas/${areaId}/categories`);
}

export function addCategory(
  areaId: number,
  body: { name: string; default_priority: Priority; active: boolean },
): Promise<CategorySetting[]> {
  return postJson(`${SETTINGS}/areas/${areaId}/categories`, body);
}

export function updateCategory(
  areaId: number,
  id: number,
  body: { name: string; default_priority: Priority; active: boolean },
): Promise<CategorySetting[]> {
  return putJson(`${SETTINGS}/areas/${areaId}/categories/${id}`, body);
}

export interface WorkSettings {
  sla_enabled: boolean;
  work_days: number[];
  work_start: number;
  work_end: number;
  sla: { priority: Priority; response_minutes: number; solution_minutes: number }[];
}

export type WorkSettingsOut = WorkSettings;

export function fetchWorkSettings(areaId: number): Promise<WorkSettingsOut> {
  return getJson(`${SETTINGS}/areas/${areaId}/work`);
}

export function saveWorkSettings(areaId: number, body: WorkSettings): Promise<WorkSettingsOut> {
  return putJson(`${SETTINGS}/areas/${areaId}/work`, body);
}

export interface TemplateInput {
  name: string;
  shortcut: string;
  kind: "reply" | "note";
  status_after: StatusAfter;
  body: string;
}

export function fetchTemplates(areaId: number): Promise<Template[]> {
  return getJson(`${SETTINGS}/areas/${areaId}/templates`);
}

export function addTemplate(areaId: number, body: TemplateInput): Promise<Template[]> {
  return postJson(`${SETTINGS}/areas/${areaId}/templates`, body);
}

export function updateTemplate(
  areaId: number,
  id: number,
  body: TemplateInput,
): Promise<Template[]> {
  return putJson(`${SETTINGS}/areas/${areaId}/templates/${id}`, body);
}

export function deleteTemplate(areaId: number, id: number): Promise<Template[]> {
  return deleteJson(`${SETTINGS}/areas/${areaId}/templates/${id}`);
}

// --- Betrieb (Phase 4) ---------------------------------------------------------------------

export type RetentionAction = "anonymize" | "delete";

export const RETENTION_ACTION_LABELS: Record<RetentionAction, string> = {
  anonymize: "anonymisieren",
  delete: "vollständig löschen",
};

/** Frist als Text, z. B. 24 → „2 Jahre“, 18 → „18 Monate“, 0 → „aus“. */
export function retentionText(months: number): string {
  if (months <= 0) {
    return "aus";
  }
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 Jahr" : `${years} Jahre`;
  }
  return months === 1 ? "1 Monat" : `${months} Monate`;
}

export interface Count {
  key: string;
  label: string;
  count: number;
}

export interface Stats {
  open: number;
  mine: number;
  unassigned_new: number;
  waiting: number;
  reminder: number;
  overdue: number | null;
  sla: { met: number; total: number } | null;
  solved_recent: number;
  created_by_channel: Count[];
  open_by_category: Count[];
  /** Gelöst oder geschlossen in den letzten 30 Tagen, nach Lösungsart */
  solved_by_type: Count[];
  mine_list: TicketItem[];
  unassigned_list: TicketItem[];
}

export function fetchStats(area: number | null): Promise<Stats> {
  const query = area === null ? "" : `?area=${area}`;
  return getJson(`${BASE}/stats${query}`);
}

/** Adresse des Excel-Exports (Download über den Browser, mit Sitzung). */
export function exportUrl(view: View, area: number | null, q: string): string {
  const params = new URLSearchParams({ view });
  if (area !== null) {
    params.set("area", String(area));
  }
  if (q.trim()) {
    params.set("q", q.trim());
  }
  return `${BASE}/export?${params.toString()}`;
}

export interface RetentionDefault {
  months: number;
  action: RetentionAction;
}

export function fetchRetentionDefault(): Promise<RetentionDefault> {
  return getJson(`${SETTINGS}/retention`);
}

export function saveRetentionDefault(body: RetentionDefault): Promise<RetentionDefault> {
  return putJson(`${SETTINGS}/retention`, body);
}

export interface RetentionRun {
  started_at: string;
  anonymized: number;
  deleted: number;
  holds_expired: number;
}

export interface AreaRetention {
  custom: boolean;
  months: number;
  action: RetentionAction;
  default: RetentionDefault;
  effective_months: number;
  effective_action: RetentionAction;
  due: number;
  due_numbers: number[];
  holds: number;
  holds_expiring: number[];
  runs: RetentionRun[];
}

export interface AreaRetentionInput {
  custom: boolean;
  months: number;
  action: RetentionAction;
}

export function fetchAreaRetention(areaId: number): Promise<AreaRetention> {
  return getJson(`${SETTINGS}/areas/${areaId}/retention`);
}

export function saveAreaRetention(
  areaId: number,
  body: AreaRetentionInput,
): Promise<AreaRetention> {
  return putJson(`${SETTINGS}/areas/${areaId}/retention`, body);
}

export function previewAreaRetention(
  areaId: number,
  body: AreaRetentionInput,
): Promise<{ due: number }> {
  return postJson(`${SETTINGS}/areas/${areaId}/retention/preview`, body);
}

export function setHold(number: number, reason: string): Promise<Ticket> {
  return putJson(`${BASE}/${number}/hold`, { reason });
}

export function clearHold(number: number): Promise<Ticket> {
  return deleteJson(`${BASE}/${number}/hold`);
}

export interface AuditEntry {
  occurred_at: string;
  actor_name: string;
  area: string;
  action: string;
  ticket_number: number | null;
  details: Record<string, unknown>;
}

export function fetchAudit(
  area: number | null,
  offset: number,
): Promise<{ items: AuditEntry[]; has_more: boolean }> {
  const params = new URLSearchParams({ offset: String(offset) });
  if (area !== null) {
    params.set("area", String(area));
  }
  return getJson(`${SETTINGS}/audit?${params.toString()}`);
}

/** Bezeichnung einer Aktion im Protokoll (unbekannte bleiben, wie sie sind). */
export const AUDIT_LABELS: Record<string, string> = {
  bereich_angelegt: "Bereich angelegt",
  bereich_geaendert: "Bereich geändert",
  bereich_zuweisung: "Zuweisung geändert",
  bereich_mail_geaendert: "E-Mail-Einstellungen geändert",
  bereich_fristen_geraete: "Fristen und Geräte geändert",
  bereich_fristen: "Fristen geändert",
  pruefen_anlegen: "Zu prüfen: als Ticket angelegt",
  pruefen_verwerfen: "Zu prüfen: verworfen",
  pruefen_sperren: "Zu prüfen: Absender gesperrt",
  pruefen_verfallen: "Zu prüfen: nach Frist verworfen",
  rolle_vergeben: "Rolle vergeben",
  rolle_entzogen: "Rolle entzogen",
  kategorie_angelegt: "Kategorie angelegt",
  kategorie_geaendert: "Kategorie geändert",
  baustein_angelegt: "Textbaustein angelegt",
  baustein_geaendert: "Textbaustein geändert",
  baustein_geloescht: "Textbaustein gelöscht",
  gestaltung_geaendert: "Mail-Gestaltung geändert",
  gestaltung_logo: "Logo hochgeladen",
  gestaltung_logo_entfernt: "Logo entfernt",
  absender_gesperrt: "Absender gesperrt",
  absender_freigegeben: "Sperre aufgehoben",
  ticket_angelegt: "Ticket angelegt",
  ticket_antwort: "Antwort gesendet",
  ticket_status: "Status geändert",
  ticket_zustaendig: "Zuständigkeit geändert",
  ticket_verschoben: "Ticket verschoben",
  ticket_zusammengefuehrt: "Tickets zusammengeführt",
  ticket_geraet: "Gerät geändert",
  export: "Export als Excel",
  aufbewahrung_vorgabe: "Vorgabe der Aufbewahrung geändert",
  aufbewahrung_bereich: "Aufbewahrung des Bereichs geändert",
  aufbewahrung_lauf: "Aufbewahrungslauf",
  aufbewahrung_ausnahme: "Ausnahme gesetzt",
  aufbewahrung_ausnahme_bestaetigt: "Ausnahme bestätigt",
  aufbewahrung_ausnahme_aufgehoben: "Ausnahme aufgehoben",
  aufbewahrung_ausnahme_verfallen: "Ausnahme verfallen",
};

/** Angaben eines Protokolleintrags als kurzer Text (ohne Verschachtelung über eine Ebene hinaus). */
export function auditDetails(details: Record<string, unknown>): string {
  const show = (value: unknown): string => {
    if (value === null || value === undefined || value === "") {
      return "–";
    }
    if (typeof value === "boolean") {
      return value ? "ja" : "nein";
    }
    if (typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k} ${typeof v === "object" ? "…" : show(v)}`)
        .join(", ");
    }
    return String(value);
  };
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${show(value)}`)
    .join(" · ");
}

// --- IT-Bestand und Melder aus Entra --------------------------------------------------------

export function fetchPositionTickets(positionId: number): Promise<TicketRefs> {
  return getJson(`${BASE}/by-position/${positionId}`);
}

export interface ReporterHit {
  name: string;
  mail: string;
  detail: string;
}

export function searchReporters(q: string): Promise<ReporterHit[]> {
  return getJson(`${BASE}/people?${new URLSearchParams({ q }).toString()}`);
}
