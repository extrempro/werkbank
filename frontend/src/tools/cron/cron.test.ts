import { describe, expect, it } from "vitest";
import { explainCron, nextRuns, parseCron } from "./cron";

const explain = (e: string) => explainCron(parseCron(e));

describe("Cron", () => {
  it("erklärt gängige Ausdrücke", () => {
    expect(explain("*/5 * * * *")).toBe("Alle 5 Minuten, jeden Tag.");
    expect(explain("30 2 * * *")).toBe("Um 02:30 Uhr, jeden Tag.");
    expect(explain("0 8 * * 1-5")).toBe("Um 08:00 Uhr, montags bis freitags.");
    expect(explain("0 8 * * MON-FRI")).toBe("Um 08:00 Uhr, montags bis freitags.");
    expect(explain("0 6,18 * * *")).toBe("Um 06:00 und 18:00 Uhr, jeden Tag.");
    expect(explain("0 0 1 * *")).toBe("Um 00:00 Uhr, am 1. des Monats.");
    expect(explain("15 * * * *")).toBe("Stündlich zur Minute 15, jeden Tag.");
    expect(explain("0 22 * * 0")).toBe("Um 22:00 Uhr, sonntags.");
    expect(explain("0 9 1 1,7 *")).toBe("Um 09:00 Uhr, am 1. des Monats im Januar und Juli.");
    expect(explain("@daily")).toBe("Um 00:00 Uhr, jeden Tag.");
    expect(explain("@reboot")).toMatch(/Start des Systems/);
    expect(explain("*/30 * * * * *")).toMatch(/^Alle 30 Sekunden/);
  });

  it("nimmt bei crontab-Zeilen nur die Zeitfelder", () => {
    expect(parseCron("0 3 * * * /usr/local/bin/backup.sh --full").minute.values).toEqual([0]);
  });

  it("prüft Eingaben", () => {
    expect(() => parseCron("61 * * * *")).toThrow(/Minute/);
    expect(() => parseCron("* * *")).toThrow(/5 Felder/);
    expect(() => parseCron("0 0 L * *")).toThrow(/nicht unterstützt/);
    expect(parseCron("0 0 * * 7").dow.values).toEqual([0]);
    expect(parseCron("0 0 * * 5-7").dow.values).toEqual([0, 5, 6]);
  });

  it("berechnet die nächsten Ausführungen (UTC)", () => {
    const from = new Date("2026-11-07T10:17:00Z"); // Samstag
    expect(nextRuns(parseCron("*/15 * * * *"), from, 3, true).map((d) => d.toISOString())).toEqual([
      "2026-11-07T10:30:00.000Z",
      "2026-11-07T10:45:00.000Z",
      "2026-11-07T11:00:00.000Z",
    ]);
    expect(nextRuns(parseCron("0 8 * * 1-5"), from, 2, true).map((d) => d.toISOString())).toEqual(["2026-11-09T08:00:00.000Z", "2026-11-10T08:00:00.000Z"]);
    // Tag ODER Wochentag (Vixie-Cron): 13. des Monats oder freitags
    expect(nextRuns(parseCron("0 0 13 * 5"), from, 3, true).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-11-13", "2026-11-20", "2026-11-27"]);
    expect(nextRuns(parseCron("0 0 29 2 *"), from, 1, true)[0]!.toISOString().slice(0, 10)).toBe("2028-02-29");
  });
});
