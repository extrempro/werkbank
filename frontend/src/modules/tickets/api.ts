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
/** Status, die man im Ticketkopf von Hand wählen kann (Erinnerung folgt später). */
export const SETTABLE_STATUSES: TicketStatus[] = ["in_progress", "waiting", "solved", "closed"];
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

export interface Entry {
  id: string;
  kind: EntryKind;
  body: string;
  author_name: string;
  original: boolean;
  created_at: string;
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
}

export function changeTicket(number: number, body: TicketChange): Promise<Ticket> {
  return patchJson(`${BASE}/${number}`, body);
}

export function changeDetails(
  number: number,
  body: { priority: Priority; participants: Participant[] },
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
