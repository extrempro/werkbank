import { describe, expect, it } from "vitest";
import { parseUtility, utilityAnalysis } from "./utility";

const text = `Kriterium; Gewicht; Anbieter A; Anbieter B; Anbieter C
Preis; 40; 8; 6; 9
Support; 30; 5; 9; 4
Funktionen; 30; 7; 8; 6`;

describe("Nutzwertanalyse", () => {
  it("liest die Tabelle", () => {
    const i = parseUtility(text);
    expect(i.alternatives).toEqual(["Anbieter A", "Anbieter B", "Anbieter C"]);
    expect(i.criteria[1]).toEqual({ name: "Support", weight: 30, scores: [5, 9, 4] });
  });
  it("rechnet Nutzwerte und Rang", () => {
    const r = utilityAnalysis(parseUtility(text));
    expect(r.weightSum).toBe(100);
    expect(r.totals.map((t) => Math.round(t * 100) / 100)).toEqual([6.8, 7.5, 6.6]);
    expect(r.ranks).toEqual([2, 1, 3]);
    expect(r.best).toEqual([1]);
  });
  it("normiert Gewichte, die nicht 100 ergeben", () => {
    const r = utilityAnalysis(parseUtility("K;G;A;B\nx;1;10;0\ny;3;0;10"));
    expect(r.weights).toEqual([25, 75]);
    expect(r.totals).toEqual([2.5, 7.5]);
  });
  it("Gleichstand teilt den Rang", () => {
    expect(utilityAnalysis(parseUtility("K;G;A;B;C\nx;1;5;5;3")).ranks).toEqual([1, 1, 3]);
  });
  it("meldet Lücken", () => {
    expect(() => parseUtility("K;G;A;B\nx;1;5")).toThrow("Bewertung für „B“ fehlt");
    expect(() => parseUtility("K;G;A\nx;0;5")).toThrow("Gewicht");
    expect(() => parseUtility("K;G")).toThrow("Kopfzeile");
  });
});
