/** Nutzwertanalyse: Kriterien gewichten, Alternativen bewerten, Rangfolge bilden */
import { detectDelimiter, parseCsv } from "../lib/csv";

export interface Criterion {
  name: string;
  weight: number;
  scores: number[];
}

export interface UtilityInput {
  alternatives: string[];
  criteria: Criterion[];
}

const num = (s: string | undefined) =>
  Number((s ?? "").replace(/%/g, "").replace(/,/g, ".").trim());

/** Tabelle: Kopfzeile „Kriterium; Gewicht; Alternative A; Alternative B …“, dann je Kriterium eine Zeile */
export function parseUtility(text: string): UtilityInput {
  const t = text.trim();
  if (!t) throw new Error("Tabelle ist leer.");
  const rows = parseCsv(t, detectDelimiter(t))
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c));
  const [head, ...body] = rows;
  if (!head || head.length < 3)
    throw new Error("Kopfzeile erwartet: Kriterium; Gewicht; Alternative 1; Alternative 2 …");
  const alternatives = head.slice(2).map((a, i) => a || `Alternative ${i + 1}`);
  if (!body.length) throw new Error("Mindestens ein Kriterium angeben.");
  const criteria = body.map((r, i) => {
    const weight = num(r[1]);
    if (!r[0]) throw new Error(`Zeile ${i + 2}: Name des Kriteriums fehlt.`);
    if (!(weight > 0)) throw new Error(`„${r[0]}“: Gewicht muss eine Zahl größer 0 sein.`);
    const scores = alternatives.map((a, j) => {
      const s = num(r[j + 2]);
      if (r[j + 2] === undefined || r[j + 2] === "" || Number.isNaN(s))
        throw new Error(`„${r[0]}“: Bewertung für „${a}“ fehlt.`);
      return s;
    });
    return { name: r[0], weight, scores };
  });
  return { alternatives, criteria };
}

export interface UtilityResult {
  weightSum: number;
  /** Gewichte auf 100 % normiert */
  weights: number[];
  /** Teilnutzwerte [Kriterium][Alternative] */
  parts: number[][];
  totals: number[];
  /** Rang je Alternative (1 = beste), Gleichstand teilt den Rang */
  ranks: number[];
  best: number[];
}

export function utilityAnalysis(i: UtilityInput): UtilityResult {
  const weightSum = i.criteria.reduce((n, c) => n + c.weight, 0);
  const weights = i.criteria.map((c) => (c.weight / weightSum) * 100);
  const parts = i.criteria.map((c, k) => c.scores.map((s) => (s * weights[k]!) / 100));
  const totals = i.alternatives.map((_, j) => parts.reduce((n, p) => n + p[j]!, 0));
  const ranks = totals.map((t) => 1 + totals.filter((o) => o > t + 1e-9).length);
  return {
    weightSum,
    weights,
    parts,
    totals,
    ranks,
    best: ranks.flatMap((r, j) => (r === 1 ? [j] : [])),
  };
}
