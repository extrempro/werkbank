import { expect, test } from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs, openPage } from "./helpers";

const ORIGIN = new URL(BASE_URL).origin;

test("IT-Monitoring zeigt den DNS-Abgleich und ist barrierefrei", async ({
  page,
}) => {
  await loginAs(page, ["Monitoring.Reader"], "Mona Monitoring");
  await page.goto("/");
  await openPage(page, "IT-Monitoring", "DNS-Abgleich");
  await expect(page).toHaveURL(/\/monitoring\/dns$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "DNS-Abgleich mit NetBox" }),
  ).toBeVisible();
  await expect(
    page.getByText(/nicht eingerichtet oder ausgeschaltet/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt prüfen" })).toHaveCount(
    0,
  );
  await expectNoA11yViolations(page);
});

test("ohne Rolle gibt es den Bereich nicht", async ({ page }) => {
  await loginAs(page, ["Budget.Reader"], "Bea Budget");
  await page.goto("/monitoring/dns");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/monitoring/dns");
  expect(api.status()).toBe(403);
});

test("IT-Monitoring: Zabbix ohne Verbindung, Hosts und Wartungen", async ({
  page,
}) => {
  await loginAs(page, ["Monitoring.Reader"], "Mona Monitoring");
  await page.goto("/");
  await openPage(page, "IT-Monitoring", "Übersicht");
  await expect(page).toHaveURL(/\/monitoring\/zabbix$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Übersicht" }),
  ).toBeVisible();
  await expect(page.getByText(/noch nicht eingerichtet/)).toBeVisible();
  await expectNoA11yViolations(page);
  // Die Verbindungsseite gibt es nur für Admins
  await expect(
    page.getByRole("link", { name: "Verbindung", exact: true }),
  ).toHaveCount(0);
  await page.goto("/monitoring/zabbix/hosts");
  await expect(
    page.getByRole("heading", { level: 1, name: "Hosts" }),
  ).toBeVisible();
  await expect(page.getByText("Kein Host passt zur Auswahl.")).toBeVisible();
  await expectNoA11yViolations(page);
  // Abgleich mit dem IT-Bestand: Geräte statt Hosts, ohne Bestand.Editor keine Aktionen
  await page.goto("/monitoring/zabbix/hosts?filter=nicht-ueberwacht");
  await expect(page.getByText(/keine Hardware-Arten festgelegt/)).toBeVisible();
  await expect(page.getByText("Kein Gerät fehlt in Zabbix.")).toBeVisible();
  await expectNoA11yViolations(page);
  const headers = { Origin: ORIGIN };
  expect(
    (
      await page.request.put("/api/monitoring/zabbix/devices/1/unmonitored", {
        data: { reason: "Test" },
        headers,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/monitoring/zabbix/hosts/1/link", {
        data: { hardware_id: 1 },
        headers,
      })
    ).status(),
  ).toBe(403);
  await page.goto("/monitoring/zabbix/wartungen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Wartungen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  const api = await page.request.get("/api/monitoring/zabbix/connection");
  expect(api.status()).toBe(403);
});

test("IT-Monitoring: Admins sehen die Verbindung zu Zabbix", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/monitoring/zabbix/verbindung");
  await expect(
    page.getByRole("heading", { level: 1, name: "Verbindung" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Abfragen" })).toBeVisible();
  await expect(page.getByText(/noch nicht eingerichtet/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Monitoring: Berichte für die Rolle nur mit Berichten", async ({
  page,
}) => {
  await loginAs(page, ["Monitoring.Berichte"], "Gerd Bericht");
  await page.goto("/");
  await openPage(page, "IT-Monitoring", "Berichte");
  await expect(page).toHaveURL(/\/monitoring\/zabbix\/berichte$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Berichte" }),
  ).toBeVisible();
  await expect(page.getByText("99,50 %")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Als CSV exportieren" }),
  ).toBeVisible();
  // Ohne Hostdetails: keine Auslöser, keine anderen Zabbix-Seiten
  await expect(
    page.getByRole("heading", { name: "Häufigste Auslöser" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Hosts", exact: true }),
  ).toHaveCount(0);
  await expectNoA11yViolations(page);
  await page.goto("/monitoring/zabbix/hosts");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  expect(
    (await page.request.get("/api/monitoring/zabbix/hosts")).status(),
  ).toBe(403);
  const csv = await page.request.get(
    "/api/monitoring/zabbix/reports/export.csv",
  );
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Gesamt");
});

test("IT-Monitoring: Berichte mit Auslösern für Monitoring.Reader", async ({
  page,
}) => {
  await loginAs(page, ["Monitoring.Reader"], "Mona Monitoring");
  await page.goto("/monitoring/zabbix/berichte");
  await expect(
    page.getByRole("heading", { level: 1, name: "Berichte" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Häufigste Auslöser" }),
  ).toBeVisible();
  await page.getByLabel("Aufteilen nach").selectOption("gruppe");
  await expect(
    page.getByRole("heading", { name: "Nach Hostgruppe" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Monitoring: Zabbix-Übersicht mit Gesamtstand, Standorten und Filtern", async ({
  page,
}) => {
  // Ohne echtes Zabbix: die Antwort der Übersicht wird nachgebildet (erfundene Daten).
  const now = Date.now();
  const problem = (index: number, severity: number, site: string | null) => ({
    eventid: String(5000 + index),
    name: `Beispielproblem ${index}`,
    severity,
    since: new Date(now - (index + 1) * 3_600_000).toISOString(),
    acknowledged: false,
    suppressed: false,
    tags: [],
    hostid: String(100 + index),
    host: `host-${index}`,
    site,
    link: null,
  });
  const cells = (count: number, marks: Record<number, string>) =>
    Array.from({ length: count }, (_, index) => ({
      hostid: `${count}-${index}`,
      name: `host-${index}`,
      state: marks[index] ?? "ok",
    }));
  const data = {
    state: {
      configured: true,
      data_at: new Date(now).toISOString(),
      stale: false,
      error: null,
      failures: 0,
      next_at: null,
      zabbix_url: null,
    },
    kpis: {
      problems: 3,
      by_severity: { "4": 1, "2": 2 },
      hosts: 20,
      unreachable: 1,
      maintenance: 1,
    },
    problems: [
      problem(0, 4, "Gebäude A"),
      problem(1, 2, "Gebäude A"),
      problem(2, 2, null),
    ],
    unreachable: [
      {
        hostid: "9",
        name: "host-9",
        site: "Gebäude A",
        since: null,
        link: null,
      },
    ],
    maintenances: [],
    todo: {
      long_open: 0,
      unmonitored: 0,
      no_inventory: 0,
      no_serial: 0,
      certificates: [],
      certificate_tag: null,
    },
    sites: ["Gebäude A"],
    site_health: [
      {
        name: "Gebäude A",
        hosts: 14,
        unreachable: 1,
        maintenance: 1,
        problems: 2,
        worst: 4,
        cells: cells(14, { 0: "4", 1: "2", 2: "wartung", 13: "down" }),
      },
      {
        name: null,
        hosts: 6,
        unreachable: 0,
        maintenance: 0,
        problems: 1,
        worst: 2,
        cells: cells(6, { 0: "2" }),
      },
    ],
    history: Array.from({ length: 24 }, (_, index) => ({
      hour: new Date(now - (23 - index) * 3_600_000).toISOString(),
      open: index < 4 ? null : (index % 5) + 1,
      high: 0,
    })),
  };
  await page.route("**/api/monitoring/zabbix", (route) =>
    route.fulfill({ json: data }),
  );
  await loginAs(page, ["Monitoring.Reader"], "Mona Monitoring");
  await page.goto("/monitoring/zabbix");
  await expect(
    page.getByRole("heading", { name: /1 schweres Problem offen/ }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Warnung: 2 Probleme" }).click();
  await expect(page.getByText(/nur Warnung · 2 Probleme/)).toBeVisible();
  await expect(page.getByText("Beispielproblem 0")).toHaveCount(0);
  await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
  await page.getByRole("button", { name: /^Ohne Standort/ }).click();
  await expect(page.getByText(/Ohne Standort · 1 Problem/)).toBeVisible();
  await expect(page.getByText("Beispielproblem 2")).toBeVisible();
  await expectNoA11yViolations(page);
});
