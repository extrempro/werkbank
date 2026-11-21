import { expect, test } from "@playwright/test";
import {
  expectNoA11yViolations,
  isPhone,
  loginAs,
  openAccountMenu,
} from "./helpers";

test("Handy: Leiste unten, Menü als Blatt mit allen Bereichen", async ({
  page,
}) => {
  test.skip(!isPhone(page), "nur Handy");
  await loginAs(page, ["Evergreen.Reader", "Budget.Reader"], "Mia Mobil");
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Bereiche" })).toBeHidden();
  const bar = page.getByRole("navigation", { name: "Schnellzugriff" });
  const items = [
    bar.getByRole("link", { name: "Start" }),
    bar.getByRole("button", { name: "Suche" }),
    bar.getByRole("link", { name: /^Aufgaben/ }),
    bar.getByRole("button", { name: "Menü" }),
  ];
  for (const item of items) {
    await expect(item).toBeVisible();
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const toggle = bar.getByRole("button", { name: "Menü" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const sheet = page.getByRole("dialog", { name: "Start" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Suche" })).toBeVisible();
  await expectNoA11yViolations(page);

  await sheet.getByRole("button", { name: "Alle Bereiche" }).click();
  const all = page.getByRole("dialog", { name: "Alle Bereiche" });
  await expect(all.getByRole("button", { name: /^IT-Budget/ })).toBeVisible();
  await expect(all.getByRole("link", { name: "Handbuch" })).toBeVisible();
  await all.getByRole("button", { name: /^Evergreen/ }).click();
  const evergreen = page.getByRole("dialog", { name: "Evergreen" });
  await evergreen.getByRole("link", { name: /^Microsoft 365/ }).click();
  await expect(evergreen).toBeHidden();
  await expect(page).toHaveURL(/\/evergreen\/m365$/);
  await expect(page.getByRole("heading", { name: "Vorgänge" })).toBeVisible();

  // Das Blatt zeigt jetzt gleich die Seiten von Evergreen; Esc schließt es.
  await toggle.click();
  await expect(page.getByRole("dialog", { name: "Evergreen" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test("Handy: Logo frei, Kontomenü oben rechts und nichts breiter als der Bildschirm", async ({
  page,
}) => {
  test.skip(!isPhone(page), "nur Handy");
  // Viele Rollen: alle Bereiche und Zähler in der Navigation
  await loginAs(
    page,
    [
      "Werkbank.Admin",
      "Config.Reviewer",
      "Evergreen.Editor",
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
  const bell = await page
    .getByRole("button", { name: /^Benachrichtigungen/ })
    .boundingBox();
  expect(brand).not.toBeNull();
  expect(bell).not.toBeNull();
  expect(brand!.x + brand!.width).toBeLessThanOrEqual(bell!.x);
  const account = page.getByRole("button", {
    name: /^Konto und Einstellungen/,
  });
  const accountBox = (await account.boundingBox())!;
  expect(accountBox.x + accountBox.width).toBeLessThanOrEqual(viewport.width);
  expect(accountBox.height).toBeGreaterThanOrEqual(44);

  const menu = await openAccountMenu(page);
  const logout = menu.getByRole("menuitem", { name: "Abmelden" });
  await expect(logout).toBeVisible();
  const box = (await logout.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
  await expectNoA11yViolations(page);
});
