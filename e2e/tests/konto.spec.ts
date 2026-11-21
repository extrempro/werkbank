import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openAccountMenu, confirmDialog } from "./helpers";

test("Konto zeigt Angaben, Rollen, Geräte, Darstellung und Version", async ({ page }) => {
  await loginAs(page, ["Evergreen.Reader"], "Kira Konto");
  await page.goto("/");
  const menu = await openAccountMenu(page);
  await expect(page.getByRole("button", { name: /Kira Konto/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Konto" }).click();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible();
  await expect(page.getByText("Evergreen Leser")).toBeVisible();
  await expect(page.getByText("Evergreen-Einträge mit Bewertung und Notizen ansehen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Angemeldete Geräte" })).toBeVisible();
  await expect(page.getByText("Dieses Gerät")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Automatisch" })).toBeChecked();
  await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: "Neuigkeiten ansehen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Neuigkeiten" })).toBeVisible();
});

test("Auf allen anderen Geräten abmelden", async ({ page, browser }) => {
  // Eigener Name je Lauf, damit Sitzungen früherer Läufe nicht mitzählen.
  const name = `Gerd Geräte ${Date.now() % 100_000_000}`;
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await loginAs(otherPage, ["Evergreen.Reader"], name);
  await loginAs(page, ["Evergreen.Reader"], name);
  await page.goto("/konto");
  const list = page.getByRole("list", { name: "Angemeldete Geräte" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Auf allen anderen Geräten abmelden" }).click();
  await confirmDialog(page, "Abmelden", true);
  await expect(page.getByText("1 anderes Gerät ist abgemeldet.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect((await otherPage.request.get("/api/me")).status()).toBe(401);
  expect((await page.request.get("/api/me")).status()).toBe(200);
  await other.close();
});

test("Profilbilder gibt es nur mit Anmeldung", async ({ page }) => {
  const anonymous = await page.request.get(
    "/api/users/00000000-0000-0000-0000-000000000000/avatar",
  );
  expect(anonymous.status()).toBe(401);
  await loginAs(page, ["Evergreen.Reader"], "Kira Konto");
  const missing = await page.request.get("/api/users/00000000-0000-0000-0000-000000000000/avatar");
  expect(missing.status()).toBe(404);
});
