/**
 * Leiste „Favoriten“ und „Geöffnet“ unter „Neues Ticket“. Gespeichert auf dem Server je Person
 * (`/api/tickets/leiste`), damit sie auf jedem Gerät gleich ist; der Server zeigt nur Tickets,
 * die die Person gerade sehen darf. Im Browser liegt nur der zuletzt geladene Stand im Speicher.
 */

import { useSyncExternalStore } from "react";
import { deleteJson, errorText, getJson, postJson, putJson } from "../../api";
import type { TicketStatus } from "./api";

export interface BarTicket {
  number: number;
  subject: string;
  status: TicketStatus;
}

export const BAR_LIMITS = [5, 10, 15, 25] as const;
export type BarLimit = (typeof BAR_LIMITS)[number];

export interface TicketBarState {
  limit: number;
  compact: boolean;
  favorites: BarTicket[];
  recent: BarTicket[];
  /** Erst nach dem ersten Laden true. */
  loaded: boolean;
  /** Hinweis, wenn etwas nicht geklappt hat; sonst leer. */
  error: string;
}

const BASE = "/api/tickets/leiste";
/** Die Leiste betrifft keine Aufgaben: Zähler nicht neu laden. */
const QUIET = { quiet: true };

const EMPTY: TicketBarState = {
  limit: 15,
  compact: true,
  favorites: [],
  recent: [],
  loaded: false,
  error: "",
};

let state: TicketBarState = EMPTY;
const listeners = new Set<() => void>();

function set(next: Partial<TicketBarState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function tickets(value: unknown): BarTicket[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is BarTicket =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as BarTicket).number === "number" &&
      typeof (entry as BarTicket).subject === "string" &&
      typeof (entry as BarTicket).status === "string",
  );
}

/** Antwort des Servers übernehmen; Unerwartetes zählt als leer. */
function accept(value: unknown): void {
  const body =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  set({
    limit: typeof body.limit === "number" ? body.limit : 15,
    compact: body.compact !== false,
    favorites: tickets(body.favorites),
    recent: tickets(body.recent),
    loaded: true,
    error: "",
  });
}

function fail(fallback: string): (error: unknown) => void {
  return (error) => set({ error: errorText(error, fallback) });
}

export function useTicketBar(): TicketBarState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Für Tests: Stand zurücksetzen. */
export function resetTicketBar(): void {
  set(EMPTY);
}

/** Lädt den Stand; ohne Netz bleibt der letzte Stand stehen. */
export function loadTicketBar(): Promise<void> {
  return getJson<unknown>(BASE).then(accept, () => undefined);
}

/** Ticket wurde geöffnet: hinten anfügen, falls es noch nicht drin ist. */
export function ticketOpened(number: number): Promise<void> {
  return postJson<unknown>(`${BASE}/${number}`, undefined, QUIET).then(accept, () => undefined);
}

export function setFavorite(number: number, favorite: boolean): Promise<void> {
  return putJson<unknown>(`${BASE}/${number}/favorit`, { favorite }, QUIET).then(
    accept,
    fail("Der Favorit konnte nicht gespeichert werden."),
  );
}

export function removeFromBar(number: number): Promise<void> {
  return deleteJson<unknown>(`${BASE}/${number}`, QUIET).then(
    accept,
    fail("Das Ticket konnte nicht aus der Liste genommen werden."),
  );
}

export function clearBar(): Promise<void> {
  return deleteJson<unknown>(BASE, QUIET).then(
    accept,
    fail("Die Liste konnte nicht geleert werden."),
  );
}

/** Konto › Tickets. Fehler gehen an den Aufrufer (Rückmeldung auf der Seite). */
export async function saveBarPrefs(limit: BarLimit, compact: boolean): Promise<void> {
  accept(await putJson<unknown>(`${BASE}/einstellungen`, { limit, compact }, QUIET));
}

/** Farbe und Form des Status-Punkts (kompakte Ansicht). */
export type DotKind = "neu" | "arbeit" | "wartet" | "erledigt" | "zusammen";

export function dotKind(status: TicketStatus): DotKind {
  switch (status) {
    case "new":
      return "neu";
    case "in_progress":
      return "arbeit";
    case "waiting":
    case "reminder":
      return "wartet";
    case "solved":
    case "closed":
      return "erledigt";
    default:
      return "zusammen";
  }
}

export const DOT_LABELS: Record<DotKind, string> = {
  neu: "Neu",
  arbeit: "In Arbeit",
  wartet: "Wartet",
  erledigt: "Erledigt",
  zusammen: "Zusammengeführt",
};
