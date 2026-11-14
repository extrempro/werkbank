import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

test("Konto zeigt Angaben, Rollen, Sitzung, Darstellung und Version", async ({ page }) => {
  await loginAs(page, ["Evergreen.Betriebsrat"], "Kira Konto");
  await page.goto("/");
  await page.getByRole("link", { name: /Kira Konto/ }).click();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible();
  await expect(page.getByText("Evergreen Betriebsrat")).toBeVisible();
  await expect(page.getByText("Stellungnahme zu vorgelegten Vorgängen")).toBeVisible();
  await expect(page.getByText("Läuft spätestens ab")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Automatisch" })).toBeChecked();
  await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: "Neuigkeiten ansehen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Neuigkeiten" })).toBeVisible();
});

test("Profilbilder gibt es nur mit Anmeldung", async ({ page }) => {
  const anonymous = await page.request.get(
    "/api/users/00000000-0000-0000-0000-000000000000/avatar",
  );
  expect(anonymous.status()).toBe(401);
  await loginAs(page, ["Evergreen.Team"], "Kira Konto");
  const missing = await page.request.get("/api/users/00000000-0000-0000-0000-000000000000/avatar");
  expect(missing.status()).toBe(404);
});
