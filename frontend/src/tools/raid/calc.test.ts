import { describe, expect, it } from "vitest";
import { parseNumber, parseSize, humanSize } from "../data-units/units";
import { duration, durationText, parseDuration, requiredRate } from "../transfer/transfer";
import { calcRaid } from "./raid";

const TB = 1e12;

describe("Rechner", () => {
  it("Einheiten", () => {
    expect(parseSize("1 TB")!.bits / 8).toBe(1e12);
    expect(humanSize(1e12, "binär")).toBe("931,3 GiB");
    expect(parseSize("1,5 GiB")!.bits / 8).toBe(1.5 * 1024 ** 3);
    expect(parseSize("100 Mbit")!.bits).toBe(1e8);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
  });
  it("RAID", () => {
    expect(calcRaid({ level: "5", disks: 4, size: 4 * TB, groups: 2 }).usable).toBe(12 * TB);
    expect(calcRaid({ level: "6", disks: 8, size: 10 * TB, groups: 2 }).usable).toBe(60 * TB);
    const r10 = calcRaid({ level: "10", disks: 8, size: TB, groups: 2 });
    expect([r10.usable, r10.tolerates, r10.toleratesBest]).toEqual([4 * TB, 1, 4]);
    expect(calcRaid({ level: "60", disks: 12, size: TB, groups: 2 }).usable).toBe(8 * TB);
    expect(() => calcRaid({ level: "10", disks: 5, size: TB, groups: 2 })).toThrow("gerade");
    expect(() => calcRaid({ level: "6", disks: 3, size: TB, groups: 2 })).toThrow("mindestens 4");
  });
  it("Übertragung", () => {
    expect(duration(1e9, 1e9, 1)).toBe(8);
    expect(durationText(3725)).toBe("1 h 2 min");
    expect(durationText(90061)).toBe("1 Tag 1 h 1 min");
    expect(parseDuration("1,5 h")).toBe(5400);
    expect(parseDuration("2h 30min")).toBe(9000);
    expect(parseDuration("01:30")).toBe(5400);
    expect(requiredRate(1e12, 8 * 3600, 1)).toBeGreaterThanOrEqual(277e6);
  });
});
