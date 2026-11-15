import { describe, expect, it } from "vitest";
import { ratioFromSavings, savingsFromRatio, storageNeed } from "./storage";

describe("storageNeed", () => {
  it("rechnet Komprimierung, Wachstum und Reserve", () => {
    const r = storageNeed({ data: 1000, compression: 2, dedup: 1, growth: 10, years: 2, reserve: 20 });
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ year: 0, raw: 1000, reduced: 500, withReserve: 600 });
    expect(Math.round(r[2]!.raw)).toBe(1210);
    expect(Math.round(r[2]!.withReserve)).toBe(726);
  });
  it("Deduplizierung wirkt zusätzlich", () => {
    expect(storageNeed({ data: 1200, compression: 2, dedup: 3, growth: 0, years: 0, reserve: 0 })[0]!.reduced).toBe(200);
  });
  it("lehnt Faktoren unter 1 ab", () => {
    expect(() => storageNeed({ data: 1, compression: 0.5, dedup: 1, growth: 0, years: 0, reserve: 0 })).toThrow("mindestens 1");
  });
  it("Faktor ↔ Einsparung", () => {
    expect(ratioFromSavings(50)).toBe(2);
    expect(savingsFromRatio(4)).toBe(75);
  });
});
