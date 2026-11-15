import { describe, expect, it } from "vitest";
import { powerCost } from "./power";

describe("powerCost", () => {
  it("100 W im Dauerbetrieb", () => {
    const r = powerCost({
      watts: 100,
      count: 1,
      hoursPerDay: 24,
      daysPerYear: 365,
      price: 30,
      pue: 1,
      co2: 400,
    });
    expect(Math.round(r.kwhDay * 10) / 10).toBe(2.4);
    expect(Math.round(r.kwhYear)).toBe(876);
    expect(Math.round(r.costYear * 100) / 100).toBe(262.8);
    expect(Math.round(r.co2Year * 10) / 10).toBe(350.4);
  });
  it("Anzahl und PUE multiplizieren", () => {
    const r = powerCost({
      watts: 500,
      count: 4,
      hoursPerDay: 24,
      daysPerYear: 365,
      price: 25,
      pue: 1.5,
      co2: 0,
    });
    expect(Math.round(r.kwhYear)).toBe(26280);
    expect(Math.round(r.costMonth * 100) / 100).toBe(547.5);
  });
  it("prüft Eingaben", () => {
    expect(() =>
      powerCost({
        watts: 1,
        count: 1,
        hoursPerDay: 25,
        daysPerYear: 365,
        price: 30,
        pue: 1,
        co2: 0,
      }),
    ).toThrow("Stunden");
  });
});
