import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

const ROLES = ["Werkbank.Admin", "Config.Reviewer", "Evergreen.IT"];

test("Automatisch folgt der Einstellung des Geräts", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await loginAs(page, ROLES, "Dana Dunkel");
  await page.goto("/konto");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dunkel");
  await expect(page.getByRole("radio", { name: "Automatisch" })).toBeChecked();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "hell");
});

test("Dunkel bleibt nach dem Neuladen und ist auf allen Seiten gut lesbar", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await loginAs(page, ROLES, "Dana Dunkel");
  await page.goto("/konto");
  await page.getByRole("radio", { name: "Dunkel" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dunkel");
  await expectNoA11yViolations(page);

  for (const path of ["/m365", "/m365/aenderungen", "/m365/einstellungen", "/evergreen", "/audit"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dunkel");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
  }

  await page.goto("/konto");
  await page.getByRole("radio", { name: "Hell" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "hell");
});
