import { describe, expect, it } from "vitest";
import { backupPlan, restoreChain, type BackupInput } from "./backup";

const base: BackupInput = {
  data: 1000,
  change: 5,
  strategy: "incremental",
  fullDay: 0,
  daysPerWeek: 5,
  weeks: 4,
  savings: 0,
  throughput: 0,
};

describe("backupPlan", () => {
  it("täglich voll", () => {
    const p = backupPlan({ ...base, strategy: "full" });
    expect(p.days.map((d) => d.size)).toEqual([1000, 1000, 1000, 1000, 1000, 0, 0]);
    expect(p.totalStored).toBe(20000);
  });
  it("inkrementell: jeweils die Änderungen seit der letzten Sicherung", () => {
    const p = backupPlan(base);
    expect(p.days.map((d) => d.type)).toEqual([
      "voll",
      "inkrementell",
      "inkrementell",
      "inkrementell",
      "inkrementell",
      "–",
      "–",
    ]);
    expect(p.days.map((d) => d.size)).toEqual([1000, 50, 50, 50, 50, 0, 0]);
    expect(p.weekStored).toBe(1200);
  });
  it("differenziell wächst bis zur nächsten Vollsicherung", () => {
    const p = backupPlan({ ...base, strategy: "differential" });
    expect(p.days.map((d) => d.size)).toEqual([1000, 50, 100, 150, 200, 0, 0]);
  });
  it("Vollsicherung am Freitag: Montag enthält das Wochenende", () => {
    const p = backupPlan({ ...base, fullDay: 4 });
    expect(p.days[0]).toMatchObject({ type: "inkrementell", size: 150 });
    expect(
      backupPlan({ ...base, fullDay: 4, strategy: "differential" }).days.map((d) => d.size),
    ).toEqual([150, 200, 250, 300, 1000, 0, 0]);
  });
  it("Komprimierung und Dauer", () => {
    const p = backupPlan({ ...base, data: 360e9, savings: 50, throughput: 100 });
    expect(p.days[0]).toMatchObject({ stored: 180e9, seconds: 3600 });
    expect(p.longestSeconds).toBe(3600);
  });
  it("prüft Eingaben", () => {
    expect(() => backupPlan({ ...base, fullDay: 6 })).toThrow("Vollsicherung");
  });
});

describe("restoreChain", () => {
  it("inkrementell: Voll + alle Inkremente", () => {
    expect(restoreChain(base, 3).map((c) => c.day)).toEqual([0, 1, 2, 3]);
  });
  it("differenziell: Voll + letzte differenzielle", () => {
    expect(restoreChain({ ...base, strategy: "differential" }, 3)).toEqual([
      { day: 0, type: "voll" },
      { day: 3, type: "differenziell" },
    ]);
  });
  it("über das Wochenende zurück zur Vollsicherung am Freitag", () => {
    expect(restoreChain({ ...base, fullDay: 4 }, 1).map((c) => c.day)).toEqual([4, 0, 1]);
  });
  it("Vollsicherung allein genügt", () => {
    expect(restoreChain(base, 0)).toEqual([{ day: 0, type: "voll" }]);
    expect(() => restoreChain(base, 6)).toThrow("keine Sicherung");
  });
});
