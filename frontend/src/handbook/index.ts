import { CHAPTERS } from "./content";
import type { Block, Chapter, Section } from "./types";

export type { Block, Chapter, PageLink, Section } from "./types";

export const HANDBOOK_PATH = "/handbuch";
const ADMIN = "Werkbank.Admin";

export function chapterPath(chapter: string, section?: string): string {
  return section ? `${HANDBOOK_PATH}/${chapter}#${section}` : `${HANDBOOK_PATH}/${chapter}`;
}

function allowed(wanted: readonly string[] | null | undefined, roles: readonly string[]): boolean {
  return !wanted || roles.includes(ADMIN) || wanted.some((role) => roles.includes(role));
}

/** Kapitel und Abschnitte, die zu den Rollen passen. Admins sehen alles. */
export function chaptersFor(roles: readonly string[], chapters = CHAPTERS): Chapter[] {
  return chapters
    .filter((chapter) => allowed(chapter.roles, roles))
    .map((chapter) => ({
      ...chapter,
      sections: chapter.sections.filter((section) => allowed(section.roles, roles)),
    }))
    .filter((chapter) => chapter.sections.length > 0);
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "text":
    case "hint":
      return block.text;
    case "list":
    case "steps":
      return block.items.join(" ");
    case "terms":
      return block.items.map(([term, meaning]) => `${term} ${meaning}`).join(" ");
  }
}

export function sectionText(section: Section): string {
  return [section.title, ...section.blocks.map(blockText)].join(" ");
}

export interface HandbookHit {
  chapter: Chapter;
  section: Section;
}

/** Abschnitte, in denen alle Wörter der Suche vorkommen; Treffer im Titel zuerst. */
export function searchHandbook(
  query: string,
  roles: readonly string[],
  limit = 8,
  chapters = CHAPTERS,
): HandbookHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const hits: (HandbookHit & { score: number })[] = [];
  for (const chapter of chaptersFor(roles, chapters)) {
    for (const section of chapter.sections) {
      const text = sectionText(section).toLowerCase();
      if (!words.every((word) => text.includes(word))) {
        continue;
      }
      const title = `${chapter.title} ${section.title}`.toLowerCase();
      const score = words.filter((word) => title.includes(word)).length;
      hits.push({ chapter, section, score });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chapter, section }) => ({ chapter, section }));
}
