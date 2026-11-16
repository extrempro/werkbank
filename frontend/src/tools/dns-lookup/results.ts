/**
 * Ergebnisse mehrerer Resolver zusammenführen (Vergleich) und exportieren.
 */
import { normalizeValue } from "./normalize";
import type { Resolver, ResolverResult } from "./resolvers";

export interface Cell {
  resolver: Resolver;
  result?: ResolverResult;
  error?: string;
}

export interface TypeResult {
  type: string;
  /** tatsächlich abgefragter Name (bei PTR der Reverse-Name) */
  query: string;
  cells: Cell[];
}

export interface MatrixRow {
  key: string;
  name: string;
  type: string;
  data: string;
  /** je Resolver-ID: TTL, falls vorhanden */
  ttl: Record<string, number | undefined>;
  present: Record<string, boolean>;
}

export interface Matrix {
  rows: MatrixRow[];
  /** alle erfolgreichen Resolver liefern dieselben Einträge (und denselben Status) */
  consistent: boolean;
  /** Antworten enthalten andere Namen (z. B. CNAME-Kette) */
  showNames: boolean;
}

export const rowKeyOf = (name: string, type: string, data: string) =>
  `${name.toLowerCase()}|${type}|${normalizeValue(type, data)[0]}`;

export function buildMatrix(tr: TypeResult): Matrix {
  const rows = new Map<string, MatrixRow>();
  for (const cell of tr.cells) {
    for (const a of cell.result?.answers ?? []) {
      const key = rowKeyOf(a.name, a.type, a.data);
      let row = rows.get(key);
      if (!row) {
        row = { key, name: a.name, type: a.type, data: a.data, ttl: {}, present: {} };
        rows.set(key, row);
      }
      row.present[cell.resolver.id] = true;
      row.ttl[cell.resolver.id] = a.ttl;
    }
  }
  const ok = tr.cells.filter((c) => c.result);
  const statuses = new Set(ok.map((c) => c.result!.status));
  const consistent =
    statuses.size <= 1 &&
    [...rows.values()].every((r) => ok.every((c) => r.present[c.resolver.id]));
  // Reihenfolge: Kette zuerst (andere Typen, z. B. CNAME), dann abgefragter Typ; innerhalb nach Daten
  const list = [...rows.values()].sort(
    (a, b) =>
      Number(a.type === tr.type) - Number(b.type === tr.type) ||
      a.name.localeCompare(b.name) ||
      a.data.localeCompare(b.data, undefined, { numeric: true }),
  );
  return {
    rows: list,
    consistent,
    showNames: list.some((r) => r.name.toLowerCase() !== tr.query.toLowerCase()),
  };
}

// ---------- Export ----------

export function toText(results: TypeResult[]): string {
  const multi = (results[0]?.cells.length ?? 0) > 1;
  const lines: string[] = [];
  for (const tr of results) {
    for (const cell of tr.cells) {
      const head = `; ${tr.query} ${tr.type}${multi ? ` – ${cell.resolver.name}` : ""}: `;
      if (cell.error) {
        lines.push(`${head}Fehler: ${cell.error}`);
        continue;
      }
      const r = cell.result!;
      lines.push(`${head}${r.status}${r.authenticated ? ", DNSSEC validiert" : ""}, ${r.ms} ms`);
      for (const a of r.answers) lines.push(`${a.name}.\t${a.ttl}\tIN\t${a.type}\t${a.data}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function toCsv(results: TypeResult[]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ["Abfrage", "Typ", "Resolver", "Status", "DNSSEC", "Name", "TTL", "Eintragstyp", "Daten"].join(
      ";",
    ),
  ];
  for (const tr of results) {
    for (const cell of tr.cells) {
      const base = [tr.query, tr.type, cell.resolver.name];
      if (cell.error) {
        lines.push([...base, `Fehler: ${cell.error}`, "", "", "", "", ""].map(esc).join(";"));
        continue;
      }
      const r = cell.result!;
      const status = [r.status, r.authenticated ? "ja" : "nein"];
      if (r.answers.length === 0)
        lines.push([...base, ...status, "", "", "", ""].map(esc).join(";"));
      for (const a of r.answers)
        lines.push([...base, ...status, a.name, a.ttl, a.type, a.data].map(esc).join(";"));
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function toJson(results: TypeResult[]): string {
  return JSON.stringify(
    results.flatMap((tr) =>
      tr.cells.map((cell) => ({
        query: tr.query,
        type: tr.type,
        resolver: cell.resolver.name,
        resolverUrl: cell.resolver.url,
        ...(cell.error
          ? { error: cell.error }
          : {
              status: cell.result!.status,
              dnssec: cell.result!.authenticated,
              ms: cell.result!.ms,
              answers: cell.result!.answers,
            }),
      })),
    ),
    null,
    2,
  );
}
