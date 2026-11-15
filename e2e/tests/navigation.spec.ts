import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openNavigation } from "./helpers";

test("Navigation lässt sich einklappen und merkt sich das", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "handy", "Auf dem Handy ist die Navigation ein Menü");
  await loginAs(page, ["Werkbank.Admin", "Config.Reviewer", "Evergreen.IT"], "Nina Navi");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const wide = (await nav.boundingBox())?.width ?? 0;
  await nav.getByRole("button", { name: "Navigation einklappen" }).click();
  const toggle = nav.getByRole("button", { name: "Navigation ausklappen" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const narrow = (await nav.boundingBox())?.width ?? 0;
  expect(narrow).toBeLessThan(wide / 2);

  // Eingeklappt bleiben die Einträge bedienbar und behalten ihren Namen.
  await expectNoA11yViolations(page);
  await nav.getByRole("link", { name: "Vorgänge" }).click();
  await expect(page).toHaveURL(/\/evergreen$/);

  await page.reload();
  await expect(nav.getByRole("button", { name: "Navigation ausklappen" })).toBeVisible();
  await nav.getByRole("button", { name: "Navigation ausklappen" }).click();
  await expect(nav.getByRole("button", { name: "Navigation einklappen" })).toBeVisible();
});

test("Umschalter in der Navigation wechselt zwischen hell und dunkel", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await loginAs(page, ["Evergreen.Betriebsrat"], "Nina Navi");
  await page.goto("/");
  await openNavigation(page);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await nav.getByRole("button", { name: "Dunkle Darstellung einschalten" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dunkel");
  await nav.getByRole("button", { name: "Helle Darstellung einschalten" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "hell");
  await expect(nav.getByRole("link", { name: "Neuigkeiten" })).toHaveCount(1);
});
