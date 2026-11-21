import { getJson, postJson } from "../../api";

const BASE = "/api/evergreen";
export const PAGE_SIZE = 50;

/** Unterabschnitte (Software); weitere kommen später dazu. */
export const SOFTWARE: Record<string, string> = { m365: "Microsoft 365" };
export type SoftwareKey = "m365";

export type EntryStatus = "neu" | "bearbeitet" | "abgeschlossen";
export type EntryFilter = "offen" | EntryStatus | "alle";

export const ENTRY_STATES: Record<EntryStatus, { label: string; pill: string }> = {
  neu: { label: "Neu", pill: "pill-info" },
  bearbeitet: { label: "Bearbeitet", pill: "pill-todo" },
  abgeschlossen: { label: "Abgeschlossen", pill: "pill-ok" },
};

export const ENTRY_FILTERS: { id: EntryFilter; label: string }[] = [
  { id: "offen", label: "Offen" },
  { id: "neu", label: "Neu" },
  { id: "bearbeitet", label: "Bearbeitet" },
  { id: "abgeschlossen", label: "Abgeschlossen" },
  { id: "alle", label: "Alle" },
];

export const SOURCE_LABELS: Record<string, string> = {
  nachrichtencenter: "Nachrichtencenter",
  manuell: "Von Hand",
  aenderung: "Erkannte Änderung",
};

export const NOTE_LABELS: Record<string, string> = {
  notiz: "Notiz",
  abgeschlossen: "Abgeschlossen",
  geoeffnet: "Wieder geöffnet",
  aktualisiert: "Meldung aktualisiert",
};

export interface EntrySummary {
  id: number;
  number: string;
  software: string;
  title: string;
  source: string;
  source_ref: string | null;
  services: string[];
  major_change: boolean;
  action_required_by: string | null;
  status: EntryStatus;
  created_at: string;
  updated_at: string;
  last_editor: string | null;
}

export interface EntryList {
  entries: EntrySummary[];
  total: number;
  open: number;
  new: number;
  can_edit: boolean;
}

export interface Note {
  id: number;
  kind: string;
  text: string | null;
  author: string | null;
  created_at: string;
}

export interface Entry extends EntrySummary {
  category: string | null;
  published_at: string | null;
  modified_at: string | null;
  body: string | null;
  closed_at: string | null;
  notes: Note[];
  can_edit: boolean;
}

export function entriesPath(software: string): string {
  return `/evergreen/${software}`;
}

export function entryPath(software: string, id: number): string {
  return `/evergreen/${software}/${id}`;
}

/** Pfad /evergreen/<software>[/<id>] lesen. */
export function parseEvergreenPath(
  path: string,
): { software: SoftwareKey; entryId: number | null } | null {
  // „/evergreen“ allein (alte Links) führt zu Microsoft 365
  if (path === "/evergreen") {
    return { software: "m365", entryId: null };
  }
  const match = /^\/evergreen\/([a-z0-9]{1,20})(?:\/(\d{1,9}))?$/.exec(path);
  if (!match || !match[1] || !(match[1] in SOFTWARE)) {
    return null;
  }
  return { software: match[1] as SoftwareKey, entryId: match[2] ? Number(match[2]) : null };
}

export function fetchEntries(
  software: string,
  state: EntryFilter,
  query: string,
  offset: number,
  limit: number = PAGE_SIZE,
): Promise<EntryList> {
  const params = new URLSearchParams({
    software,
    state,
    offset: String(offset),
    limit: String(limit),
  });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return getJson(`${BASE}/entries?${params.toString()}`);
}

export function fetchEntry(id: number): Promise<Entry> {
  return getJson(`${BASE}/entries/${id}`);
}

export function createEntry(body: {
  software: string;
  title: string;
  body?: string;
  service?: string;
}): Promise<Entry> {
  return postJson(`${BASE}/entries`, body);
}

export function addNote(id: number, text: string): Promise<Entry> {
  return postJson(`${BASE}/entries/${id}/notes`, { text });
}

export function closeEntry(id: number, text: string): Promise<Entry> {
  return postJson(`${BASE}/entries/${id}/close`, { text: text || null });
}

export function reopenEntry(id: number, text: string): Promise<Entry> {
  return postJson(`${BASE}/entries/${id}/reopen`, { text: text || null });
}

export function createEntryFromChange(changeId: number): Promise<Entry> {
  return postJson(`${BASE}/entries/from-change`, { change_id: changeId });
}

/** Datum ohne Uhrzeit (TT.MM.JJJJ) oder „–“. */
export function formatDate(iso: string | null): string {
  if (!iso) {
    return "–";
  }
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
