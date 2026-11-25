import { describe, expect, it } from "vitest";
import {
  activeNavPath,
  allNavItems,
  areaForPath,
  areasFor,
  findNavEntry,
  navigationFor,
  searchPages,
} from "./navigation";

describe("navigationFor", () => {
  it("zeigt Evergreen-Lesern nur Start und Evergreen › Microsoft 365", () => {
    const groups = navigationFor(["Evergreen.Reader"]);
    expect(allNavItems(groups).map((item) => item.path)).toEqual([
      "/",
      "/suche",
      "/evergreen/m365",
    ]);
  });

  it("zeigt dem Admin die Verwaltung und das Audit-Log", () => {
    const labels = allNavItems(navigationFor(["Werkbank.Admin"])).map((item) => item.label);
    expect(labels).toContain("Allgemein");
    expect(labels).toContain("Berechtigungen");
    expect(labels).toContain("Audit-Log");
  });

  it("zeigt Lesern der Konfiguration kein Audit-Log", () => {
    const labels = allNavItems(navigationFor(["Config.Reader"])).map((item) => item.label);
    expect(labels).toContain("Änderungen");
    expect(labels).not.toContain("Audit-Log");
  });

  it("zeigt Lesern und Bearbeitern von Evergreen dieselben Seiten", () => {
    const paths = (roles: string[]) => allNavItems(navigationFor(roles)).map((item) => item.path);
    expect(paths(["Evergreen.Editor"])).toEqual(paths(["Evergreen.Reader"]));
  });

  it("ignoriert unbekannte Rollen", () => {
    expect(navigationFor(["Irgendwas"])).toHaveLength(2);
  });

  it("gibt jedem Eintrag ein Symbol und führt Neuigkeiten nicht mehr als Menüpunkt", () => {
    const items = allNavItems(
      navigationFor(["Werkbank.Admin", "Config.Reader", "Evergreen.Editor"]),
    );
    expect(items.every((item) => item.icon.length > 0)).toBe(true);
    expect(items.map((item) => item.label)).not.toContain("Neuigkeiten");
  });
});

describe("areasFor", () => {
  const all = ["Werkbank.Admin", "Config.Reader", "Evergreen.Editor"];

  it("gibt Microsoft 365 und Evergreen je einen eigenen Bereich", () => {
    const areas = areasFor(all);
    expect(areas.map((area) => area.label)).toEqual([
      "Start",
      "Microsoft 365",
      "Evergreen",
      "Verwaltung",
    ]);
    expect(areas.map((area) => area.home)).toEqual([
      "/",
      "/m365",
      "/evergreen/m365",
      "/verwaltung",
    ]);
    const paths = (index: number) => allNavItems(areas[index]?.groups ?? []).map((i) => i.path);
    expect(paths(0)).toEqual(["/", "/suche"]);
    expect(paths(3)).toEqual([
      "/verwaltung",
      "/verwaltung/berechtigungen",
      "/verwaltung/mail-teams",
      "/verwaltung/verbindungen",
      "/verwaltung/zabbix",
      "/verwaltung/datensicherung",
      "/audit",
    ]);
    expect(paths(1).every((path) => path.startsWith("/m365"))).toBe(true);
    expect(paths(2)).toEqual(["/evergreen/m365"]);
  });

  it("zeigt Admins das IT-Monitoring nur mit Monitoring.Reader", () => {
    expect(areasFor(["Werkbank.Admin"]).some((area) => area.id === "monitoring")).toBe(false);
    const monitoring = areasFor(["Werkbank.Admin", "Monitoring.Reader"]).find(
      (area) => area.id === "monitoring",
    )!;
    expect(allNavItems(monitoring.groups).map((item) => item.path)).not.toContain(
      "/verwaltung/zabbix",
    );
  });

  it("zeigt nur Bereiche, für die es eine Rolle gibt", () => {
    expect(areasFor(["Evergreen.Reader"]).map((area) => area.id)).toEqual([
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

  it("zeigt mit Monitoring.Berichte nur die Berichte", () => {
    const reports = areasFor(["Monitoring.Berichte"]).find((area) => area.id === "monitoring")!;
    expect(reports.home).toBe("/monitoring/zabbix/berichte");
    expect(reports.groups.flatMap((group) => group.items.map((item) => item.path))).toEqual([
      "/monitoring/zabbix/berichte",
    ]);
    const full = areasFor(["Monitoring.Reader", "Monitoring.Berichte"]).filter(
      (area) => area.id === "monitoring",
    );
    expect(full).toHaveLength(1);
    expect(full[0]!.home).toBe("/monitoring/zabbix");
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
    expect(id("/bestand/vorgaenge/12")).toBe("bestand");
  });

  it("ordnet jede Seite ihrem Bereich zu", () => {
    const areas = areasFor(all);
    const id = (path: string) => areaForPath(areas, path)?.id;
    expect(id("/")).toBe("werkbank");
    expect(id("/konto")).toBe("werkbank");
    expect(id("/m365/einstellungen/12")).toBe("m365");
    expect(id("/m365/empfehlungen")).toBe("m365");
    expect(id("/evergreen/m365/7")).toBe("evergreen");
    expect(id("/verwaltung")).toBe("verwaltung");
    expect(id("/verwaltung/berechtigungen")).toBe("verwaltung");
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

  it("zeigt die Gerätezuordnung nur mit ihrer Rolle", () => {
    const only = areasFor(["Geraete.Zuordnung"]).find((area) => area.id === "m365");
    expect(only?.home).toBe("/m365/geraete/zuordnung");
    expect(only?.groups.map((group) => group.title)).toEqual(["Geräte"]);
    const config = areasFor(["Config.Reader"]).find((area) => area.id === "m365");
    expect(config?.groups.map((group) => group.title)).not.toContain("Geräte");
    const all = areasFor(["Config.Reader", "Tenant.Reader", "Geraete.Zuordnung"]).find(
      (area) => area.id === "m365",
    );
    expect(all?.groups.map((group) => group.title)).toEqual(["Konfiguration", "Tenant", "Geräte"]);
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
      "/budget/planung",
      "/budget/statistik",
      "/budget/posten",
      "/budget/rechnungen",
      "/budget/vertraege",
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

  it("gruppiert das IT-Budget; die Verwaltung ist anfangs eingeklappt", () => {
    const budget = (roles: string[]) => areasFor(roles).find((area) => area.id === "budget");
    expect(budget(["Budget.Reader"])?.groups.map((group) => group.title)).toEqual([
      "Überblick",
      "Ausgaben",
      "Stammdaten",
    ]);
    const manager = budget(["Budget.Manager"]);
    expect(manager?.groups.map((group) => [group.title, group.collapsed ?? false])).toEqual([
      ["Überblick", false],
      ["Ausgaben", false],
      ["Stammdaten", false],
      ["Verwaltung", true],
    ]);
  });

  it("gruppiert den IT-Bestand", () => {
    const bestand = areasFor(["Bestand.Reader"]).find((area) => area.id === "bestand");
    expect(
      bestand?.groups.map((group) => [group.title, group.items.map((item) => item.label)]),
    ).toEqual([
      [null, ["Vorgänge", "Statistik"]],
      ["Bestand", ["Hardware", "Stellen", "Arbeitsplätze", "Standorte"]],
      ["Verleih", ["Verleih"]],
      ["Verwaltung", ["Stammdaten"]],
    ]);
    expect(bestand?.groups[3]?.collapsed).toBe(true);
  });

  it("gibt jedem Bereich Kurzname, Symbol und Abschnitt der Leiste in der richtigen Reihenfolge", () => {
    const areas = areasFor([
      "Werkbank.Admin",
      "Monitoring.Reader",
      "Config.Reader",
      "Evergreen.Editor",
      "Budget.Manager",
      "Tools.User",
      "Projekte.Reader",
      "Bestand.Reader",
    ]);
    expect(areas.map((area) => [area.short, area.section])).toEqual([
      ["Start", "start"],
      ["M365", "anwendungen"],
      ["Evergreen", "anwendungen"],
      ["Monitoring", "betrieb"],
      ["Bestand", "betrieb"],
      ["Budget", "planung"],
      ["Projekte", "planung"],
      ["Tools", "werkzeuge"],
      ["Verwaltung", "unten"],
    ]);
    expect(new Set(areas.map((area) => area.icon)).size).toBe(areas.length);
    expect(areas.every((area) => area.short.length <= 10)).toBe(true);
  });

  it("zeigt den Start-Bereich mit Start und Suche", () => {
    const start = areasFor([])[0];
    expect(start?.id).toBe("werkbank");
    expect(allNavItems(start?.groups ?? []).map((item) => item.path)).toEqual(["/", "/suche"]);
  });
});

describe("activeNavPath", () => {
  const items = allNavItems(navigationFor(["Bestand.Reader", "Budget.Reader"]));

  it("findet den Menüpunkt, unter dem eine Seite liegt", () => {
    expect(activeNavPath(items, "/bestand/hardware")).toBe("/bestand/hardware");
    expect(activeNavPath(items, "/bestand/hardware/7/verlauf")).toBe("/bestand/hardware");
    expect(activeNavPath(items, "/budget/vertraege/3")).toBe("/budget/vertraege");
    // Der längste Pfad gewinnt: /budget/partner, nicht /budget
    expect(activeNavPath(items, "/budget/partner/4")).toBe("/budget/partner");
    expect(activeNavPath(items, "/konto")).toBeUndefined();
    expect(activeNavPath(items, "/")).toBe("/");
  });
});

describe("Anheften und Suche nach Seiten", () => {
  it("findet Seiten nur mit Recht", () => {
    const reader = areasFor(["Budget.Reader"]);
    expect(findNavEntry(reader, "/budget/rechnungen")?.area.short).toBe("Budget");
    expect(findNavEntry(reader, "/budget/rechnungen")?.group).toBe("Ausgaben");
    // Pfade ohne Recht lassen sich nicht anheften: Es gibt keinen Menüpunkt dafür.
    expect(findNavEntry(reader, "/budget/import")).toBeUndefined();
    expect(findNavEntry(reader, "/verwaltung")).toBeUndefined();
    expect(findNavEntry(reader, "/budget/rechnungen/12")).toBeUndefined();
    expect(findNavEntry(areasFor(["Budget.Manager"]), "/budget/import")?.group).toBe("Verwaltung");
  });

  it("sucht nach Name, Gruppe und Bereich, Treffer im Namen zuerst", () => {
    const areas = areasFor(["Budget.Manager", "Bestand.Reader", "Tools.User"]);
    const labels = (query: string) =>
      searchPages(areas, query).map((entry) => `${entry.item.label} (${entry.area.short})`);
    expect(labels("statistik")).toEqual(["Statistik (Bestand)", "Statistik (Budget)"]);
    expect(labels("budget statistik")).toEqual(["Statistik (Budget)"]);
    expect(labels("ausgaben")).toEqual([
      "Budgetposten (Budget)",
      "Rechnungen (Budget)",
      "Verträge (Budget)",
    ]);
    // Umlaute: „vertrage“ findet nichts, „vertraege“ und „verträ“ schon
    expect(labels("vertraege")).toEqual(["Verträge (Budget)"]);
    expect(labels("verträ")).toEqual(["Verträge (Budget)"]);
    expect(labels("arbeitspl")).toEqual(["Arbeitsplätze (Bestand)"]);
    expect(labels("")).toEqual([]);
    expect(labels("dns")).toEqual([]);
  });
});
