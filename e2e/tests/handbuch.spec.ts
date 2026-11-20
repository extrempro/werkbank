import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openHandbook } from "./helpers";

test("Handbuch zeigt passende Kapitel, führt zu Abschnitten und ist barrierefrei", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Team"], "Hanna Handbuch");
  await page.goto("/");
  await openHandbook(page);
  await expect(page).toHaveURL(/\/handbuch$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Handbuch" }),
  ).toBeVisible();
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: "Evergreen", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "IT-Budget", exact: true }),
  ).toHaveCount(0);
  await expectNoA11yViolations(page);

  await page.getByLabel("Im Handbuch suchen").fill("im Auftrag");
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await page
    .getByRole("link", {
      name: "Beschluss des Betriebsrats im Auftrag erfassen",
    })
    .click();
  await expect(page).toHaveURL(/\/handbuch\/evergreen#im-auftrag$/);
  await expect(
    page.getByRole("heading", {
      name: "Beschluss des Betriebsrats im Auftrag erfassen",
    }),
  ).toBeInViewport();
  await expectNoA11yViolations(page);

  // Kapitel ohne passende Rolle gibt es nicht
  await page.goto("/handbuch/it-budget");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
});
