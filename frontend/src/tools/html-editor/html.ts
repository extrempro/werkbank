/**
 * HTML-Editor: Formatieren und Vorlagen. Das HTML bleibt im Browser; die Vorschau zeigt eine
 * abgeschottete Seite der Werkbank (backend/werkbank/modules/tools/html_preview.py).
 */

/** Pfad der Vorschau-Seite und Nachrichtentypen (wie im Server). */
export const PREVIEW_URL = "/api/tools/html-vorschau";
export const PREVIEW_MESSAGE = "werkbank-html-vorschau";
export const PREVIEW_READY = "werkbank-html-bereit";

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** Elemente im Fließtext: bleiben in ihrer Zeile, damit sich die Darstellung nicht ändert. */
const INLINE = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "em",
  "font",
  "i",
  "img",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

/** Inhalt bleibt unverändert. */
const RAW = new Set(["pre", "textarea", "script", "style"]);

const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;

function tagName(token: string): string {
  return (/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(token)?.[1] ?? "").toLowerCase();
}

/**
 * Rückt HTML ein: Blockelemente je eine Zeile, Fließtext mit Auszeichnungen bleibt zusammen.
 * Inhalt von pre, textarea, script und style bleibt, wie er ist.
 */
export function formatHtml(html: string, indent = "  "): string {
  const lines: string[] = [];
  let depth = 0;
  let line = "";
  const flush = () => {
    const text = line.replace(/\s+/g, " ").trim();
    if (text) {
      lines.push(indent.repeat(depth) + text);
    }
    line = "";
  };
  const tokens = html.match(TOKEN) ?? [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("<") || token === "<") {
      line += token;
      continue;
    }
    if (token.startsWith("<!")) {
      flush();
      lines.push(indent.repeat(depth) + token.trim());
      continue;
    }
    const name = tagName(token);
    const closing = token.startsWith("</");
    if (INLINE.has(name)) {
      line += token;
      continue;
    }
    if (!closing && RAW.has(name)) {
      flush();
      let raw = token;
      while (index + 1 < tokens.length) {
        index += 1;
        const next = tokens[index] ?? "";
        raw += next;
        if (next.toLowerCase().startsWith(`</${name}`)) {
          break;
        }
      }
      lines.push(indent.repeat(depth) + raw.trim());
      continue;
    }
    flush();
    if (closing) {
      depth = Math.max(0, depth - 1);
      lines.push(indent.repeat(depth) + token);
    } else {
      lines.push(indent.repeat(depth) + token);
      if (!VOID.has(name) && !token.endsWith("/>")) {
        depth += 1;
      }
    }
  }
  flush();
  return lines.join("\n");
}

export type TemplateId = "leer" | "tabelle";

export const TEMPLATES: Record<TemplateId, { label: string; html: string }> = {
  leer: { label: "Leer", html: "" },
  tabelle: {
    label: "Tabelle",
    html: `<style>
  table { border-collapse: collapse; font-family: Arial, sans-serif; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f0f2f5; }
</style>
<table>
  <tr><th>Gerät</th><th>Standort</th><th>Status</th></tr>
  <tr><td>Notebook 1</td><td>Gebäude A</td><td>in Betrieb</td></tr>
  <tr><td>Drucker 2</td><td>Gebäude B</td><td>Wartung</td></tr>
</table>`,
  },
};

/** Zeilen und Zeichen für die Statuszeile unter dem Eingabefeld. */
export function countText(html: string): { lines: number; chars: number } {
  return { lines: html === "" ? 0 : html.split("\n").length, chars: html.length };
}
