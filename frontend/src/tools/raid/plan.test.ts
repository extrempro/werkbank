import { describe, expect, it } from "vitest";
import { arrayState, disksNeeded, layout, survival } from "./plan";

describe("disksNeeded", () => {
  it("RAID 6: 40 TB mit 8-TB-Platten", () => {
    expect(disksNeeded("6", 40e12, 8e12)).toEqual({ disks: 7, usable: 40e12 });
  });
  it("RAID 10 nimmt nur gerade Anzahlen", () => {
    expect(disksNeeded("10", 20e12, 8e12)?.disks).toBe(6);
  });
  it("RAID 1 wird nicht größer", () => {
    expect(disksNeeded("1", 20e12, 8e12)).toBe(null);
    expect(disksNeeded("1", 8e12, 8e12)?.disks).toBe(2);
  });
  it("RAID 50 mit zwei Gruppen", () => {
    expect(disksNeeded("50", 30e12, 8e12, 2)?.disks).toBe(6);
  });
});

describe("arrayState", () => {
  it("RAID 5: eine Platte ok, zwei nicht", () => {
    expect(arrayState("5", 4, 2, new Set()).state).toBe("ok");
    expect(arrayState("5", 4, 2, new Set([1])).state).toBe("degraded");
    expect(arrayState("5", 4, 2, new Set([1, 2])).state).toBe("failed");
  });
  it("RAID 10: es kommt auf das Paar an", () => {
    expect(layout("10", 6).groups).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(arrayState("10", 6, 2, new Set([0, 2, 4])).state).toBe("degraded");
    expect(arrayState("10", 6, 2, new Set([0, 1])).state).toBe("failed");
  });
  it("RAID 0 verkraftet nichts", () => {
    expect(arrayState("0", 2, 2, new Set([0])).state).toBe("failed");
  });
  it("RAID 6 mit einem Ausfall hat noch Reserve", () => {
    expect(arrayState("6", 6, 2, new Set([0])).text).toContain("noch ist Redundanz");
    expect(arrayState("6", 6, 2, new Set([0, 1])).text).toContain("ohne Reserve");
  });
});

describe("survival", () => {
  it("RAID 10 mit 4 Platten: 2 Ausfälle überlebt man in 4 von 6 Fällen", () => {
    const s = survival("10", 4);
    expect(s[0]).toBe(1);
    expect(Math.round(s[1]! * 1000)).toBe(667);
    expect(s[2]).toBe(0);
  });
  it("RAID 6", () => {
    expect(survival("6", 5).slice(0, 3)).toEqual([1, 1, 0]);
  });
  it("RAID 60 mit 2×4", () => {
    const s = survival("60", 8, 2);
    expect(s[1]).toBe(1);
    // 3 Ausfälle: tödlich nur, wenn alle 3 in derselben Gruppe liegen: 2·C(4,3)=8 von 56
    expect(Math.round(s[2]! * 56)).toBe(48);
  });
});
