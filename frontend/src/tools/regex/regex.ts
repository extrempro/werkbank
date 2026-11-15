/** Regulären Ausdruck auf einen Text anwenden: Treffer, Textstücke zum Markieren, Ersetzung. */

export interface RegexPart {
  text: string;
  /** Nummer des Treffers; ohne Angabe ist es Text zwischen den Treffern. */
  hit?: number;
}

export interface RegexResult {
  matches: RegExpMatchArray[];
  parts: RegexPart[];
  /** Namen benannter Gruppen je Gruppennummer (ab 1). */
  groupNames: (string | undefined)[];
  replaced: string | null;
}

export const MAX_MATCHES = 1000;

export function cleanFlags(flags: string): string {
  return [...new Set(flags)].filter((flag) => "gimsu".includes(flag)).join("");
}

/** Bei einem ungültigen Ausdruck kommt die Meldung des Browsers als `error` zurück. */
export function runRegex(
  pattern: string,
  flags: string,
  text: string,
  replacement: string | null,
): RegexResult | { error: string } {
  const clean = cleanFlags(flags);
  let all: RegExp;
  try {
    all = new RegExp(pattern, clean.includes("g") ? clean : `${clean}g`);
  } catch (caught) {
    return { error: (caught as Error).message.replace(/^Invalid regular expression: /, "") };
  }
  const found = [...text.matchAll(all)].slice(0, MAX_MATCHES);
  const matches = clean.includes("g") ? found : found.slice(0, 1);
  const parts: RegexPart[] = [];
  let last = 0;
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push({ text: text.slice(last, start) });
    }
    parts.push({ text: match[0] || "∅", hit: index });
    last = start + match[0].length;
  });
  parts.push({ text: text.slice(last) });

  const first = matches[0];
  const groupNames: (string | undefined)[] = [];
  if (first) {
    const named = Object.keys(first.groups ?? {});
    // Die Reihenfolge benannter Gruppen im Ausdruck entspricht ihrer Nummer unter den benannten.
    // Maskierte Zeichen und Zeichenklassen enthalten keine Gruppen.
    const bare = pattern.replace(/\\./g, "__").replace(/\[[^\]]*\]/g, "_");
    const order = [...bare.matchAll(/\((\?<([A-Za-z_$][\w$]*)>|(?!\?))/g)];
    order.forEach((group, index) => {
      groupNames[index + 1] = group[2] && named.includes(group[2]) ? group[2] : undefined;
    });
  }

  return {
    matches,
    parts,
    groupNames,
    replaced: replacement === null ? null : text.replace(new RegExp(pattern, clean), replacement),
  };
}
