import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

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

test("Handy: Logo frei, „Abmelden“ im Menü und nichts breiter als der Bildschirm", async ({
  page,
}, testInfo) => {
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
      "Bestand.Editor",
    ],
    "Maximiliane Mustermann-Beispiel",
  );
  await page.goto("/");
  const viewport = page.viewportSize()!;
  // Das Logo liegt ganz links von der Glocke, nichts schiebt sich darüber.
  const brand = await page.locator(".app-header .brand-mark").boundingBox();
  const bell = await page.getByRole("button", { name: /^Benachrichtigungen/ }).boundingBox();
  expect(brand).not.toBeNull();
  expect(bell).not.toBeNull();
  expect(brand!.x + brand!.width).toBeLessThanOrEqual(bell!.x);
  // In der Kopfzeile gibt es kein „Abmelden“ ...
  await expect(page.getByRole("button", { name: "Abmelden" })).toHaveCount(0);

  // ... dafür im Menü.
  const toggle = page.getByRole("button", { name: "Menü" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const logout = page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: "Abmelden" });
  await expect(logout).toBeVisible();
  const box = await logout.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
  await expectNoA11yViolations(page);
});
