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
    .getByRole("link", { name: /^Microsoft 365/ })
    .click();
  await expect(page.getByRole("heading", { name: "Vorgänge" })).toBeVisible();
  await expect(page).toHaveURL(/\/evergreen$/);
});
