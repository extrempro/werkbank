import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("Handy: Navigation über den Menü-Button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "handy", "nur Handy");
  await loginAs(page, ["Evergreen.Team"], "Mia Mobil");
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Menü" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: /^Evergreen/ })
    .click();
  await expect(page.getByRole("heading", { name: "Vorgänge" })).toBeVisible();
  await expect(page).toHaveURL(/\/evergreen$/);
});

test("Handy: Mit offenem Menü bleibt „Abmelden“ ganz sichtbar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "handy", "nur Handy");
  // Viele Rollen: alle Bereiche und Zähler in der Navigation
  await loginAs(
    page,
    [
      "Werkbank.Admin",
      "Config.Reviewer",
      "Evergreen.IT",
      "Budget.Manager",
      "Tools.User",
      "Monitoring.Reader",
      "Projekte.Editor",
    ],
    "Maximiliane Mustermann-Beispiel",
  );
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Menü" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const viewport = page.viewportSize()!;
  const logout = await page.getByRole("button", { name: "Abmelden" }).boundingBox();
  expect(logout).not.toBeNull();
  expect(logout!.x).toBeGreaterThanOrEqual(0);
  expect(logout!.x + logout!.width).toBeLessThanOrEqual(viewport.width);
  // Nichts in der Navigation macht die Seite breiter als den Bildschirm.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
});
