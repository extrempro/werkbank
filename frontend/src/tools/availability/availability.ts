/** Verfügbarkeit: Prozent ↔ Ausfallzeit, MTBF/MTTR, Reihen- und Parallelschaltung */

export const YEAR = 365 * 86400;

/** erlaubte Ausfallzeit in Sekunden für verschiedene Zeiträume */
export function downtime(percent: number): { year: number; month: number; week: number; day: number } {
  const u = 1 - percent / 100;
  return { year: u * YEAR, month: (u * YEAR) / 12, week: u * 7 * 86400, day: u * 86400 };
}

export const fromDowntime = (secondsPerYear: number) => (1 - secondsPerYear / YEAR) * 100;

export function fromMtbf(mtbf: number, mttr: number): number {
  if (!(mtbf > 0) || mttr < 0) throw new Error("MTBF muss größer als 0 sein, MTTR nicht negativ.");
  return (mtbf / (mtbf + mttr)) * 100;
}

export interface Component {
  name: string;
  /** Verfügbarkeit in Prozent */
  availability: number;
  /** Anzahl redundanter (paralleler) Exemplare */
  redundancy: number;
}

/** Zeilen „Name; Verfügbarkeit %; Anzahl redundant“ */
export function parseComponents(text: string): { components: Component[]; errors: string[] } {
  const components: Component[] = [];
  const errors: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/#.*$/, "").trim();
    if (!t) continue;
    const p = t.split(/[;\t]/).map((x) => x.trim());
    const a = Number((p[1] ?? "").replace("%", "").replace(",", "."));
    const n = p[2] ? Number(p[2].replace(/x$/i, "")) : 1;
    if (!p[0] || !(a > 0 && a <= 100) || !Number.isInteger(n) || n < 1 || n > 64) errors.push(t);
    else components.push({ name: p[0], availability: a, redundancy: n });
  }
  return { components, errors };
}

/** ein Baustein mit n redundanten Exemplaren: fällt nur aus, wenn alle ausfallen */
export const block = (c: Component) => (1 - (1 - c.availability / 100) ** c.redundancy) * 100;

/** Gesamtsystem: alle Bausteine werden gebraucht (Reihenschaltung) */
export const system = (cs: Component[]) => cs.reduce((a, c) => (a * block(c)) / 100, 100);

/** „Neunen“ zählen: 99,9 → 3 */
export const nines = (percent: number) => (percent >= 100 ? Infinity : Math.floor(-Math.log10(1 - percent / 100) + 1e-9));
