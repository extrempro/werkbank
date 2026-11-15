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

test("Admin pflegt SMTP-Server und Aufbewahrungsfrist, das Passwort bleibt verborgen", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung");
  await expect(page.getByRole("heading", { level: 2, name: "Allgemein" })).toBeVisible();
  await page.getByLabel("Server", { exact: true }).fill("smtp.example.com");
  await page.getByLabel("Port", { exact: true }).fill("587");
  await page.getByLabel("Absenderadresse", { exact: true }).fill("werkbank@example.com");
  await page.getByLabel("Benutzername (freiwillig)").fill("werkbank@example.com");
  await page.getByLabel(/Passwort/).fill("e2e-geheim-4711");
  await page.getByRole("button", { name: "SMTP-Server speichern" }).click();
  await expect(page.getByText("Der SMTP-Server ist gespeichert.")).toBeVisible();
  await expect(page.getByLabel("Neues Passwort")).toHaveValue("");
  await expectNoA11yViolations(page);

  const stored = await page.request.get("/api/admin/settings");
  expect(stored.status()).toBe(200);
  const text = await stored.text();
  expect(text).not.toContain("e2e-geheim-4711");
  expect(JSON.parse(text).smtp.password_set).toBe(true);

  await page.getByLabel("Einträge löschen nach (Tage)").fill("120");
  await page.getByRole("button", { name: "Aufbewahrung speichern" }).click();
  await expect(page.getByText("Die Aufbewahrungsfrist ist gespeichert.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Einträge löschen nach (Tage)")).toHaveValue("120");
  await expect(page.getByLabel("Server", { exact: true })).toHaveValue("smtp.example.com");
});

test("Betriebsrat kommt nicht an Audit-Log und Verwaltung", async ({ page }) => {
  await loginAs(page, ["Evergreen.Betriebsrat"], "Karl Rat");
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  const api = await page.request.get("/api/audit");
  expect(api.status()).toBe(403);
  expect((await page.request.get("/api/admin/settings")).status()).toBe(403);
  const roles = await page.request.get("/api/admin/roles");
  expect(roles.status()).toBe(403);
});
