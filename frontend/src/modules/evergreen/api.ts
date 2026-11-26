import { getJson, postJson, putJson } from "../../api";
import type { LookupResult } from "../inventory/api";

const BASE = "/api/evergreen";
/** Mehr lädt die Liste nicht; darüber ein Hinweis, die Suche einzugrenzen. */
export const LIST_MAX = 500;

/** Unterabschnitte (Software); weitere kommen später dazu. */
export const SOFTWARE: Record<string, string> = { m365: "Microsoft 365" };
export type SoftwareKey = "m365";

export type EntryStatus = "neu" | "bearbeitet" | "abgeschlossen";
export type EntryFilter = "offen" | "neu" | "frist" | "abgeschlossen";

export const ENTRY_STATES: Record<EntryStatus, { label: string; pill: string }> = {
  neu: { label: "Neu", pill: "pill-info" },
  bearbeitet: { label: "Bearbeitet", pill: "pill-todo" },
  abgeschlossen: { label: "Abgeschlossen", pill: "pill-ok" },
};

export const ENTRY_FILTERS: { id: EntryFilter; label: string }[] = [
  { id: "offen", label: "Offen" },
  { id: "neu", label: "Neu" },
  { id: "frist", label: "Mit Frist" },
  { id: "abgeschlossen", label: "Abgeschlossen" },
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
  zeitplan: "Zeitplan geändert",
  bewertet: "Bewertung geändert",
  kategorie: "Kategorie geändert",
};

export type DefaultState = "an" | "aus" | "entfaellt";
export type Codetermination = "ja" | "nein" | "pruefen";

export const DEFAULT_STATES: Record<DefaultState, string> = {
  an: "Eingeschaltet",
  aus: "Ausgeschaltet",
  entfaellt: "Entfällt",
};

export const CODETERMINATION: Record<Codetermination, { label: string; pill: string }> = {
  ja: { label: "Ja", pill: "pill-bad" },
  nein: { label: "Nein", pill: "pill-ok" },
  pruefen: { label: "Noch prüfen", pill: "pill-todo" },
};

/** Farbe des Badges „Art“ (Abkündigung rot, sonst blau, Information grau). */
export function kindPill(kind: string): string {
  if (kind === "Abkündigung") {
    return "pill-bad";
  }
  return kind === "Information" ? "pill-neutral" : "pill-info";
}

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
  kind: string | null;
  info_only: boolean;
  /** Kategorie (aus den Diensten oder von Hand) */
  topic: string;
  topic_manual: boolean;
}

export interface EntryList {
  entries: EntrySummary[];
  total: number;
  open: number;
  new: number;
  due: number;
  done: number;
  can_edit: boolean;
}

export interface NoteChange {
  field: string;
  old: string | null;
  new: string | null;
}

export interface Note {
  id: number;
  kind: string;
  text: string | null;
  author: string | null;
  created_at: string;
  changes: NoteChange[];
}

export interface Section {
  head: string | null;
  text: string;
}

/** Rollout-Phase; Beginn und Ende als Monat „JJJJ-MM“. */
export interface Phase {
  name: string;
  start: string;
  end: string;
}

export interface LinkedSetting {
  id: number;
  path: string;
  value: string | null;
  can_open: boolean;
}

export interface Assessment {
  affected: string | null;
  default_state: DefaultState | null;
  controllable: boolean | null;
  controllable_how: string | null;
  phases: Phase[];
  summary: string | null;
  staff_change: string | null;
  training: string | null;
  codetermination: Codetermination | null;
  codetermination_reason: string | null;
}

export interface Entry extends EntrySummary, Assessment {
  category: string | null;
  published_at: string | null;
  modified_at: string | null;
  body: string | null;
  closed_at: string | null;
  tags: string[];
  sections: Section[];
  schedule_previous: string | null;
  schedule_changed_at: string | null;
  phases_previous: Phase[];
  suggested: string[];
  /** Felder aus `suggested`, deren Vorschlag von der KI kommt. */
  ai_suggested: string[];
  /** Die KI schaut sich die Meldung beim nächsten Lauf an. */
  ai_pending: boolean;
  /** „KI-Vorschlag holen“ ist eingeschaltet. */
  ai_available: boolean;
  setting: LinkedSetting | null;
  notes: Note[];
  can_edit: boolean;
}

/** Neuerungen aus dem Nachrichtencenter stehen unter Microsoft 365. */
export const NEWS_PATH = "/m365/neuerungen";

export function entriesPath(): string {
  return NEWS_PATH;
}

export function entryPath(id: number): string {
  return `${NEWS_PATH}/${id}`;
}

/**
 * Pfad /m365/neuerungen[/<id>] lesen. Alte Adressen (/evergreen, /evergreen/m365[/<id>])
 * liefern `moved` mit der neuen Adresse.
 */
export function parseEvergreenPath(
  path: string,
): { software: SoftwareKey; entryId: number | null; moved: string | null } | null {
  const old = /^\/evergreen(?:\/m365(?:\/(\d{1,9}))?)?$/.exec(path);
  if (old) {
    return {
      software: "m365",
      entryId: old[1] ? Number(old[1]) : null,
      moved: old[1] ? `${NEWS_PATH}/${old[1]}` : NEWS_PATH,
    };
  }
  const match = /^\/m365\/neuerungen(?:\/(\d{1,9}))?$/.exec(path);
  if (!match) {
    return null;
  }
  return { software: "m365", entryId: match[1] ? Number(match[1]) : null, moved: null };
}

/** Kategorien der Neuerungen (wie backend/werkbank/modules/evergreen/topics.py). */
export const TOPICS = [
  "exchange",
  "teams",
  "sharepoint",
  "apps",
  "copilot",
  "sicherheit",
  "geraete",
  "allgemein",
] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  exchange: "Exchange & Outlook",
  teams: "Teams",
  sharepoint: "SharePoint & OneDrive",
  apps: "Microsoft 365 Apps",
  copilot: "Copilot & KI",
  sicherheit: "Sicherheit & Identität",
  geraete: "Geräte & Intune",
  allgemein: "Verwaltung & Allgemein",
};

/** Farbe je Kategorie (Klassen wie bei den Ticket-Bereichen); der Name steht immer dabei. */
export const TOPIC_COLORS: Record<Topic, string> = {
  exchange: "blau",
  teams: "violett",
  sharepoint: "petrol",
  apps: "orange",
  copilot: "pink",
  sicherheit: "rot",
  geraete: "gruen",
  allgemein: "grau",
};

export function topicOf(value: string): Topic {
  return (TOPICS as readonly string[]).includes(value) ? (value as Topic) : "allgemein";
}

export function setTopic(id: number, topic: Topic | null): Promise<Entry> {
  return putJson(`/api/evergreen/entries/${id}/topic`, { topic });
}

export function fetchEntries(
  software: string,
  state: EntryFilter,
  query: string,
  hideInfo: boolean,
  limit: number = LIST_MAX,
): Promise<EntryList> {
  const params = new URLSearchParams({
    software,
    state,
    hide_info: String(hideInfo),
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

export function saveAssessment(
  id: number,
  body: Assessment & { setting_id: number | null },
): Promise<Entry> {
  return putJson(`${BASE}/entries/${id}/assessment`, body);
}

/** Fragt die KI sofort nach Rollout-Phasen und Steckbrief. */
export function requestAiSuggestion(id: number): Promise<Entry> {
  return postJson(`${BASE}/entries/${id}/ai-suggestion`, {});
}

/** Einstellungen der M365-Konfiguration zum Verknüpfen (für die Auswahl mit Suche). */
export function searchSettings(query: string): Promise<LookupResult> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim().slice(0, 100));
  }
  return getJson<{
    settings: { id: number; path: string; value: string | null }[];
    more: boolean;
  }>(`${BASE}/settings?${params.toString()}`).then((result) => ({
    items: result.settings.map((item) => ({
      id: item.id,
      label: item.path,
      detail: item.value ? `Aktuell: ${item.value}` : "",
    })),
    total: result.more ? result.settings.length + 1 : result.settings.length,
  }));
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

/** Ganze Tage von heute bis zu einem Datum (negativ: vorbei). */
export function daysUntil(iso: string, today: Date = new Date()): number {
  const target = new Date(iso);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const end = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((end - start) / 86_400_000);
}
