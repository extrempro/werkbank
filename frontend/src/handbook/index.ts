import { AREAS } from "./content";
import type { Area, Block, Part, Topic } from "./types";

export type { Area, Block, PageLink, Part, Topic } from "./types";

export const HANDBOOK_PATH = "/handbuch";
const ADMIN = "Werkbank.Admin";

/** Adresse eines Bereichs oder eines Themas. */
export function topicPath(area: string, topic?: string): string {
  return topic ? `${HANDBOOK_PATH}/${area}/${topic}` : `${HANDBOOK_PATH}/${area}`;
}

/** Pfad /handbuch[/<bereich>[/<thema>]] lesen; anderes ergibt null. */
export function parseHandbookPath(
  path: string,
): { area: string | null; topic: string | null } | null {
  const match = /^\/handbuch(?:\/([a-z0-9-]{1,60})(?:\/([a-z0-9-]{1,60}))?)?$/.exec(path);
  if (!match) {
    return null;
  }
  return { area: match[1] ?? null, topic: match[2] ?? null };
}

function allowed(wanted: readonly string[] | null | undefined, roles: readonly string[]): boolean {
  return !wanted || roles.includes(ADMIN) || wanted.some((role) => roles.includes(role));
}

/** Rollen, für die ein Thema gilt (Thema, sonst Teil, sonst Bereich); `null`: alle. */
export function topicRoles(area: Area, part: Part, topic: Topic): readonly string[] | null {
  return topic.roles ?? part.roles ?? area.roles;
}

/** Bereiche, Teile und Themen, die zu den Rollen passen. Admins sehen alles. */
export function areasFor(roles: readonly string[], areas = AREAS): Area[] {
  return areas
    .map((area) => ({
      ...area,
      parts: area.parts
        .map((part) => ({
          ...part,
          topics: part.topics.filter((topic) => allowed(topicRoles(area, part, topic), roles)),
        }))
        .filter((part) => part.topics.length > 0),
    }))
    .filter((area) => area.parts.length > 0);
}

export interface TopicRef {
  area: Area;
  part: Part;
  topic: Topic;
}

/** Alle sichtbaren Themen in der Reihenfolge des Menüs. */
export function topicsFor(roles: readonly string[], areas = AREAS): TopicRef[] {
  return areasFor(roles, areas).flatMap((area) =>
    area.parts.flatMap((part) => part.topics.map((topic) => ({ area, part, topic }))),
  );
}

/** Ein sichtbares Thema oder null. */
export function findTopic(
  roles: readonly string[],
  areaId: string,
  topicId: string,
  areas = AREAS,
): TopicRef | null {
  return (
    topicsFor(roles, areas).find((ref) => ref.area.id === areaId && ref.topic.id === topicId) ??
    null
  );
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

export function topicText(topic: Topic): string {
  return [topic.title, ...topic.blocks.map(blockText)].join(" ");
}

/** Themen, in denen alle Wörter der Suche vorkommen; Treffer im Titel zuerst. */
export function searchHandbook(
  query: string,
  roles: readonly string[],
  limit = 8,
  areas = AREAS,
): TopicRef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const hits: (TopicRef & { score: number })[] = [];
  for (const ref of topicsFor(roles, areas)) {
    const text = topicText(ref.topic).toLowerCase();
    if (!words.every((word) => text.includes(word))) {
      continue;
    }
    const title = `${ref.area.title} ${ref.topic.title}`.toLowerCase();
    const score = words.filter((word) => title.includes(word)).length;
    hits.push({ ...ref, score });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ area, part, topic }) => ({ area, part, topic }));
}
