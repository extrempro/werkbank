import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openPage } from "./helpers";

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
  await expect(page.getByRole("heading", { level: 1, name: "Hosts" })).toBeVisible();
  await expect(page.getByText("Kein Host passt zur Auswahl.")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto("/monitoring/zabbix/wartungen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Wartungen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  const api = await page.request.get("/api/monitoring/zabbix/connection");
  expect(api.status()).toBe(403);
});

test("IT-Monitoring: Admins sehen die Verbindung zu Zabbix", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/monitoring/zabbix/verbindung");
  await expect(
    page.getByRole("heading", { level: 1, name: "Verbindung" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Abfragen" })).toBeVisible();
  await expect(page.getByText(/noch nicht eingerichtet/)).toBeVisible();
  await expectNoA11yViolations(page);
});
