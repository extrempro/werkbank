import { describe, expect, it } from "vitest";
import { allNavItems, areaForPath, areasFor, navigationFor } from "./navigation";

describe("navigationFor", () => {
  it("zeigt Betriebsrat nur Start und Evergreen", () => {
    const groups = navigationFor(["Evergreen.Betriebsrat"]);
    expect(allNavItems(groups).map((item) => item.label)).toEqual(["Start", "Suche", "Vorgänge"]);
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

  it("gibt Microsoft 365 und Evergreen je einen eigenen Bereich", () => {
    const areas = areasFor(all);
    expect(areas.map((area) => area.label)).toEqual(["Werkbank", "Microsoft 365", "Evergreen"]);
    expect(areas.map((area) => area.home)).toEqual(["/", "/m365", "/evergreen"]);
    const paths = (index: number) => allNavItems(areas[index]?.groups ?? []).map((i) => i.path);
    expect(paths(0)).toEqual(["/", "/suche", "/reports", "/audit", "/verwaltung"]);
    expect(paths(1).every((path) => path.startsWith("/m365"))).toBe(true);
    expect(paths(2)).toEqual(["/evergreen", "/evergreen/eingang"]);
  });

  it("zeigt nur Bereiche, für die es eine Rolle gibt", () => {
    expect(areasFor(["Evergreen.Betriebsrat"]).map((area) => area.id)).toEqual([
      "werkbank",
      "evergreen",
    ]);
    expect(areasFor(["Config.Reader"]).map((area) => area.id)).toEqual(["werkbank", "m365"]);
    expect(areasFor(["Werkbank.Auditor"]).map((area) => area.id)).toEqual(["werkbank"]);
  });

  it("ordnet jede Seite ihrem Bereich zu", () => {
    const areas = areasFor(all);
    const id = (path: string) => areaForPath(areas, path)?.id;
    expect(id("/")).toBe("werkbank");
    expect(id("/konto")).toBe("werkbank");
    expect(id("/m365/einstellungen/12")).toBe("m365");
    expect(id("/m365/empfehlungen")).toBe("m365");
    expect(id("/evergreen/7")).toBe("evergreen");
    expect(id("/verwaltung")).toBe("werkbank");
  });
});
