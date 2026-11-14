import { describe, expect, it } from "vitest";
import { allNavItems, navigationFor } from "./navigation";

describe("navigationFor", () => {
  it("zeigt Betriebsrat nur Start und Evergreen", () => {
    const groups = navigationFor(["Evergreen.Betriebsrat"]);
    expect(groups.map((group) => group.title)).toEqual([null, "Evergreen"]);
  });

  it("zeigt dem Admin die Verwaltung und das Audit-Log", () => {
    const labels = allNavItems(navigationFor(["Werkbank.Admin"])).map((item) => item.label);
    expect(labels).toContain("Einstellungen");
    expect(labels).toContain("Audit-Log");
  });

  it("zeigt Lesern der Konfiguration kein Audit-Log", () => {
    const labels = allNavItems(navigationFor(["Config.Reader"])).map((item) => item.label);
    expect(labels).toContain("Änderungen");
    expect(labels).not.toContain("Audit-Log");
  });

  it("ignoriert unbekannte Rollen", () => {
    expect(navigationFor(["Irgendwas"])).toHaveLength(1);
  });
});
