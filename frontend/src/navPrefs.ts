/**
 * Angeheftete und zuletzt besuchte Seiten. Gespeichert auf dem Server je Person
 * (`/api/navigation`); der Server nimmt nur Seiten an, die die Person sehen darf.
 * Im Browser liegt nur der zuletzt geladene Stand im Speicher (kein localStorage): Ohne Netz
 * zeigt die Navigation diesen Stand weiter. Der Service Worker speichert nichts davon.
 */

import { useSyncExternalStore } from "react";
import { deleteJson, getJson, postJson, putJson } from "./api";

export interface NavPrefs {
  pinned: string[];
  recent: string[];
}

export const PINS_MAX = 20;
/** So viele zuletzt besuchte Seiten zeigt die Navigation. */
export const RECENT_SHOWN = 5;
const BASE = "/api/navigation";
/** Anheften und Besuche betreffen keine Aufgaben: Zähler nicht neu laden. */
const QUIET = { quiet: true };

interface State extends NavPrefs {
  /** Hinweis, wenn Speichern nicht geklappt hat; sonst leer. */
  error: string;
}

let state: State = { pinned: [], recent: [], error: "" };
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function paths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.startsWith("/"))
    : [];
}

/** Antwort des Servers übernehmen; Unerwartetes zählt als leer. */
function accept(prefs: unknown): void {
  const body =
    typeof prefs === "object" && prefs !== null ? (prefs as Record<string, unknown>) : {};
  set({ pinned: paths(body.pinned), recent: paths(body.recent), error: "" });
}

export function useNavPrefs(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/** Lädt den Stand vom Server; ohne Netz bleibt der letzte Stand stehen. */
export function loadNavPrefs(): Promise<void> {
  return getJson<unknown>(BASE).then(accept, () => undefined);
}

export function isPinned(path: string): boolean {
  return state.pinned.includes(path);
}

/** Heftet eine Seite an oder löst sie. Die Anzeige wechselt sofort; scheitert das Speichern, geht sie zurück. */
export function togglePin(path: string): Promise<void> {
  const before = state.pinned;
  if (!before.includes(path) && before.length >= PINS_MAX) {
    set({ error: `Du kannst höchstens ${PINS_MAX} Seiten anheften. Löse vorher eine andere.` });
    return Promise.resolve();
  }
  const pinned = before.includes(path)
    ? before.filter((entry) => entry !== path)
    : [...before, path];
  set({ pinned, error: "" });
  return putJson<unknown>(`${BASE}/pins`, { paths: pinned }, QUIET).then(accept, () =>
    set({
      pinned: before,
      error: "Das hat nicht geklappt. Bitte versuche es noch einmal.",
    }),
  );
}

/** Merkt eine besuchte Seite (ohne Netz still übergangen). */
export function recordVisit(path: string): Promise<void> {
  const recent = [path, ...state.recent.filter((entry) => entry !== path)].slice(0, 10);
  set({ recent });
  return postJson<unknown>(`${BASE}/recent`, { path }, QUIET).then(accept, () => undefined);
}

export function clearRecent(): Promise<void> {
  const before = state.recent;
  set({ recent: [] });
  return deleteJson<unknown>(`${BASE}/recent`, QUIET).then(accept, () =>
    set({ recent: before, error: "„Zuletzt besucht“ ließ sich nicht leeren." }),
  );
}

/** Nur für Tests: Ausgangszustand. */
export function resetNavPrefs(prefs: NavPrefs = { pinned: [], recent: [] }): void {
  set({ ...prefs, error: "" });
}
