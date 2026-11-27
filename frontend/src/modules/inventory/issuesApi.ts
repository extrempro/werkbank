import { deleteJson, getJson, postJson, putJson } from "../../api";
import { INVENTORY_ISSUES_PATH, INVENTORY_RETURNS_PATH } from "../../navigation";

const BASE = "/api/inventory";
const PAGE_SIZE = 50;

export type IssueReason = "neu" | "ersatz" | "zusatz";
export type IssueState = "vorbereitung" | "bereit" | "uebergeben" | "abgebrochen";
export type IssueFilter = "laufend" | IssueState | "alle";
export type IssueCondition = "neuwertig" | "gebraucht" | "maengel";
export type ConfirmMethod = "unterschrift" | "link";
export type ReturnState = "offen" | "abgeschlossen";
export type ReturnFilter = ReturnState | "alle";
export type ReturnItemState = "offen" | "zurueck" | "fehlt";
export type ReturnCondition = "in_ordnung" | "maengel" | "defekt";

export const REASON_LABELS: Record<IssueReason, string> = {
  neu: "Neu an der Stelle",
  ersatz: "Ersatz",
  zusatz: "Zusätzlich",
};

export const CONDITION_LABELS: Record<IssueCondition, string> = {
  neuwertig: "neuwertig",
  gebraucht: "gebraucht, ohne Mängel",
  maengel: "gebraucht, mit Mängeln",
};

export const RETURN_CONDITION_LABELS: Record<ReturnCondition, string> = {
  in_ordnung: "in Ordnung",
  maengel: "mit Mängeln",
  defekt: "defekt",
};

export const ISSUE_STATES: Record<IssueState, { label: string; pill: string }> = {
  vorbereitung: { label: "In Vorbereitung", pill: "pill-info" },
  bereit: { label: "Bereit zur Abholung", pill: "pill-todo" },
  uebergeben: { label: "Übergeben", pill: "pill-ok" },
  abgebrochen: { label: "Abgebrochen", pill: "pill-neutral" },
};

export const ISSUE_FILTERS: { id: IssueFilter; label: string }[] = [
  { id: "laufend", label: "Laufend" },
  { id: "vorbereitung", label: "In Vorbereitung" },
  { id: "bereit", label: "Bereit" },
  { id: "uebergeben", label: "Übergeben" },
  { id: "abgebrochen", label: "Abgebrochen" },
  { id: "alle", label: "Alle" },
];

export const RETURN_STATES: Record<ReturnState, { label: string; pill: string }> = {
  offen: { label: "Offen", pill: "pill-todo" },
  abgeschlossen: { label: "Abgeschlossen", pill: "pill-ok" },
};

export const RETURN_FILTERS: { id: ReturnFilter; label: string }[] = [
  { id: "offen", label: "Offen" },
  { id: "abgeschlossen", label: "Abgeschlossen" },
  { id: "alle", label: "Alle" },
];

export const RETURN_REASONS: Record<string, string> = {
  austritt: "Konto in Entra deaktiviert",
  manuell: "von Hand gestartet",
};

export interface Accessory {
  id: number;
  kind_id: number;
  kind: string;
  name: string;
}

export interface ChecklistTemplate {
  id: number;
  reason: IssueReason | null;
  kind_id: number | null;
  kind: string;
  label: string;
}

export interface IssueSettings {
  rules_text: string;
  accessories: Accessory[];
  templates: ChecklistTemplate[];
}

export interface IssueSummary {
  id: number;
  number: string;
  person_name: string;
  position: string;
  reason: IssueReason;
  state: IssueState;
  items: number;
  tasks: number;
  tasks_done: number;
  created_at: string;
  handed_at: string | null;
}

export interface IssueItem {
  hardware_id: number;
  name: string;
  kind: string;
  serial: string;
  inventory_no: string | null;
  accessories: string[];
}

export interface IssueTask {
  id: number;
  label: string;
  hardware_id: number | null;
  done: boolean;
  done_at: string | null;
}

export interface IssueMessage {
  channel: "mail" | "teams";
  status: "offen" | "gesendet" | "fehler" | "aus";
  created_at: string;
  sent_at: string | null;
}

export interface Issue extends IssueSummary {
  person_upn: string;
  has_address: boolean;
  position_id: number;
  condition: IssueCondition;
  condition_note: string;
  attach_rules: boolean;
  notify_teams: boolean;
  confirm_method: ConfirmMethod;
  pickup_place: string;
  pickup_at: string | null;
  link_expires_at: string | null;
  has_signature: boolean;
  signed_name: string;
  confirmed_via: string;
  rules_text: string;
  ready_at: string | null;
  entries: IssueItem[];
  task_list: IssueTask[];
  messages: IssueMessage[];
}

export interface IssueList {
  issues: IssueSummary[];
  preparing: number;
  ready: number;
  total: number;
}

export interface FreeDevice {
  id: number;
  name: string;
  kind_id: number;
  kind: string;
  serial: string;
  inventory_no: string | null;
  accessories: string[];
}

export interface PersonPosition {
  id: number;
  number: string;
  name: string;
}

export interface IssueInput {
  person_oid: string;
  position_id: number;
  reason: IssueReason;
  items: { hardware_id: number; accessories: string[] }[];
  condition: IssueCondition;
  condition_note: string;
  attach_rules: boolean;
  notify_teams: boolean;
  confirm_method: ConfirmMethod;
}

export interface PublicIssue {
  number: string;
  person_name: string;
  entries: IssueItem[];
  rules_text: string;
  confirmed: boolean;
}

export interface ReturnSummary {
  id: number;
  number: string;
  person_name: string;
  reason: string;
  state: ReturnState;
  items: number;
  items_back: number;
  items_missing: number;
  created_at: string;
  closed_at: string | null;
}

export interface ReturnItem {
  id: number;
  hardware_id: number;
  name: string;
  kind: string;
  serial: string;
  inventory_no: string | null;
  source: string;
  state: ReturnItemState;
  condition: ReturnCondition;
  room_id: number | null;
  room: string;
  accessories_ok: boolean;
  wiped: boolean;
}

export interface Return extends ReturnSummary {
  entries: ReturnItem[];
}

export interface ReturnList {
  returns: ReturnSummary[];
  open: number;
  total: number;
}

export interface ReturnItemInput {
  state: ReturnItemState;
  condition: ReturnCondition;
  room_id: number | null;
  accessories_ok: boolean;
  wiped: boolean;
}

function listQuery(state: string, query: string, offset: number, limit: number): string {
  const params = new URLSearchParams({
    state,
    offset: String(offset),
    limit: String(limit),
  });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return params.toString();
}

// --- Pfade ---------------------------------------------------------------------------------

export function issuePath(id: number | "neu"): string {
  return `${INVENTORY_ISSUES_PATH}/${id}`;
}

export function returnPath(id: number): string {
  return `${INVENTORY_RETURNS_PATH}/${id}`;
}

export function parseIssuePath(path: string): { id: number | "neu" | null } | null {
  if (path === INVENTORY_ISSUES_PATH) {
    return { id: null };
  }
  if (path === `${INVENTORY_ISSUES_PATH}/neu`) {
    return { id: "neu" };
  }
  const match = /^\/bestand\/ausgaben\/(\d{1,9})$/.exec(path);
  return match ? { id: Number(match[1]) } : null;
}

export function parseReturnPath(path: string): { id: number | null } | null {
  if (path === INVENTORY_RETURNS_PATH) {
    return { id: null };
  }
  const match = /^\/bestand\/rueckgaben\/(\d{1,9})$/.exec(path);
  return match ? { id: Number(match[1]) } : null;
}

/** Kennung im Einmal-Link `/bestaetigen/<token>` oder null. */
export function parseConfirmPath(path: string): string | null {
  const match = /^\/bestaetigen\/([A-Za-z0-9_-]{20,100})$/.exec(path);
  return match?.[1] ?? null;
}

/** Datum und Uhrzeit für ein Feld `datetime-local` (Ortszeit) aus ISO, und zurück. */
export function toLocalInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "–";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "–"
    : `${date.toLocaleDateString("de-DE")}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

/** Freie Geräte nach Name, Art, Seriennummer oder Inventurnummer. */
export function filterFree(devices: readonly FreeDevice[], query: string): FreeDevice[] {
  const term = query.trim().toLowerCase();
  if (!term) {
    return [...devices];
  }
  return devices.filter((device) =>
    [device.name, device.kind, device.serial, device.inventory_no ?? ""].some((part) =>
      part.toLowerCase().includes(term),
    ),
  );
}

// --- Stammdaten ----------------------------------------------------------------------------

export function fetchIssueSettings(): Promise<IssueSettings> {
  return getJson(`${BASE}/issue-settings`);
}

export function saveRules(text: string): Promise<IssueSettings> {
  return putJson(`${BASE}/issue-settings/rules`, { text }, { quiet: true });
}

export function addAccessory(kindId: number, name: string): Promise<IssueSettings> {
  return postJson(`${BASE}/accessories`, { kind_id: kindId, name }, { quiet: true });
}

export function removeAccessory(id: number): Promise<IssueSettings> {
  return deleteJson(`${BASE}/accessories/${id}`, { quiet: true });
}

export function addTemplate(
  target: { reason: IssueReason } | { kind_id: number },
  label: string,
): Promise<IssueSettings> {
  return postJson(`${BASE}/checklist-templates`, { ...target, label }, { quiet: true });
}

export function removeTemplate(id: number): Promise<IssueSettings> {
  return deleteJson(`${BASE}/checklist-templates/${id}`, { quiet: true });
}

// --- Ausgabe -------------------------------------------------------------------------------

export function fetchIssues(
  filter: IssueFilter,
  query = "",
  offset = 0,
  limit = PAGE_SIZE,
): Promise<IssueList> {
  return getJson(`${BASE}/issues?${listQuery(filter, query, offset, limit)}`);
}

export function fetchIssue(id: number): Promise<Issue> {
  return getJson(`${BASE}/issues/${id}`);
}

export function fetchFreeDevices(): Promise<FreeDevice[]> {
  return getJson(`${BASE}/issues/free-devices`);
}

export function fetchPersonPositions(oid: string): Promise<PersonPosition[]> {
  return getJson(`${BASE}/issues/positions?oid=${encodeURIComponent(oid)}`);
}

export function createIssue(body: IssueInput): Promise<Issue> {
  return postJson(`${BASE}/issues`, body, { quiet: true });
}

export function addIssueTask(id: number, label: string): Promise<Issue> {
  return postJson(`${BASE}/issues/${id}/tasks`, { label }, { quiet: true });
}

export function setIssueTask(id: number, taskId: number, done: boolean): Promise<Issue> {
  return putJson(`${BASE}/issues/${id}/tasks/${taskId}`, { done }, { quiet: true });
}

export function setIssuePickup(id: number, place: string, at: string | null): Promise<Issue> {
  return putJson(`${BASE}/issues/${id}/pickup`, { place, at }, { quiet: true });
}

export function markIssueReady(id: number): Promise<Issue> {
  return postJson(`${BASE}/issues/${id}/ready`, {}, { quiet: true });
}

export function renewIssueLink(id: number): Promise<Issue> {
  return postJson(`${BASE}/issues/${id}/link`, {}, { quiet: true });
}

export function handOverIssue(
  id: number,
  body: { signature_png?: string; signed_name?: string },
): Promise<Issue> {
  return postJson(`${BASE}/issues/${id}/handover`, body, { quiet: true });
}

export function cancelIssue(id: number): Promise<Issue> {
  return postJson(`${BASE}/issues/${id}/cancel`, {}, { quiet: true });
}

export function signatureUrl(id: number): string {
  return `${BASE}/issues/${id}/signature`;
}

// --- Einmal-Link (ohne Anmeldung) ----------------------------------------------------------

export function fetchPublicIssue(token: string): Promise<PublicIssue> {
  return getJson(`/api/public/ausgabe/${token}`);
}

export function confirmPublicIssue(token: string): Promise<PublicIssue> {
  return postJson(`/api/public/ausgabe/${token}`, { accepted: true }, { quiet: true });
}

// --- Rückgabe ------------------------------------------------------------------------------

export function fetchReturns(
  filter: ReturnFilter,
  query = "",
  offset = 0,
  limit = PAGE_SIZE,
): Promise<ReturnList> {
  return getJson(`${BASE}/returns?${listQuery(filter, query, offset, limit)}`);
}

export function fetchReturn(id: number): Promise<Return> {
  return getJson(`${BASE}/returns/${id}`);
}

export function startReturn(positionId: number): Promise<Return> {
  return postJson(`${BASE}/returns`, { position_id: positionId }, { quiet: true });
}

export function updateReturnItem(
  id: number,
  itemId: number,
  body: ReturnItemInput,
): Promise<Return> {
  return putJson(`${BASE}/returns/${id}/items/${itemId}`, body, { quiet: true });
}

export function completeReturn(id: number): Promise<Return> {
  return postJson(`${BASE}/returns/${id}/complete`, {}, { quiet: true });
}
