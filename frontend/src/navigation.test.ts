import { describe, expect, it } from "vitest";
import { allNavItems, areaForPath, areasFor, navigationFor } from "./navigation";

describe("navigationFor", () => {
  it("zeigt Betriebsrat nur Start und Evergreen", () => {
    const groups = navigationFor(["Evergreen.Betriebsrat"]);
    expect(allNavItems(groups).map((item) => item.label)).toEqual(["Start", "Suche", "Vorgänge"]);
  });

  it("zeigt dem Admin die Verwaltung und das Audit-Log", () => {
    const labels = allNavItems(navigationFor(["Werkbank.Admin"])).map((item) => item.label);
    expect(labels).toContain("Allgemein");
    expect(labels).toContain("Rollen");
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
    expect(areas.map((area) => area.label)).toEqual([
      "Werkbank",
      "Microsoft 365",
      "Evergreen",
      "IT-Monitoring",
      "Verwaltung",
    ]);
    expect(areas.map((area) => area.home)).toEqual([
      "/",
      "/m365",
      "/evergreen",
      "/monitoring/dns",
      "/verwaltung",
    ]);
    const paths = (index: number) => allNavItems(areas[index]?.groups ?? []).map((i) => i.path);
    expect(paths(0)).toEqual(["/", "/suche"]);
    expect(paths(4)).toEqual([
      "/verwaltung",
      "/verwaltung/rollen",
      "/verwaltung/mail-teams",
      "/verwaltung/verbindungen",
      "/audit",
    ]);
    expect(paths(1).every((path) => path.startsWith("/m365"))).toBe(true);
    expect(paths(2)).toEqual(["/evergreen", "/evergreen/eingang"]);
  });

  it("zeigt nur Bereiche, für die es eine Rolle gibt", () => {
    expect(areasFor(["Evergreen.Betriebsrat"]).map((area) => area.id)).toEqual([
      "werkbank",
      "evergreen",
    ]);
    expect(areasFor(["Config.Reader"]).map((area) => area.id)).toEqual(["werkbank", "m365"]);
    expect(areasFor(["Monitoring.Reader"]).map((area) => area.id)).toEqual([
      "werkbank",
      "monitoring",
    ]);
    expect(areasFor(["Projekte.Reader"]).map((area) => area.id)).toEqual(["werkbank", "projekte"]);
    expect(areasFor(["Budget.Reader"]).map((area) => area.id)).not.toContain("projekte");
    expect(areasFor(["Bestand.Reader"]).map((area) => area.id)).toEqual(["werkbank", "bestand"]);
    expect(areasFor(["Projekte.Reader"]).map((area) => area.id)).not.toContain("bestand");
  });

  it("ordnet die Seiten eines Projekts dem Bereich IT-Projekte zu", () => {
    const areas = areasFor(["Projekte.Editor"]);
    const id = (path: string) => areaForPath(areas, path)?.id;
    expect(id("/projekte")).toBe("projekte");
    expect(id("/projekte/12")).toBe("projekte");
    expect(id("/projekte/12/jour-fixe")).toBe("projekte");
  });

  it("ordnet die Seiten des IT-Bestands dem Bereich zu", () => {
    const areas = areasFor(["Bestand.Reader", "Projekte.Reader"]);
    const id = (path: string) => areaForPath(areas, path)?.id;
    expect(id("/bestand/hardware")).toBe("bestand");
    expect(id("/bestand/hardware/7")).toBe("bestand");
    expect(id("/bestand/stammdaten")).toBe("bestand");
    expect(id("/bestand/standorte")).toBe("bestand");
    expect(id("/bestand/standorte/etage/3/raum/4")).toBe("bestand");
    expect(id("/bestand/stellen/7/verlauf")).toBe("bestand");
    expect(id("/bestand/arbeitsplaetze/2")).toBe("bestand");
  });

  it("ordnet jede Seite ihrem Bereich zu", () => {
    const areas = areasFor(all);
    const id = (path: string) => areaForPath(areas, path)?.id;
    expect(id("/")).toBe("werkbank");
    expect(id("/konto")).toBe("werkbank");
    expect(id("/m365/einstellungen/12")).toBe("m365");
    expect(id("/m365/empfehlungen")).toBe("m365");
    expect(id("/evergreen/7")).toBe("evergreen");
    expect(id("/verwaltung")).toBe("verwaltung");
    expect(id("/verwaltung/rollen")).toBe("verwaltung");
    expect(id("/audit")).toBe("verwaltung");
  });

  it("zeigt Lizenzen und Benutzer nur mit der Rolle für den Tenant", () => {
    const config = areasFor(["Config.Reader"]).find((area) => area.id === "m365");
    expect(allNavItems(config?.groups ?? []).map((item) => item.label)).not.toContain("Lizenzen");
    const tenant = areasFor(["Tenant.Reader"]).find((area) => area.id === "m365");
    expect(tenant?.home).toBe("/m365/lizenzen");
    expect(allNavItems(tenant?.groups ?? []).map((item) => item.label)).toEqual([
      "Lizenzen",
      "Benutzer",
      "Zertifikate & Secrets",
      "Dienststatus",
      "Nutzung",
    ]);
    const both = areasFor(["Config.Reader", "Tenant.Reader"]).find((area) => area.id === "m365");
    expect(both?.home).toBe("/m365");
    expect(both?.groups.map((group) => group.title)).toEqual(["Konfiguration", "Tenant"]);
  });

  it("führt die Kategorien der IT-Tools als eigene Einträge", () => {
    const areas = areasFor(["Tools.User"]);
    const tools = areas.find((area) => area.id === "it-tools");
    const items = allNavItems(tools?.groups ?? []);
    expect(items[0]).toMatchObject({ path: "/it-tools", label: "Alle Tools" });
    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["Netzwerk", "Encoding", "Formatter", "Konverter", "Text"]),
    );
    expect(items.find((item) => item.label === "Netzwerk")?.path).toBe(
      "/it-tools/kategorie/netzwerk",
    );
    // Seiten einer Kategorie und einzelne Tools gehören zum Bereich IT-Tools.
    expect(areaForPath(areas, "/it-tools/kategorie/text")?.id).toBe("it-tools");
    expect(areaForPath(areas, "/it-tools/chmod")?.id).toBe("it-tools");
  });

  it("gibt dem IT-Budget einen eigenen Bereich, Einstellungen nur für den Budgetverwalter", () => {
    const paths = (roles: string[]) =>
      allNavItems(areasFor(roles).find((area) => area.id === "budget")?.groups ?? []).map(
        (item) => item.path,
      );
    const shared = [
      "/budget",
      "/budget/posten",
      "/budget/planung",
      "/budget/statistik",
      "/budget/vertraege",
      "/budget/rechnungen",
      "/budget/partner",
      "/budget/konten",
    ];
    expect(paths(["Budget.Reader"])).toEqual(shared);
    expect(paths(["Budget.Editor"])).toEqual(shared);
    expect(paths(["Budget.Manager"])).toEqual([
      ...shared,
      "/budget/import",
      "/budget/einstellungen",
    ]);
    expect(paths(["Tenant.Reader"])).toEqual([]);
    const areas = areasFor(["Budget.Manager"]);
    expect(areaForPath(areas, "/budget/konten")?.id).toBe("budget");
  });
});
