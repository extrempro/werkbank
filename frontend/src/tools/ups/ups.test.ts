import { describe, expect, it } from "vitest";
import { energyWh, requiredAh, runtime, sizing } from "./ups";

describe("USV", () => {
  it("Scheinleistung und empfohlene Größe", () => {
    const s = sizing({ watts: 800, powerFactor: 0.8, maxLoad: 80 });
    expect(s.va).toBe(1000);
    expect(s.recommendedVa).toBe(1250);
    expect(s.recommendedWatts).toBe(1000);
  });
  it("Laufzeit aus Batteriedaten", () => {
    const b = { voltage: 12, ah: 9, count: 4, efficiency: 90, usable: 100 };
    expect(Math.round(energyWh(b) * 10) / 10).toBe(388.8);
    expect(Math.round(runtime(b, 388.8))).toBe(3600);
  });
  it("nötige Kapazität ist die Umkehrung", () => {
    const b = { voltage: 12, count: 4, efficiency: 90, usable: 80 };
    const ah = requiredAh(b, 500, 1800);
    expect(Math.round(runtime({ ...b, ah }, 500))).toBe(1800);
  });
  it("prüft Eingaben", () => {
    expect(() => sizing({ watts: 0, powerFactor: 1, maxLoad: 80 })).toThrow("Leistung");
    expect(() => sizing({ watts: 100, powerFactor: 1.2, maxLoad: 80 })).toThrow("Leistungsfaktor");
  });
});
