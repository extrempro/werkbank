import { describe, expect, it } from "vitest";
import {
  block,
  downtime,
  fromDowntime,
  fromMtbf,
  nines,
  parseComponents,
  system,
} from "./availability";

describe("Verfügbarkeit", () => {
  it("99,9 % = 8,76 h im Jahr", () => {
    const d = downtime(99.9);
    expect(Math.round(d.year / 36) / 100).toBe(8.76);
    expect(Math.round(d.day * 10) / 10).toBe(86.4);
  });
  it("Ausfallzeit → Prozent", () => {
    expect(Math.round(fromDowntime(8.76 * 3600) * 1000) / 1000).toBe(99.9);
  });
  it("MTBF/MTTR", () => {
    expect(fromMtbf(999, 1)).toBe(99.9);
    expect(() => fromMtbf(0, 1)).toThrow("MTBF");
  });
  it("Redundanz und Reihenschaltung", () => {
    expect(Math.round(block({ name: "x", availability: 99, redundancy: 2 }) * 1e4) / 1e4).toBe(
      99.99,
    );
    const { components, errors } = parseComponents(
      "Server; 99; 2\nSwitch; 99,9\n# Kommentar\nkaputt; abc",
    );
    expect(components).toHaveLength(2);
    expect(errors).toEqual(["kaputt; abc"]);
    expect(Math.round(system(components) * 1e4) / 1e4).toBe(99.89);
  });
  it("zählt Neunen", () => {
    expect(nines(99.9)).toBe(3);
    expect(nines(99.999)).toBe(5);
    expect(nines(95)).toBe(1);
  });
});
