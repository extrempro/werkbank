import { useEffect, useState, useSyncExternalStore } from "react";
import { deleteJson, getJson, postJson, putJson } from "../api";
import { TOOLS_HISTORY_PATH } from "../navigation";
import { findTool, readFavorites, saveFavorites } from "./index";

export { TOOLS_HISTORY_PATH };

/**
 * IT-Tools je Konto: Favoriten, zuletzt genutzte Tools und der Verlauf der Einstellungen.
 * Der Verlauf enthält nur, was ein Tool ohnehin in die Adresszeile schreibt.
 */

const BASE = "/api/tools";
const CHANGED = "werkbank:it-tools-konto";
const QUIET = { quiet: true };
/** So lange müssen Einstellungen unverändert bleiben, bevor sie in den Verlauf kommen. */
export const HISTORY_DELAY_MS = 2000;

export interface ToolPrefs {
  favorites: string[];
  recent: string[];
  history_enabled: boolean;
}

export interface HistoryEntry {
  id: number;
  tool: string;
  params: Record<string, string>;
  summary: string;
  created_at: string;
}

// --- Favoriten und zuletzt genutzte Tools (gemeinsamer Stand für alle Seiten) ---

let prefs: ToolPrefs = { favorites: readFavorites(), recent: [], history_enabled: true };
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ToolPrefs) {
  // Nur bekannte Tools; die Favoriten bleiben zusätzlich im Browser, falls der Server fehlt
  prefs = {
    ...next,
    favorites: next.favorites.filter((id) => findTool(id) !== undefined),
    recent: next.recent.filter((id) => findTool(id) !== undefined),
  };
  saveFavorites(prefs.favorites);
  listeners.forEach((listener) => listener());
}

function valid(value: unknown): value is ToolPrefs {
  const data = value as ToolPrefs | null;
  return (
    !!data &&
    Array.isArray(data.favorites) &&
    Array.isArray(data.recent) &&
    typeof data.history_enabled === "boolean"
  );
}

/** Lädt den Stand des Kontos einmal. Favoriten, die bisher nur im Browser lagen, wandern mit. */
export function loadPrefs(): Promise<void> {
  if (loaded) {
    return Promise.resolve();
  }
  loading ??= getJson<ToolPrefs>(`${BASE}/prefs`)
    .then(async (server) => {
      if (!valid(server)) {
        return;
      }
      const local = readFavorites();
      if (server.favorites.length === 0 && local.length > 0) {
        const merged = await putJson<ToolPrefs>(`${BASE}/prefs`, { favorites: local }, QUIET);
        publish(valid(merged) ? merged : { ...server, favorites: local });
      } else {
        publish(server);
      }
      loaded = true;
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stand der Favoriten und zuletzt genutzten Tools; lädt ihn beim ersten Mal vom Konto. */
export function useToolPrefs(): ToolPrefs {
  const current = useSyncExternalStore(subscribe, () => prefs);
  useEffect(() => {
    void loadPrefs();
  }, []);
  return current;
}

export function toggleFavorite(id: string): void {
  const favorites = prefs.favorites.includes(id)
    ? prefs.favorites.filter((entry) => entry !== id)
    : [...prefs.favorites, id];
  publish({ ...prefs, favorites });
  putJson<ToolPrefs>(`${BASE}/prefs`, { favorites }, QUIET).then(
    (saved) => valid(saved) && publish(saved),
    () => undefined,
  );
}

export function setHistoryEnabled(enabled: boolean): Promise<void> {
  return putJson<ToolPrefs>(`${BASE}/prefs`, { history_enabled: enabled }, QUIET).then((saved) => {
    if (valid(saved)) {
      publish(saved);
    }
  });
}

/** Ein Tool wurde geöffnet: vorn in „Zuletzt genutzt“. */
export function recordRecent(id: string): void {
  // Erst mit der Antwort des Servers: ohne Konto bleibt die Liste, wie sie ist
  postJson<ToolPrefs>(`${BASE}/recent`, { tool: id }, QUIET).then(
    (saved) => valid(saved) && publish(saved),
    () => undefined,
  );
}

// --- Verlauf ---

function changed() {
  window.dispatchEvent(new Event(CHANGED));
}

/** Kennung des Tools aus dem Pfad (/it-tools/<id>), sonst null. */
export function toolFromPath(path: string): string | null {
  const match = /^\/it-tools\/([a-z0-9-]{1,40})$/.exec(path);
  return match && match[1] && findTool(match[1]) ? match[1] : null;
}

let pending: number | undefined;

/** Einstellungen eines Tools vormerken; gespeichert wird, wenn sie zwei Sekunden bleiben. */
export function scheduleHistory(path: string, params: Record<string, string>): void {
  const tool = toolFromPath(path);
  window.clearTimeout(pending);
  if (!tool || !prefs.history_enabled || !Object.values(params).some((value) => value.trim())) {
    return;
  }
  pending = window.setTimeout(() => {
    postJson(`${BASE}/history`, { tool, params }, QUIET).then(changed, () => undefined);
  }, HISTORY_DELAY_MS);
}

export function fetchHistory(tool?: string, limit = 50): Promise<HistoryEntry[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (tool) {
    query.set("tool", tool);
  }
  return getJson<HistoryEntry[]>(`${BASE}/history?${query.toString()}`).then((rows) =>
    Array.isArray(rows) ? rows : [],
  );
}

export function deleteHistoryEntry(id: number): Promise<void> {
  return deleteJson(`${BASE}/history/${id}`, QUIET).then(changed);
}

export function deleteHistory(tool?: string): Promise<void> {
  const query = tool ? `?tool=${encodeURIComponent(tool)}` : "";
  return deleteJson(`${BASE}/history${query}`, QUIET).then(changed);
}

/** Lädt den Verlauf und lädt ihn nach jeder Änderung neu. */
export function useHistory(tool: string | undefined, limit: number): HistoryEntry[] | null {
  const version = useSyncExternalStore(subscribeHistory, () => historyVersion);
  return useLoaded(tool, limit, version);
}

let historyVersion = 0;
const historyListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener(CHANGED, () => {
    historyVersion += 1;
    historyListeners.forEach((listener) => listener());
  });
}

function subscribeHistory(listener: () => void): () => void {
  historyListeners.add(listener);
  return () => historyListeners.delete(listener);
}

function useLoaded(
  tool: string | undefined,
  limit: number,
  version: number,
): HistoryEntry[] | null {
  const [state, setState] = useState<{ key: string; rows: HistoryEntry[] } | null>(null);
  const key = `${tool ?? ""}|${limit}|${version}`;
  useEffect(() => {
    let active = true;
    fetchHistory(tool, limit).then(
      (rows) => active && setState({ key, rows }),
      () => active && setState({ key, rows: [] }),
    );
    return () => {
      active = false;
    };
  }, [tool, limit, key]);
  return state ? state.rows : null;
}

/** Adresse, die ein Tool mit gespeicherten Einstellungen öffnet. */
export function entryLink(entry: HistoryEntry): string {
  const query = new URLSearchParams(entry.params).toString();
  return `/it-tools/${entry.tool}${query ? `?${query}` : ""}`;
}

const dayFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Einträge nach Tag (lokale Zeit), neueste zuerst. */
export function groupByDay(
  entries: HistoryEntry[],
  now: Date = new Date(),
): [string, HistoryEntry[]][] {
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString();
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const date = new Date(entry.created_at);
    const label =
      date.toDateString() === today
        ? "Heute"
        : date.toDateString() === yesterday
          ? "Gestern"
          : dayFormat.format(date);
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return [...groups.entries()];
}
