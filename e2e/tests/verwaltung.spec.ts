import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

test("Admin sieht das Audit-Log mit der eigenen Anmeldung", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit-Log" })).toBeVisible();
  await expect(page.getByText("anmeldung.erfolgreich").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Als CSV exportieren" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Audit-Log lässt sich nach Modul filtern", async ({ page }) => {
  await loginAs(page, ["Werkbank.Auditor"], "Udo Auditor");
  await page.goto("/audit");
  await page.getByLabel("Modul").selectOption("kern");
  await page.getByLabel("Aktion enthält").fill("anmeldung");
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page.getByText("anmeldung.erfolgreich").first()).toBeVisible();

  await page.getByLabel("Aktion enthält").fill("gibt-es-nicht");
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page.getByText("Keine Einträge für diese Auswahl.")).toBeVisible();
});

test("Admin sieht die Rollen in der Verwaltung", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung");
  await expect(page.getByRole("heading", { level: 2, name: "Rollen" })).toBeVisible();
  await expect(page.getByText("Evergreen Betriebsrat", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Ada Admin/ }).first()).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Betriebsrat kommt nicht an Audit-Log und Verwaltung", async ({ page }) => {
  await loginAs(page, ["Evergreen.Betriebsrat"], "Karl Rat");
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  const api = await page.request.get("/api/audit");
  expect(api.status()).toBe(403);
  const roles = await page.request.get("/api/admin/roles");
  expect(roles.status()).toBe(403);
});
