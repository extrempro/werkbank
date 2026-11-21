/**
 * Aufbau des Handbuchs: Bereiche (wie in der Bereichsleiste), darin Teile (wie die Gruppen im
 * Seitenmenü) und je Thema eine Seite. Die Inhalte stehen als Daten in `content.ts` und werden
 * als Text dargestellt, nie als HTML.
 */

/** Ein Absatz, eine Liste, eine Anleitung in Schritten, ein Hinweis oder eine Begriffstabelle. */
export type Block =
  | { kind: "text"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "steps"; items: readonly string[] }
  | { kind: "hint"; text: string }
  | { kind: "terms"; items: readonly (readonly [term: string, meaning: string])[] };

/** Verweis auf eine Seite der Werkbank. */
export interface PageLink {
  to: string;
  label: string;
}

/** Ein Thema: eine Seite im Handbuch. */
export interface Topic {
  id: string;
  title: string;
  /** Nur für diese Rollen; ohne Angabe gelten die Rollen des Teils bzw. Bereichs. */
  roles?: readonly string[];
  blocks: readonly Block[];
  links?: readonly PageLink[];
  /** Zeigt zusätzlich alle Erklärungen der Info-Symbole (Begriffe A–Z). */
  glossary?: boolean;
}

/** Teil eines Bereichs mit Überschrift im Menü (z. B. „Ausgaben“ im IT-Budget). */
export interface Part {
  title: string | null;
  /** Nur für diese Rollen; ohne Angabe gelten die Rollen des Bereichs. */
  roles?: readonly string[];
  topics: readonly Topic[];
}

export interface Area {
  id: string;
  title: string;
  /** Ein Satz für die Übersicht. */
  summary: string;
  /** Wer den Bereich sieht; `null`: alle (oder wie bei Teilen und Themen angegeben). */
  roles: readonly string[] | null;
  parts: readonly Part[];
}
