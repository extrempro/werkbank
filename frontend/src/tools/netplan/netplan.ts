/** Netzplantechnik: Vorwärts- und Rückwärtsrechnung, Puffer, kritischer Pfad */

export interface Activity {
  id: string;
  name: string;
  duration: number;
  preds: string[];
}

export interface Node extends Activity {
  /** frühester Anfang/Ende, spätester Anfang/Ende */
  faz: number;
  fez: number;
  saz: number;
  sez: number;
  /** Gesamtpuffer, freier Puffer */
  gp: number;
  fp: number;
  critical: boolean;
  succs: string[];
  /** Spalte im Diagramm (längster Weg vom Start) */
  rank: number;
}

/** Zeilen „Nr; Bezeichnung; Dauer; Vorgänger (mit Komma)“ – Trenner ; oder Tab */
export function parseActivities(text: string): { activities: Activity[]; errors: string[] } {
  const activities: Activity[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const p = t.split(/[;\t]/).map((x) => x.trim());
    // leere Tabellenzeile
    if (p.every((x) => !x)) return;
    // Kopfzeile überspringen
    if (idx === 0 && p.length >= 3 && Number.isNaN(Number((p[2] ?? "").replace(",", ".")))) return;
    const duration = (p[2] ?? "") === "" ? NaN : Number(p[2]!.replace(",", "."));
    if (!p[0] || !(duration >= 0)) {
      errors.push(`Zeile ${idx + 1}: ${!p[0] ? "Nr. fehlt" : "Dauer fehlt oder ist keine Zahl"}.`);
      return;
    }
    const preds = (p[3] ?? "").split(/[,\s]+/).filter((x) => x && !/^[-–—]$/.test(x));
    activities.push({ id: p[0], name: p[1] ?? "", duration, preds });
  });
  return { activities, errors };
}

export function computePlan(acts: Activity[]): { nodes: Node[]; duration: number; criticalPath: string[] } {
  if (!acts.length) throw new Error("Keine Vorgänge angegeben.");
  const byId = new Map<string, Node>();
  for (const a of acts) {
    if (byId.has(a.id)) throw new Error(`Vorgang „${a.id}“ kommt doppelt vor.`);
    byId.set(a.id, { ...a, faz: 0, fez: 0, saz: 0, sez: 0, gp: 0, fp: 0, critical: false, succs: [], rank: 0 });
  }
  for (const n of byId.values()) {
    for (const p of n.preds) {
      const pre = byId.get(p);
      if (!pre) throw new Error(`Vorgang „${n.id}“: Vorgänger „${p}“ gibt es nicht.`);
      if (p === n.id) throw new Error(`Vorgang „${n.id}“ ist sein eigener Vorgänger.`);
      pre.succs.push(n.id);
    }
  }
  // topologische Reihenfolge (Kahn) – erkennt Schleifen
  const open = new Map([...byId.values()].map((n) => [n.id, n.preds.length]));
  const queue = [...byId.values()].filter((n) => n.preds.length === 0).map((n) => n.id);
  const order: Node[] = [];
  while (queue.length) {
    const n = byId.get(queue.shift()!)!;
    order.push(n);
    for (const s of n.succs) {
      open.set(s, open.get(s)! - 1);
      if (open.get(s) === 0) queue.push(s);
    }
  }
  if (order.length !== byId.size) throw new Error(`Die Vorgänger bilden eine Schleife (betroffen: ${[...byId.keys()].filter((id) => !order.some((o) => o.id === id)).join(", ")}).`);

  for (const n of order) {
    n.faz = Math.max(0, ...n.preds.map((p) => byId.get(p)!.fez));
    n.fez = n.faz + n.duration;
    n.rank = n.preds.length ? Math.max(...n.preds.map((p) => byId.get(p)!.rank)) + 1 : 0;
  }
  const duration = Math.max(...order.map((n) => n.fez));
  for (const n of [...order].reverse()) {
    n.sez = n.succs.length ? Math.min(...n.succs.map((s) => byId.get(s)!.saz)) : duration;
    n.saz = n.sez - n.duration;
    n.gp = n.sez - n.fez;
    n.fp = (n.succs.length ? Math.min(...n.succs.map((s) => byId.get(s)!.faz)) : duration) - n.fez;
    n.critical = Math.abs(n.gp) < 1e-9;
  }
  // ein kritischer Pfad vom Start bis zum Ende
  const criticalPath: string[] = [];
  let cur = order.find((n) => n.critical && n.preds.length === 0);
  while (cur) {
    criticalPath.push(cur.id);
    const c: Node = cur;
    cur = c.succs.map((s) => byId.get(s)!).find((s) => s.critical && Math.abs(s.faz - c.fez) < 1e-9);
  }
  return { nodes: acts.map((a) => byId.get(a.id)!), duration, criticalPath };
}

/** Zeile der Eingabetabelle – alles Text, damit auch halb ausgefüllte Zeilen erhalten bleiben */
export interface Row {
  id: string;
  name: string;
  duration: string;
  preds: string;
}

const isHeader = (p: string[]) => p.length >= 3 && p[2] !== "" && Number.isNaN(Number((p[2] ?? "").replace(",", ".")));

/** Text (aus URL oder Zwischenablage) → Tabellenzeilen; eine Kopfzeile wird übersprungen */
export function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const p = line.split(/[;\t]/).map((x) => x.trim());
    if (idx === 0 && isHeader(p)) return;
    rows.push({ id: p[0] ?? "", name: p[1] ?? "", duration: p[2] ?? "", preds: /^[-–—]$/.test(p[3] ?? "") ? "" : (p[3] ?? "") });
  });
  return rows;
}

const clean = (s: string) => s.replace(/[;\t\r\n]/g, " ");

export const formatRows = (rows: Row[]): string => rows.map((r) => [r.id, r.name, r.duration, r.preds].map(clean).join("; ")).join("\n");

/** nächste freie Nummer: A, B, … Z, dann V27, V28 … */
export function nextId(rows: Row[]): string {
  const used = new Set(rows.map((r) => r.id.trim().toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  let n = rows.length + 1;
  while (used.has(`V${n}`)) n++;
  return `V${n}`;
}
