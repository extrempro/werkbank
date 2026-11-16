/**
 * Aufbau des Handbuchs. Die Inhalte stehen als Daten in `content.ts` und werden als Text
 * dargestellt, nie als HTML.
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

export interface Section {
  id: string;
  title: string;
  /** Nur für diese Rollen; ohne Angabe gilt das Kapitel. */
  roles?: readonly string[];
  blocks: readonly Block[];
  links?: readonly PageLink[];
}

export interface Chapter {
  id: string;
  title: string;
  /** Ein Satz für die Übersicht. */
  summary: string;
  /** Wer das Kapitel sieht; `null`: alle. */
  roles: readonly string[] | null;
  sections: readonly Section[];
}
