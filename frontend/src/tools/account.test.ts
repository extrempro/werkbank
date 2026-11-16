import { describe, expect, it } from "vitest";
import { entryLink, groupByDay, toolFromPath } from "./account";

describe("IT-Tools je Konto", () => {
  it("erkennt das Tool aus dem Pfad", () => {
    expect(toolFromPath("/it-tools/chmod")).toBe("chmod");
    expect(toolFromPath("/it-tools/verlauf")).toBeNull();
    expect(toolFromPath("/it-tools/kategorie/netzwerk")).toBeNull();
    expect(toolFromPath("/budget")).toBeNull();
  });

  it("öffnet einen Eintrag mit seinen Einstellungen", () => {
    expect(
      entryLink({
        id: 1,
        tool: "cidr",
        params: { cidr: "10.0.0.0/24", ansicht: "binär" },
        summary: "",
        created_at: "2026-11-16T08:00:00Z",
      }),
    ).toBe("/it-tools/cidr?cidr=10.0.0.0%2F24&ansicht=bin%C3%A4r");
    expect(
      entryLink({
        id: 2,
        tool: "uuid",
        params: {},
        summary: "",
        created_at: "2026-11-16T08:00:00Z",
      }),
    ).toBe("/it-tools/uuid");
  });

  it("gruppiert den Verlauf nach Tagen", () => {
    const now = new Date(2026, 10, 16, 12, 0);
    const entry = (id: number, date: Date) => ({
      id,
      tool: "uuid",
      params: { n: "1" },
      summary: "1",
      created_at: date.toISOString(),
    });
    const groups = groupByDay(
      [
        entry(1, new Date(2026, 10, 16, 9, 0)),
        entry(2, new Date(2026, 10, 15, 9, 0)),
        entry(3, new Date(2026, 10, 10, 9, 0)),
      ],
      now,
    );
    expect(groups.map(([day, list]) => [day, list.length])).toEqual([
      ["Heute", 1],
      ["Gestern", 1],
      ["Dienstag, 10. November 2026", 1],
    ]);
  });
});
