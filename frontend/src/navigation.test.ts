import { describe, expect, it } from "vitest";
import { allNavItems, areaForPath, areasFor, navigationFor } from "./navigation";

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

describe("areasFor", () => {
  const all = ["Werkbank.Admin", "Config.Reader", "Evergreen.IT"];

  it("trennt die allgemeinen Seiten vom Bereich Microsoft 365", () => {
    const areas = areasFor(all);
    expect(areas.map((area) => area.label)).toEqual(["Werkbank", "Microsoft 365"]);
    expect(areas[1]?.groups.map((group) => group.title)).toEqual(["Konfiguration", "Evergreen"]);
    expect(areas[1]?.home).toBe("/m365");
    const general = allNavItems(areas[0]?.groups ?? []).map((item) => item.path);
    expect(general).toEqual(["/", "/suche", "/reports", "/audit", "/verwaltung"]);
  });

  it("führt ohne Rolle für die Konfiguration direkt zu den Vorgängen", () => {
    expect(areasFor(["Evergreen.Betriebsrat"])[1]?.home).toBe("/evergreen");
  });

  it("zeigt ohne Rolle für Microsoft 365 nur den allgemeinen Bereich", () => {
    expect(areasFor(["Werkbank.Auditor"]).map((area) => area.id)).toEqual(["werkbank"]);
  });

  it("ordnet jede Seite ihrem Bereich zu", () => {
    const areas = areasFor(all);
    const id = (path: string) => areaForPath(areas, path)?.id;
    expect(id("/")).toBe("werkbank");
    expect(id("/konto")).toBe("werkbank");
    expect(id("/m365/einstellungen/12")).toBe("m365");
    expect(id("/m365/empfehlungen")).toBe("m365");
    expect(id("/evergreen/7")).toBe("m365");
    expect(id("/verwaltung")).toBe("werkbank");
  });
});
