/** CSV nach RFC 4180 lesen und schreiben, Trennzeichen automatisch erkennen */

export type Delimiter = "," | ";" | "\t" | "|";

export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 10);
  const count = (line: string, d: string) => {
    let n = 0;
    let quoted = false;
    for (const c of line) {
      if (c === '"') quoted = !quoted;
      else if (c === d && !quoted) n++;
    }
    return n;
  };
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const d of [";", ",", "\t", "|"] as Delimiter[]) {
    const counts = lines.map((l) => count(l, d));
    const first = counts[0] ?? 0;
    const consistent = counts.filter((c) => c === first).length;
    const score = first * consistent;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Anführungszeichen nicht geschlossen");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CsvToJsonOptions {
  delimiter?: Delimiter;
  header: boolean;
  /** Zahlen und true/false erkennen */
  types: boolean;
}

const typed = (s: string): unknown => {
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)) return Number(s);
  if (s === "true" || s === "false") return s === "true";
  if (s === "") return null;
  return s;
};

export function csvToJson(
  text: string,
  o: CsvToJsonOptions,
): { data: unknown[]; delimiter: Delimiter; columns: number } {
  const delimiter = o.delimiter ?? detectDelimiter(text);
  const rows = parseCsv(text, delimiter).filter((r) => !(r.length === 1 && r[0] === ""));
  const conv = (s: string) => (o.types ? typed(s) : s);
  if (!o.header)
    return {
      data: rows.map((r) => r.map(conv)),
      delimiter,
      columns: Math.max(0, ...rows.map((r) => r.length)),
    };
  const [head = [], ...body] = rows;
  const names = head.map((h, i) => h.trim() || `Spalte${i + 1}`);
  const data = body.map((r) => Object.fromEntries(names.map((n, i) => [n, conv(r[i] ?? "")])));
  return { data, delimiter, columns: names.length };
}

function flatten(
  obj: unknown,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix || "Wert"] = obj;
  return out;
}

export function jsonToCsv(value: unknown, delimiter: Delimiter, flattenObjects: boolean): string {
  const arr = Array.isArray(value) ? value : [value];
  const rows: Record<string, unknown>[] = arr.map((item) =>
    flattenObjects
      ? flatten(item)
      : item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { Wert: item as unknown },
  );
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const esc = (v: unknown) => {
    const s =
      v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.includes(delimiter) || /["\r\n]/.test(s) || s !== s.trim()
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    cols.map(esc).join(delimiter),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(delimiter)),
  ].join("\r\n");
}
