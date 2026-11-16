import { describe, expect, it } from "vitest";
import { amortization, yearsText } from "./amortization";

describe("amortization", () => {
  it("statisch: Investition / Rückfluss", () => {
    const r = amortization({ investment: 10000, returns: 4000, costs: 0, interest: 0, years: 5 });
    expect(r.staticYears).toBe(2.5);
    expect(r.dynamicYears).toBe(2.5);
    expect(r.surplus).toBe(10000);
    expect(r.roiPercent).toBe(100);
  });
  it("mit Zins dauert es länger", () => {
    const r = amortization({ investment: 10000, returns: 5000, costs: 1000, interest: 10, years: 5 });
    expect(r.staticYears).toBe(2.5);
    expect(Math.round(r.dynamicYears! * 100) / 100).toBe(3.02);
    expect(Math.round(r.npv)).toBe(5163);
  });
  it("rechnet sich nie", () => {
    const r = amortization({ investment: 10000, returns: 500, costs: 600, interest: 0, years: 5 });
    expect(r.staticYears).toBe(null);
    expect(r.dynamicYears).toBe(null);
  });
  it("Jahre als Text", () => {
    expect(yearsText(2.5)).toBe("2 Jahre 6 Monate");
    expect(yearsText(1)).toBe("1 Jahr");
    expect(yearsText(1 / 12)).toBe("1 Monat");
  });
});
