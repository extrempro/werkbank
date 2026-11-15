/** SQL-JOINs an zwei kleinen Beispieltabellen vorführen */
import { detectDelimiter, parseCsv } from "../lib/csv";

export type JoinType = "inner" | "left" | "right" | "full" | "left-only" | "right-only" | "cross";

export const joinInfo: Record<JoinType, { label: string; text: string }> = {
  inner: { label: "INNER JOIN", text: "Nur Zeilen, die in beiden Tabellen einen Partner haben." },
  left: {
    label: "LEFT JOIN",
    text: "Alle Zeilen der linken Tabelle; fehlt rechts der Partner, stehen dort NULL-Werte.",
  },
  right: {
    label: "RIGHT JOIN",
    text: "Alle Zeilen der rechten Tabelle; fehlt links der Partner, stehen dort NULL-Werte.",
  },
  full: {
    label: "FULL OUTER JOIN",
    text: "Alle Zeilen beider Tabellen; wo der Partner fehlt, stehen NULL-Werte. (MySQL kennt das nicht direkt – dort LEFT JOIN UNION RIGHT JOIN.)",
  },
  "left-only": {
    label: "LEFT JOIN … IS NULL",
    text: "Nur Zeilen der linken Tabelle ohne Partner rechts (Anti-Join) – z. B. Kunden ohne Bestellung.",
  },
  "right-only": {
    label: "RIGHT JOIN … IS NULL",
    text: "Nur Zeilen der rechten Tabelle ohne Partner links – z. B. Bestellungen ohne gültigen Kunden.",
  },
  cross: {
    label: "CROSS JOIN",
    text: "Jede Zeile links mit jeder Zeile rechts kombiniert (kartesisches Produkt) – ohne Bedingung.",
  },
};

export interface Table {
  name: string;
  columns: string[];
  rows: string[][];
}

export function parseTable(name: string, text: string): Table {
  const t = text.trim();
  if (!t) throw new Error(`Tabelle ${name} ist leer.`);
  const all = parseCsv(t, detectDelimiter(t)).map((r) => r.map((c) => c.trim()));
  const [head = [], ...body] = all;
  const columns = head.map((h, i) => h || `spalte${i + 1}`);
  if (new Set(columns.map((c) => c.toLowerCase())).size !== columns.length)
    throw new Error(`Tabelle ${name}: Spaltennamen müssen eindeutig sein.`);
  return {
    name,
    columns,
    rows: body.filter((r) => r.some((c) => c !== "")).map((r) => columns.map((_, i) => r[i] ?? "")),
  };
}

export interface JoinResult {
  columns: string[];
  /** null = NULL */
  rows: (string | null)[][];
}

const isNull = (v: string) => v === "" || v.toUpperCase() === "NULL";

export function join(a: Table, b: Table, keyA: string, keyB: string, type: JoinType): JoinResult {
  const ia = a.columns.indexOf(keyA);
  const ib = b.columns.indexOf(keyB);
  const columns = [
    ...a.columns.map((c) => `${a.name}.${c}`),
    ...b.columns.map((c) => `${b.name}.${c}`),
  ];
  const val = (r: string[]): (string | null)[] => r.map((v) => (isNull(v) ? null : v));
  const nullsA = a.columns.map(() => null);
  const nullsB = b.columns.map(() => null);
  if (type === "cross")
    return { columns, rows: a.rows.flatMap((ra) => b.rows.map((rb) => [...val(ra), ...val(rb)])) };
  if (ia < 0 || ib < 0) throw new Error("Verknüpfungsspalte fehlt.");
  // NULL passt in SQL zu nichts – auch nicht zu NULL
  const eq = (ra: string[], rb: string[]) =>
    !isNull(ra[ia]!) && !isNull(rb[ib]!) && ra[ia] === rb[ib];
  const rows: (string | null)[][] = [];
  const matchedB = new Set<number>();
  for (const ra of a.rows) {
    let hit = false;
    b.rows.forEach((rb, j) => {
      if (!eq(ra, rb)) return;
      hit = true;
      matchedB.add(j);
      if (type === "inner" || type === "left" || type === "right" || type === "full")
        rows.push([...val(ra), ...val(rb)]);
    });
    if (!hit && (type === "left" || type === "full" || type === "left-only"))
      rows.push([...val(ra), ...nullsB]);
  }
  if (type === "right" || type === "full" || type === "right-only") {
    b.rows.forEach((rb, j) => {
      if (!matchedB.has(j)) rows.push([...nullsA, ...val(rb)]);
    });
  }
  return { columns, rows };
}

export function joinSql(a: Table, b: Table, keyA: string, keyB: string, type: JoinType): string {
  const on = `ON ${a.name}.${keyA} = ${b.name}.${keyB}`;
  switch (type) {
    case "cross":
      return `SELECT *\nFROM ${a.name}\nCROSS JOIN ${b.name};`;
    case "left-only":
      return `SELECT *\nFROM ${a.name}\nLEFT JOIN ${b.name} ${on}\nWHERE ${b.name}.${keyB} IS NULL;`;
    case "right-only":
      return `SELECT *\nFROM ${a.name}\nRIGHT JOIN ${b.name} ${on}\nWHERE ${a.name}.${keyA} IS NULL;`;
    default:
      return `SELECT *\nFROM ${a.name}\n${joinInfo[type].label} ${b.name} ${on};`;
  }
}
