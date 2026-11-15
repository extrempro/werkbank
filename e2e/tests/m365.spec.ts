import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

// Die Testumgebung hat keinen Zugang zu einem Tenant: geprüft werden Aufbau, Rechte und
// Barrierefreiheit der Seiten im leeren Zustand. Inhalte decken die Backend- und
// Komponententests ab.

test("Übersicht zeigt den Stand und den Hinweis auf den fehlenden Abruf", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/m365");
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await expect(page.getByText("noch nicht eingerichtet")).toBeVisible();
  await expect(page.getByText("Offene Änderungen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Änderungen pro Tag" })).toBeVisible();
  await expect(page.getByText("Noch keine Änderungen erkannt.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt abrufen" })).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test("Änderungen, Einstellungen und Snapshots sind erreichbar und leer", async ({ page }) => {
  await loginAs(page, ["Config.Reviewer"], "Rita Reviewer");

  await page.goto("/m365/aenderungen");
  await expect(page.getByRole("heading", { level: 1, name: "Änderungen" })).toBeVisible();
  await expect(page.getByText("Keine Änderungen für diese Auswahl.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Offen (0)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Alle (0)" }).click();
  await expect(page.getByRole("button", { name: "Alle (0)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectNoA11yViolations(page);

  await page.goto("/m365/einstellungen");
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
  await page.getByLabel("Suche in Name und Pfad").fill("mfa");
  await page.getByLabel("Entfernte anzeigen").check();
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page.getByText("Keine Einstellungen für diese Auswahl.")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/m365/snapshots");
  await expect(page.getByText("Noch kein Abruf vorhanden.")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Unbekannte Einstellung zeigt einen Hinweis und den Weg zurück", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/m365/einstellungen/999999");
  await expect(page.getByText("Diese Einstellung gibt es nicht.")).toBeVisible();
  await page.getByRole("link", { name: "Zurück zu den Einstellungen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
});

test("Ohne Rolle für die Konfiguration bleibt das Modul verschlossen", async ({ page }) => {
  await loginAs(page, ["Evergreen.Team"], "Tom Team");
  await page.goto("/m365/einstellungen/1");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  for (const path of ["overview", "settings", "changes", "snapshots"]) {
    const response = await page.request.get(`/api/m365-config/${path}`);
    expect(response.status()).toBe(403);
  }
});

test("Empfehlungen: Seite erklärt, wenn der Abruf nicht eingeschaltet ist", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/m365/empfehlungen");
  await expect(page.getByRole("heading", { level: 1, name: "Empfehlungen" })).toBeVisible();
  await expect(page.getByText(/ist in dieser Installation nicht eingeschaltet/)).toBeVisible();
  await expectNoA11yViolations(page);
  const api = await page.request.get("/api/m365-config/recommendations");
  expect(api.status()).toBe(200);
  expect((await api.json()).enabled).toBe(false);
});

test("Tenant: Lizenzen und Benutzer erklären den leeren Zustand, nur mit der Rolle", async ({
  page,
}) => {
  await loginAs(page, ["Tenant.Reader"], "Tom Tenant");
  await page.goto("/m365/lizenzen");
  await expect(page.getByRole("heading", { level: 1, name: "Lizenzen" })).toBeVisible();
  await expect(page.getByText(/ist in dieser Installation nicht eingeschaltet/)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto("/m365/benutzer");
  await expect(page.getByRole("heading", { level: 1, name: "Benutzer" })).toBeVisible();
  await expect(page.getByText(/ist in dieser Installation nicht eingeschaltet/)).toBeVisible();
  await expectNoA11yViolations(page);
  // Die Konfiguration gehört nicht zu dieser Rolle.
  await page.goto("/m365/einstellungen");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
});

test("Tenant: ohne die Rolle gibt es die Seiten und die Daten nicht", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/m365/lizenzen");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  for (const path of ["/api/tenant/licenses", "/api/tenant/users"]) {
    expect((await page.request.get(path)).status()).toBe(403);
  }
});
