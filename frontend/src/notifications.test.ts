import { describe, expect, it } from "vitest";
import { deviceLabel, groupByModule, safeLink, timeAgo, toggleChannel } from "./notifications";

describe("Benachrichtigungen", () => {
  it("lässt nur Pfade in der Werkbank als Ziel zu", () => {
    expect(safeLink("/budget/rechnungen")).toBe("/budget/rechnungen");
    expect(safeLink("/m365/dienststatus#EX1001")).toBe("/m365/dienststatus#EX1001");
    expect(safeLink("//example.com/x")).toBe("/benachrichtigungen");
    expect(safeLink("https://example.com")).toBe("/benachrichtigungen");
    expect(safeLink("javascript:alert(1)")).toBe("/benachrichtigungen");
  });

  it("nennt die Zeit relativ und nach einer Woche das Datum", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(timeAgo("2026-11-16T11:59:40Z", now)).toBe("gerade eben");
    expect(timeAgo("2026-11-16T11:55:00Z", now)).toBe("vor 5 Minuten");
    expect(timeAgo("2026-11-16T09:00:00Z", now)).toBe("vor 3 Stunden");
    expect(timeAgo("2026-11-15T12:00:00Z", now)).toBe("gestern");
    expect(timeAgo("2026-11-01T12:00:00Z", now)).toBe("01.11.2026");
    expect(timeAgo("kein Datum", now)).toBe("");
  });

  it("gruppiert die Arten nach Bereich", () => {
    const kinds = [
      {
        kind: "a",
        module: "IT-Budget",
        label: "A",
        enabled: true,
        mail: false,
        teams: false,
        push: false,
      },
      {
        kind: "b",
        module: "Evergreen",
        label: "B",
        enabled: false,
        mail: false,
        teams: false,
        push: false,
      },
      {
        kind: "c",
        module: "IT-Budget",
        label: "C",
        enabled: true,
        mail: false,
        teams: false,
        push: false,
      },
    ];
    expect(groupByModule(kinds).map(([module, list]) => [module, list.length])).toEqual([
      ["IT-Budget", 2],
      ["Evergreen", 1],
    ]);
  });

  it("schaltet Wege um; ohne Glocke auch keine Mail und kein Teams", () => {
    const kinds = [
      { kind: "a", module: "M", label: "A", enabled: true, mail: false, teams: false, push: false },
      { kind: "b", module: "M", label: "B", enabled: true, mail: true, teams: false, push: false },
    ];
    const mailed = toggleChannel(kinds, "a", "mail", true);
    expect(mailed[0]).toMatchObject({ enabled: true, mail: true });
    expect(mailed[1]).toBe(kinds[1]);
    const off = toggleChannel(mailed, "a", "enabled", false);
    expect(off[0]).toMatchObject({ enabled: false, mail: false, teams: false, push: false });
  });
});
