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
  await nav.getByRole("link", { name: "Microsoft 365" }).click();
  await expect(page).toHaveURL(/\/m365$/);
  await nav.getByRole("link", { name: "Evergreen" }).click();
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

test("Bereiche: Die Navigation zeigt nur die Seiten des gewählten Bereichs", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin", "Config.Reviewer", "Evergreen.IT"], "Nina Navi");
  await page.goto("/");
  await openNavigation(page);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const general = nav.getByRole("link", { name: "Werkbank", exact: true });
  const m365 = nav.getByRole("link", { name: /^Microsoft 365/ });
  await expect(general).toHaveAttribute("aria-current", "true");
  await expect(nav.getByRole("link", { name: "Suche", exact: true })).toBeVisible();
  // Audit-Log und Einstellungen stehen im eigenen Bereich „Verwaltung“.
  await expect(nav.getByRole("link", { name: "Audit-Log" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Änderungen" })).toHaveCount(0);

  await m365.click();
  await expect(page).toHaveURL(/\/m365$/);
  await openNavigation(page);
  await expect(m365).toHaveAttribute("aria-current", "true");
  await expect(nav.getByRole("link", { name: "Änderungen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Audit-Log" })).toHaveCount(0);
  await expectNoA11yViolations(page);

  // Eine Seite des Bereichs direkt aufrufen: Der Bereich ist gleich der richtige.
  await page.goto("/evergreen");
  await openNavigation(page);
  await expect(nav.getByRole("link", { name: /^Evergreen/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toBeVisible();
  await general.click();
  await expect(page).toHaveURL(/\/$/);
});
