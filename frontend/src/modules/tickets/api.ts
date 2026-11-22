import { deleteJson, getJson, patchJson, postJson, putJson } from "../../api";

const BASE = "/api/tickets";

import { TICKETS_PATH } from "../../navigation";

export { TICKETS_NEW_PATH, TICKETS_PATH, TICKETS_SETTINGS_PATH } from "../../navigation";

export type AreaRole = "admin" | "edit" | "read";
export type TicketStatus =
  "new" | "in_progress" | "waiting" | "reminder" | "solved" | "closed" | "merged";
export type Priority = "low" | "medium" | "high";
export type Channel = "mail" | "manual" | "phone";
export type EntryKind = "inbound" | "reply" | "note" | "system";
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
  read: "Nur lesen",
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
}

export interface Entry {
  id: string;
  kind: EntryKind;
  body: string;
  /** Zitat aus früheren Mails (eingeklappt). */
  quote: string;
  /** Beim Zusammenführen übernommen: Nummer des Quelltickets. */
  from_number: number | null;
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
  reminder_note: string;
  sla: Sla | null;
  devices_enabled: boolean;
  device: Device | null;
  merged_into: number | null;
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

export interface Device {
  id: number;
  name: string;
  kind: string;
  inventory_no: string;
  serial: string;
  /** Gehört laut IT-Bestand dem Melder. */
  reporter?: boolean;
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

export function sendReply(number: number, body: string, statusAfter: StatusAfter): Promise<Ticket> {
  return postJson(`${BASE}/${number}/replies`, { body, status_after: statusAfter });
}

export function attachmentUrl(number: number, id: string): string {
  return `${BASE}/${number}/attachments/${id}`;
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

export interface MailDesign {
  accent: string;
  footer: string;
  privacy_url: string;
  has_logo: boolean;
  default_accent: string;
}

export function fetchDesign(): Promise<MailDesign> {
  return getJson(`${SETTINGS}/design`);
}

export function saveDesign(body: {
  accent: string;
  footer: string;
  privacy_url: string;
}): Promise<MailDesign> {
  return putJson(`${SETTINGS}/design`, body);
}

export function uploadDesignLogo(contentBase64: string): Promise<MailDesign> {
  return putJson(`${SETTINGS}/design/logo`, { content_base64: contentBase64 });
}

export function deleteDesignLogo(): Promise<MailDesign> {
  return deleteJson(`${SETTINGS}/design/logo`);
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

export function searchDevices(number: number, q: string): Promise<Device[]> {
  return getJson(`${BASE}/${number}/devices?${new URLSearchParams({ q }).toString()}`);
}

export function setDevice(number: number, hardwareId: number | null): Promise<Ticket> {
  return putJson(`${BASE}/${number}/device`, { hardware_id: hardwareId });
}

export interface HardwareTickets {
  items: { number: number; subject: string; status: TicketStatus }[];
  hidden: number;
}

export function fetchHardwareTickets(hardwareId: number): Promise<HardwareTickets> {
  return getJson(`${BASE}/by-hardware/${hardwareId}`);
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
  devices_enabled: boolean;
  device_kinds: number[];
  device_suggest: boolean;
  device_in_inventory: boolean;
}

export interface WorkSettingsOut extends WorkSettings {
  kinds: { id: number; name: string }[];
}

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
