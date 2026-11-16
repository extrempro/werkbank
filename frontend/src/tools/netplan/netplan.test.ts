import { describe, expect, it } from "vitest";
import { computePlan, formatRows, nextId, parseActivities, parseRows } from "./netplan";

const text = `Nr; Vorgang; Dauer; Vorgänger
A; Planung; 3; -
B; Hardware bestellen; 5; A
C; Software vorbereiten; 2; A
D; Installation; 4; B, C
E; Schulung; 1; C
F; Abnahme; 1; D, E`;

describe("parseActivities", () => {
  it("überspringt die Kopfzeile und liest Vorgänger", () => {
    const { activities, errors } = parseActivities(text);
    expect(errors).toEqual([]);
    expect(activities).toHaveLength(6);
    expect(activities[0]).toEqual({ id: "A", name: "Planung", duration: 3, preds: [] });
    expect(activities[3]!.preds).toEqual(["B", "C"]);
  });
  it("meldet kaputte Zeilen", () => {
    expect(parseActivities("A; x; 1\nB; y; ; A\n; z; 2; ").errors).toEqual([
      "Zeile 2: Dauer fehlt oder ist keine Zahl.",
      "Zeile 3: Nr. fehlt.",
    ]);
  });
  it("überspringt leere Tabellenzeilen", () => {
    expect(parseActivities("A; x; 1; \n; ; ; ")).toEqual({
      activities: [{ id: "A", name: "x", duration: 1, preds: [] }],
      errors: [],
    });
  });
});

describe("computePlan", () => {
  const { nodes, duration, criticalPath } = computePlan(parseActivities(text).activities);
  const n = (id: string) => nodes.find((x) => x.id === id)!;
  it("Vorwärts- und Rückwärtsrechnung", () => {
    expect(duration).toBe(13);
    expect(n("D")).toMatchObject({
      faz: 8,
      fez: 12,
      saz: 8,
      sez: 12,
      gp: 0,
      fp: 0,
      critical: true,
    });
    expect(n("C")).toMatchObject({ faz: 3, fez: 5, saz: 6, sez: 8, gp: 3, fp: 0, critical: false });
    expect(n("E")).toMatchObject({ faz: 5, fez: 6, saz: 11, sez: 12, gp: 6, fp: 6 });
  });
  it("kritischer Pfad", () => {
    expect(criticalPath).toEqual(["A", "B", "D", "F"]);
  });
  it("Ränge für das Diagramm", () => {
    expect(nodes.map((x) => x.rank)).toEqual([0, 1, 1, 2, 2, 3]);
  });
  it("erkennt Schleifen und unbekannte Vorgänger", () => {
    expect(() => computePlan(parseActivities("A; a; 1; B\nB; b; 1; A").activities)).toThrow(
      "Schleife",
    );
    expect(() => computePlan(parseActivities("A; a; 1; X").activities)).toThrow("gibt es nicht");
    expect(() => computePlan(parseActivities("A; a; 1\nA; b; 1").activities)).toThrow("doppelt");
  });
});

describe("Tabellenzeilen", () => {
  it("Text ↔ Zeilen, auch halb ausgefüllt", () => {
    const rows = parseRows(text);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ id: "A", name: "Planung", duration: "3", preds: "" });
    expect(rows[3]).toEqual({ id: "D", name: "Installation", duration: "4", preds: "B, C" });
    const again = parseRows(formatRows([...rows, { id: "", name: "", duration: "", preds: "" }]));
    expect(again).toHaveLength(7);
    expect(again[6]).toEqual({ id: "", name: "", duration: "", preds: "" });
    expect(parseActivities(formatRows(again)).activities).toHaveLength(6);
  });
  it("liest Excel-Zeilen mit Tabulator", () => {
    expect(parseRows("A\tx\t2\t\nB\ty\t1\tA")[1]).toEqual({
      id: "B",
      name: "y",
      duration: "1",
      preds: "A",
    });
  });
  it("Semikolon im Namen zerstört die Zeile nicht", () => {
    expect(
      parseRows(formatRows([{ id: "A", name: "a; b", duration: "1", preds: "" }]))[0]!.name,
    ).toBe("a  b");
  });
  it("nächste freie Nummer", () => {
    expect(nextId(parseRows(text))).toBe("G");
    expect(nextId([{ id: "b", name: "", duration: "", preds: "" }])).toBe("A");
  });
});
