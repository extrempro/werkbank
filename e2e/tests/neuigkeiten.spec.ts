import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openAccountMenu } from "./helpers";

test("Neuigkeiten zeigen die Version, der Hinweis „neu“ verschwindet nach dem Öffnen", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Reader"], "Nora Neu");
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /^Konto und Einstellungen/ }),
  ).toHaveAccessibleName(/, neue Version$/);
  const menu = await openAccountMenu(page);
  const link = menu.getByRole("menuitem", { name: /^Release Notes/ });
  await expect(link).toHaveAccessibleName("Release Notes neu");
  await link.click();
  await expect(page).toHaveURL(/\/neuigkeiten$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Neuigkeiten" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { level: 2, name: /^Version \d+\.\d+\.\d+$/ })
      .first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.reload();
  const again = await openAccountMenu(page);
  await expect(
    again.getByRole("menuitem", { name: "Release Notes", exact: true }),
  ).toBeVisible();
});
