import { getJson, patchJson, postJson } from "../../api";

const BASE = "/api/evergreen";

export interface Item {
  id: number;
  number: string;
  title: string;
  service: string | null;
  source: string;
  major_change: boolean;
  rollout_date: string | null;
  step: string;
  step_title: string;
  finished: boolean;
  waiting_for_me: boolean;
  created_at: string;
}

export interface ItemList {
  entries: Item[];
  has_more: boolean;
  can_create: boolean;
}

export interface Step {
  id: string;
  title: string;
}

export interface WorkflowAction {
  id: string;
  title: string;
  comment_required: boolean;
  on_behalf: boolean;
}

export interface WorkflowEvent {
  id: number;
  occurred_at: string;
  step_title: string;
  action_title: string;
  target_title: string;
  user: string | null;
  on_behalf_of: string | null;
  comment: string | null;
  session_date: string | null;
}

export interface ItemDetail {
  item: Item;
  summary: string | null;
  departments_feedback: string | null;
  not_controllable: boolean;
  steps: Step[];
  actions: WorkflowAction[];
  events: WorkflowEvent[];
  can_edit: boolean;
}

export interface NewItem {
  title: string;
  service: string;
  summary: string;
  rollout_date: string;
  major_change: boolean;
}

export interface ItemUpdate {
  summary: string;
  departments_feedback: string;
  rollout_date: string | null;
  not_controllable: boolean;
}

export function fetchItems(view: string, offset: number): Promise<ItemList> {
  const params = new URLSearchParams({ view, offset: String(offset), limit: "50" });
  return getJson(`${BASE}/items?${params.toString()}`);
}

export function fetchItem(id: number): Promise<ItemDetail> {
  return getJson(`${BASE}/items/${id}`);
}

export function createItem(item: NewItem): Promise<Item> {
  return postJson(`${BASE}/items`, {
    title: item.title,
    service: item.service || null,
    summary: item.summary || null,
    rollout_date: item.rollout_date || null,
    major_change: item.major_change,
  });
}

export function updateItem(id: number, update: ItemUpdate): Promise<ItemDetail> {
  return patchJson(`${BASE}/items/${id}`, update);
}

export function performAction(
  id: number,
  action: string,
  expectedStep: string,
  comment: string,
  sessionDate: string,
): Promise<ItemDetail> {
  return postJson(`${BASE}/items/${id}/actions`, {
    action,
    expected_step: expectedStep,
    comment: comment || null,
    session_date: sessionDate || null,
  });
}

const dateOnly = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const DAY = 24 * 60 * 60 * 1000;
/** Ab so vielen Tagen bis zum Rollout gilt ein Vorgang als dringend (spec.md 8.4). */
export const URGENT_DAYS = 21;

export function formatDate(iso: string | null): string {
  return iso ? dateOnly.format(new Date(`${iso}T00:00:00`)) : "–";
}

/** Tage bis zum Rollout, bezogen auf den heutigen Tag. Negativ: Der Rollout hat begonnen. */
export function daysUntil(iso: string, today: Date = new Date()): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - start) / DAY);
}

/** Frist als Text, z. B. „in 12 Tagen (dringend)“. Ohne Datum ein Gedankenstrich. */
export function rolloutText(item: Pick<Item, "rollout_date" | "finished">, today?: Date): string {
  if (!item.rollout_date) {
    return "–";
  }
  const date = formatDate(item.rollout_date);
  if (item.finished) {
    return date;
  }
  const days = daysUntil(item.rollout_date, today);
  if (days < 0) {
    return `${date} (Rollout hat begonnen)`;
  }
  const when = days === 0 ? "heute" : days === 1 ? "in 1 Tag" : `in ${days} Tagen`;
  return `${date}, ${when}${days <= URGENT_DAYS ? " (dringend)" : ""}`;
}

export function isUrgent(item: Pick<Item, "rollout_date" | "finished">, today?: Date): boolean {
  return (
    !item.finished && item.rollout_date !== null && daysUntil(item.rollout_date, today) <= URGENT_DAYS
  );
}
