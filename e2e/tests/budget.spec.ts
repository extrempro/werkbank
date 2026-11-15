import { expect, test } from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

const ORIGIN = new URL(BASE_URL).origin;

test("Budgetverwalter legt ein Konto an und plant es", async ({ page }) => {
  // Eigene Kontonummer je Lauf, damit eine Wiederholung nicht an einem vorhandenen Konto scheitert.
  const number = `T${Date.now() % 100_000_000}`;
  await loginAs(page, ["Budget.Manager"], "Bodo Budget");

  await page.goto("/budget/konten");
  await expect(page.getByRole("heading", { level: 1, name: "Konten" })).toBeVisible();
  await page.getByLabel("Kontonummer", { exact: true }).fill(number);
  await page.getByLabel("Bezeichnung", { exact: true }).fill("Testkonto Wartung");
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByText(`Konto ${number} ist gespeichert.`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(number) })).toContainText("aktiv");
  await expectNoA11yViolations(page);

  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await page.getByRole("button", { name: "Plan bearbeiten" }).click();
  await page.getByRole("textbox", { name: new RegExp(`Plan für ${number}`) }).fill("1.234,50");
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Plan speichern" }).click();
  await expect(page.getByText("Der Plan ist gespeichert.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(number) })).toContainText("1.234,50");
  await expectNoA11yViolations(page);

  await page.goto("/budget/einstellungen");
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
  await expect(page.getByLabel("Beginn des Geschäftsjahrs")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Lesende sehen das Budget, ändern aber nichts", async ({ page }) => {
  await loginAs(page, ["Budget.Reader"], "Lena Lesend");
  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await expect(page.getByText("Plan gesamt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan bearbeiten" })).toHaveCount(0);
  await page.goto("/budget/konten");
  await expect(page.getByRole("heading", { level: 1, name: "Konten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Konto anlegen" })).toHaveCount(0);
  await page.goto("/budget/einstellungen");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();

  const headers = { Origin: ORIGIN };
  const account = { number: "X1", name: "Unerlaubt", kind: "laufend" };
  expect(
    (await page.request.post("/api/budget/accounts", { data: account, headers })).status(),
  ).toBe(403);
  expect(
    (await page.request.put("/api/budget/plans/2026", { data: { entries: [] }, headers })).status(),
  ).toBe(403);
});

test("Ohne Budget-Rolle gibt es den Bereich und die Daten nicht", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");
  await page.goto("/budget");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  for (const path of ["/api/budget/overview", "/api/budget/accounts", "/api/budget/settings"]) {
    expect((await page.request.get(path)).status()).toBe(403);
  }
});
