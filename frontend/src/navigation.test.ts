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

  it("zeigt den Eingang nur IT und Evergreen-Team", () => {
    const labels = (roles: string[]) => allNavItems(navigationFor(roles)).map((item) => item.label);
    expect(labels(["Evergreen.IT"])).toContain("Eingang");
    expect(labels(["Evergreen.Team"])).toContain("Eingang");
    expect(labels(["Evergreen.GF"])).not.toContain("Eingang");
  });

  it("ignoriert unbekannte Rollen", () => {
    expect(navigationFor(["Irgendwas"])).toHaveLength(1);
  });

  it("gibt jedem Eintrag ein Symbol und führt Neuigkeiten nicht mehr als Menüpunkt", () => {
    const items = allNavItems(navigationFor(["Werkbank.Admin", "Config.Reader", "Evergreen.IT"]));
    expect(items.every((item) => item.icon.length > 0)).toBe(true);
    expect(items.map((item) => item.label)).not.toContain("Neuigkeiten");
  });
});
