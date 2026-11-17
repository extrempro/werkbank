/**
 * Kleines Markdown für die Jour-Fixe-Protokolle, ohne Abhängigkeit.
 *
 * Der Text wird in Blöcke und Inline-Teile zerlegt und als React-Elemente dargestellt, nie als
 * HTML. Unterstützt: Überschriften (#, ##, ###), Absätze, Listen (-, *, 1.), Checklisten
 * (- [ ] und - [x]), Zitate (>), Trennlinie (---), **fett**, *kursiv*, `Code` und Links
 * [Text](https://…). Links nur mit https; alles andere bleibt Text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export interface ListItem {
  /** null: keine Checkliste; sonst abgehakt oder nicht. */
  checked: boolean | null;
  content: Inline[];
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; content: Inline[] }
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "quote"; lines: Inline[][] }
  | { kind: "rule" };

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*?\*)|(_[^_\s][^_\n]*?_)/;

function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname !== "" ? url.href : null;
  } catch {
    return null;
  }
}

function pushText(out: Inline[], text: string): void {
  if (!text) {
    return;
  }
  const last = out[out.length - 1];
  if (last?.kind === "text") {
    last.text += text;
  } else {
    out.push({ kind: "text", text });
  }
}

/** Zerlegt eine Zeile in Text, fett, kursiv, Code und Links. */
export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = depth > 3 ? null : INLINE.exec(rest);
    if (!match || match.index === undefined) {
      pushText(out, rest);
      break;
    }
    pushText(out, rest.slice(0, match.index));
    const token = match[0];
    if (match[1]) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else if (match[2]) {
      out.push({ kind: "strong", children: parseInline(token.slice(2, -2), depth + 1) });
    } else if (match[3]) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (href) {
        out.push({ kind: "link", href, children: parseInline(label, depth + 1) });
      } else {
        pushText(out, token);
      }
    } else {
      out.push({ kind: "em", children: parseInline(token.slice(1, -1), depth + 1) });
    }
    rest = rest.slice(match.index + token.length);
  }
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const CHECK = /^\[( |x|X)\]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

function listItem(text: string): ListItem {
  const check = CHECK.exec(text);
  if (check) {
    return { checked: check[1] !== " ", content: parseInline(check[2] ?? "") };
  }
  return { checked: null, content: parseInline(text) };
}

/** Zerlegt den ganzen Text in Blöcke. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, content: parseInline(heading[2]?.trim() ?? "") });
      index += 1;
      continue;
    }
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET;
      const items: ListItem[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index] ?? "");
        if (!match) {
          break;
        }
        items.push(listItem(match[1] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: Inline[][] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] ?? "");
        if (!match) {
          break;
        }
        quoted.push(parseInline(match[1] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }
    const paragraph: Inline[][] = [];
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (
        next.trim() === "" ||
        HEADING.test(next) ||
        BULLET.test(next) ||
        NUMBERED.test(next) ||
        QUOTE.test(next) ||
        RULE.test(next)
      ) {
        break;
      }
      paragraph.push(parseInline(next));
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

/** Erste Zeilen als reiner Text, z. B. für eine Vorschau in der Übersicht. */
export function plainExcerpt(source: string, maxLines = 4): string[] {
  const toText = (parts: Inline[]): string =>
    parts
      .map((part) =>
        part.kind === "text" || part.kind === "code" ? part.text : toText(part.children),
      )
      .join("");
  const out: string[] = [];
  for (const block of parseMarkdown(source)) {
    if (block.kind === "heading") {
      out.push(toText(block.content));
    } else if (block.kind === "list") {
      out.push(...block.items.map((item) => toText(item.content)));
    } else if (block.kind === "paragraph" || block.kind === "quote") {
      out.push(...block.lines.map(toText));
    }
    if (out.length >= maxLines) {
      break;
    }
  }
  return out.slice(0, maxLines);
}

export type Format = "bold" | "italic" | "heading" | "bullet" | "numbered" | "check" | "link";

export interface Edit {
  value: string;
  /** Neue Auswahl im Textfeld. */
  start: number;
  end: number;
}

const LINE_PREFIX: Partial<Record<Format, string>> = {
  heading: "## ",
  bullet: "- ",
  numbered: "1. ",
  check: "- [ ] ",
};

/**
 * Wendet eine Formatierung der Leiste auf die Auswahl an: fett und kursiv umschließen sie,
 * Überschrift und Listen setzen ein Zeichen an den Anfang jeder ausgewählten Zeile, ein Link
 * macht aus der Auswahl den Linktext.
 */
export function applyFormat(value: string, start: number, end: number, format: Format): Edit {
  const selected = value.slice(start, end);
  const prefix = LINE_PREFIX[format];
  if (prefix !== undefined) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const changed = block
      .split("\n")
      .map((line, index) => (format === "numbered" ? `${index + 1}. ` : prefix) + line)
      .join("\n");
    const next = value.slice(0, lineStart) + changed + value.slice(end);
    return { value: next, start: lineStart, end: lineStart + changed.length };
  }
  if (format === "link") {
    const label = selected || "Linktext";
    const inserted = `[${label}](https://)`;
    const next = value.slice(0, start) + inserted + value.slice(end);
    // Die Adresse ist ausgewählt, damit man sie gleich eintippen kann.
    const urlStart = start + label.length + 3;
    return { value: next, start: urlStart, end: urlStart + "https://".length };
  }
  const mark = format === "bold" ? "**" : "*";
  const text = selected || (format === "bold" ? "fett" : "kursiv");
  const next = value.slice(0, start) + mark + text + mark + value.slice(end);
  return { value: next, start: start + mark.length, end: start + mark.length + text.length };
}
