/** Listen bereinigen und in andere Formate bringen */

export interface ListOptions {
  trim: boolean;
  removeEmpty: boolean;
  dedupe: "none" | "exact" | "ignoreCase";
  sort: "none" | "asc" | "desc" | "natural" | "length" | "reverse";
  /** Trennzeichen der Eingabe: Zeilen, oder auch Komma/Semikolon/Tab */
  splitOn: "lines" | "any";
  caseChange: "none" | "lower" | "upper";
}

export type OutputFormat =
  | "lines"
  | "comma"
  | "semicolon"
  | "space"
  | "powershell"
  | "sql"
  | "json"
  | "csv-quoted"
  | "regex";

export const outputLabels: Record<OutputFormat, string> = {
  lines: "Eine pro Zeile",
  comma: "Kommagetrennt",
  semicolon: "Semikolon (z. B. Outlook)",
  space: "Leerzeichen",
  powershell: 'PowerShell-Array @("a","b")',
  sql: "SQL IN ('a','b')",
  json: 'JSON ["a","b"]',
  "csv-quoted": '"a","b"',
  regex: "Regex a|b",
};

export function cleanList(
  input: string,
  o: ListOptions,
): { items: string[]; removedDuplicates: number; removedEmpty: number } {
  let items = input.split(o.splitOn === "lines" ? /\r?\n/ : /\r?\n|[,;\t]/);
  if (o.trim) items = items.map((s) => s.trim());
  const before = items.length;
  if (o.removeEmpty) items = items.filter((s) => s.trim() !== "");
  const removedEmpty = before - items.length;
  if (o.caseChange === "lower") items = items.map((s) => s.toLowerCase());
  if (o.caseChange === "upper") items = items.map((s) => s.toUpperCase());
  let removedDuplicates = 0;
  if (o.dedupe !== "none") {
    const seen = new Set<string>();
    items = items.filter((s) => {
      const k = o.dedupe === "ignoreCase" ? s.toLowerCase() : s;
      if (seen.has(k)) {
        removedDuplicates++;
        return false;
      }
      seen.add(k);
      return true;
    });
  }
  const collator = new Intl.Collator("de", { numeric: o.sort === "natural", sensitivity: "base" });
  if (o.sort === "asc" || o.sort === "natural") items = [...items].sort(collator.compare);
  if (o.sort === "desc") items = [...items].sort(collator.compare).reverse();
  if (o.sort === "length")
    items = [...items].sort((a, b) => a.length - b.length || collator.compare(a, b));
  if (o.sort === "reverse") items = [...items].reverse();
  return { items, removedDuplicates, removedEmpty };
}

const q = (s: string, quote: string) => `${quote}${s.split(quote).join(quote + quote)}${quote}`;

export function formatList(items: string[], f: OutputFormat): string {
  switch (f) {
    case "lines":
      return items.join("\n");
    case "comma":
      return items.join(", ");
    case "semicolon":
      return items.join("; ");
    case "space":
      return items.join(" ");
    case "powershell":
      return `@(${items.map((s) => q(s, '"').replace(/\$/g, "`$")).join(", ")})`;
    case "sql":
      return `IN (${items.map((s) => q(s, "'")).join(", ")})`;
    case "json":
      return JSON.stringify(items);
    case "csv-quoted":
      return items.map((s) => q(s, '"')).join(",");
    case "regex":
      return items.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
  }
}

/** Vergleich zweier Listen */
export function compareLists(a: string[], b: string[], ignoreCase: boolean) {
  const k = (s: string) => (ignoreCase ? s.toLowerCase() : s);
  const setA = new Set(a.map(k));
  const setB = new Set(b.map(k));
  return {
    onlyA: a.filter((s) => !setB.has(k(s))),
    onlyB: b.filter((s) => !setA.has(k(s))),
    both: a.filter((s) => setB.has(k(s))),
  };
}
