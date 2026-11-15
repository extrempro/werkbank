import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openNavigation } from "./helpers";

test("Neuigkeiten zeigen die Version, der Hinweis „neu“ verschwindet nach dem Öffnen", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Betriebsrat"], "Nora Neu");
  await page.goto("/");
  await openNavigation(page);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const link = nav.getByRole("link", { name: /Neuigkeiten/ });
  await expect(link).toHaveAccessibleName("Neuigkeiten – neue Version");
  await link.click();
  await expect(page).toHaveURL(/\/neuigkeiten$/);
  await expect(page.getByRole("heading", { level: 1, name: "Neuigkeiten" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Version \d+\.\d+\.\d+$/ }).first()).toBeVisible();
  await expectNoA11yViolations(page);

  await page.reload();
  await openNavigation(page);
  await expect(nav.getByRole("link", { name: "Neuigkeiten", exact: true })).toBeVisible();
});
