import { describe, expect, it } from "vitest";
import { join, joinSql, parseTable } from "./joins";

const a = parseTable("kunden", "id;name\n1;Anna\n2;Ben\n3;Cem");
const b = parseTable("bestellungen", "nr;kunde_id;artikel\n10;1;Laptop\n11;1;Maus\n12;3;Monitor\n13;9;Kabel\n14;NULL;Dock");

describe("join", () => {
  it("INNER", () => {
    const r = join(a, b, "id", "kunde_id", "inner");
    expect(r.columns).toEqual(["kunden.id", "kunden.name", "bestellungen.nr", "bestellungen.kunde_id", "bestellungen.artikel"]);
    expect(r.rows.map((x) => x[2])).toEqual(["10", "11", "12"]);
  });
  it("LEFT füllt mit NULL", () => {
    const r = join(a, b, "id", "kunde_id", "left");
    expect(r.rows).toHaveLength(4);
    expect(r.rows[2]).toEqual(["2", "Ben", null, null, null]);
  });
  it("RIGHT und FULL", () => {
    expect(join(a, b, "id", "kunde_id", "right").rows).toHaveLength(5);
    const full = join(a, b, "id", "kunde_id", "full");
    expect(full.rows).toHaveLength(6);
    expect(full.rows[5]).toEqual([null, null, "14", null, "Dock"]);
  });
  it("Anti-Joins", () => {
    expect(join(a, b, "id", "kunde_id", "left-only").rows).toEqual([["2", "Ben", null, null, null]]);
    expect(join(a, b, "id", "kunde_id", "right-only").rows.map((x) => x[2])).toEqual(["13", "14"]);
  });
  it("CROSS", () => {
    expect(join(a, b, "id", "kunde_id", "cross").rows).toHaveLength(15);
  });
});

describe("joinSql / parseTable", () => {
  it("erzeugt SQL", () => {
    expect(joinSql(a, b, "id", "kunde_id", "left")).toBe("SELECT *\nFROM kunden\nLEFT JOIN bestellungen ON kunden.id = bestellungen.kunde_id;");
    expect(joinSql(a, b, "id", "kunde_id", "left-only")).toContain("WHERE bestellungen.kunde_id IS NULL");
    expect(joinSql(a, b, "id", "kunde_id", "cross")).toContain("CROSS JOIN bestellungen;");
  });
  it("prüft Tabellen", () => {
    expect(() => parseTable("x", " ")).toThrow("leer");
    expect(() => parseTable("x", "a;A\n1;2")).toThrow("eindeutig");
  });
});
