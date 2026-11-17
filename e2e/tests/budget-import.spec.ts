import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

test("Budgetverwalter importiert eine Excel-Datei Zeile für Zeile", async ({
  page,
}, testInfo) => {
  // Eigene Person je Lauf: Entwürfe gehören der Person, die sie hochlädt.
  await loginAs(
    page,
    ["Budget.Manager"],
    `Ines Import ${testInfo.project.name} ${testInfo.retry}`,
  );
  await page.goto("/budget/import");
  await expect(
    page.getByRole("heading", { level: 1, name: "Import aus Excel" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page
    .getByLabel(/^Excel-Datei/)
    .setInputFiles("tests/fixtures/budget-import.xlsx");
  await expect(
    page.getByRole("heading", { name: /Erkanntes prüfen/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Konten und Budget" }),
  ).toContainText("Hardware");
  await expectNoA11yViolations(page);

  await page
    .getByRole("button", { name: "Vorgang anlegen und Zeilen abarbeiten" })
    .click();
  await expect(page).toHaveURL(/\/budget\/import\/\d+$/);
  await expect(page.getByRole("heading", { name: /^Zeile 5:/ })).toBeVisible();
  await expectNoA11yViolations(page);

  // Eigene Rechnungsnummer je Lauf, sonst erkennt der Import eine doppelte Rechnung.
  await page
    .getByLabel("Rechnungsnummer", { exact: true })
    .fill(`E2E-${testInfo.project.name}-${Date.now()}`);
  await page.getByRole("button", { name: "Übernehmen und weiter" }).click();
  await expect(page.getByRole("heading", { name: /^Zeile 6:/ })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /1 übernommen, 0 übersprungen, 3 offen/,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Überspringen" }).click();
  await expect(
    page.getByRole("heading", {
      name: /1 übernommen, 1 übersprungen, 2 offen/,
    }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("ohne Budgetverwaltung gibt es den Import nicht", async ({ page }) => {
  await loginAs(page, ["Budget.Editor"], "Ede Editor");
  await page.goto("/budget/import");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/budget/imports");
  expect(api.status()).toBe(403);
});
