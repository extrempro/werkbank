import { getJson, postJson, putJson } from "../../../api";
import type { BadgeStyle } from "./badges";

const BASE = "/api/tickets/erfolge";

export type CategoryId = "chronist" | "quelle" | "staffel" | "ordnung" | "atem" | "bruecke";
export type ShowcaseId = CategoryId | "allrounder";

export interface CategoryState {
  id: CategoryId;
  name: string;
  count: number;
  level: number;
  current_at: number;
  next_at: number | null;
}

export interface LevelRef {
  id: ShowcaseId;
  name: string;
  level: number;
}

export interface Achievements {
  enabled: boolean;
  audience: "me" | "areas";
  toast: boolean;
  style: BadgeStyle;
  showcase: ShowcaseId[];
  categories: CategoryState[];
  allrounder: number;
  wreaths: number[];
  total: number;
  new: LevelRef[];
}

export interface AchievementSettings {
  enabled: boolean;
  audience: "me" | "areas";
  toast: boolean;
  style: BadgeStyle;
}

export interface Peek {
  total: number;
  showcase: LevelRef[];
}

/** Symbol je Kategorie (steht in jedem Stil im Abzeichen). */
export const GLYPHS: Record<ShowcaseId, string> = {
  chronist: "✒",
  quelle: "✷",
  staffel: "⇄",
  ordnung: "⚖",
  atem: "⌛",
  bruecke: "∞",
  allrounder: "✪",
};

/** Was je Kategorie zählt (für Karten und Handbuch). */
export const WHAT_COUNTS: Record<ShowcaseId, string> = {
  chronist: "Gelöste Tickets mit beschriebener Lösung",
  quelle: "Deine Textbausteine, wenn andere sie nutzen",
  staffel: "Eigene Tickets mit Übergabenotiz weitergegeben",
  ordnung: "Doppelte Tickets zusammengeführt",
  atem: "Gelöste Tickets, die über einen Monat offen waren",
  bruecke: "Weiterleitungen nach außen, auf die eine Antwort kam",
  allrounder: "Die Stufe, die du in mindestens drei Kategorien erreicht hast",
};

export function fetchAchievements(): Promise<Achievements> {
  return getJson(BASE);
}

export function saveAchievementSettings(body: AchievementSettings): Promise<Achievements> {
  return putJson(BASE, body);
}

export function saveShowcase(ids: ShowcaseId[]): Promise<Achievements> {
  return putJson(`${BASE}/vitrine`, { ids });
}

export function markSeen(): Promise<Achievements> {
  return postJson(`${BASE}/gesehen`, {});
}

export function fetchPeek(oid: string): Promise<Peek> {
  return getJson(`${BASE}/personen/${encodeURIComponent(oid)}`);
}
