import { expect, test } from "@playwright/test";
import {
  expectNoA11yViolations,
  isPhone,
  loginAs,
  openHandbook,
} from "./helpers";

test("Handbuch zeigt passende Bereiche, führt zu Themen und ist barrierefrei", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Reader"], "Hanna Handbuch");
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

  await main.getByLabel("Im Handbuch suchen").fill("Nachrichtencenter");
  await main.getByRole("button", { name: "Suchen", exact: true }).click();
  await main.getByRole("link", { name: "Woher die Einträge kommen" }).click();
  await expect(page).toHaveURL(/\/handbuch\/evergreen\/eintraege$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Woher die Einträge kommen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Untermenü: am Computer im Seitenmenü, am Handy im Blatt „Alle Themen“
  let menu;
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Alle Themen" }).click();
    menu = page.getByRole("dialog", { name: "Themen" });
  } else {
    menu = page.getByRole("navigation", { name: "Seiten: Handbuch" });
  }
  await expect(
    menu.getByRole("link", { name: "Woher die Einträge kommen" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("button", { name: /^IT-Budget/ })).toHaveCount(0);
  await menu.getByRole("link", { name: "Was die Ansicht zeigt" }).click();
  await expect(page).toHaveURL(/\/handbuch\/evergreen\/ansicht$/);

  // Themen ohne passende Rolle gibt es nicht
  await page.goto("/handbuch/it-budget");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
});

test("Info-Symbol erklärt einen Begriff, „Hilfe“ führt zum Thema der Seite", async ({
  page,
}) => {
  await loginAs(page, ["Budget.Reader"], "Hanna Handbuch");
  await page.goto("/budget");
  await expect(
    page.getByRole("heading", { level: 1, name: "Übersicht" }),
  ).toBeVisible();
  const info = page.getByRole("button", { name: "Erklärung: Verfügbar" });
  await info.click();
  await expect(info).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText("Geplant minus Ist.", { exact: false }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(info).toHaveAttribute("aria-expanded", "false");

  await info.click();
  await page.getByRole("link", { name: "Mehr im Handbuch ›" }).click();
  await expect(page).toHaveURL(/\/handbuch\/it-budget\/begriffe$/);

  await page.goto("/budget");
  await page.getByRole("link", { name: /^Hilfe/ }).click();
  await expect(page).toHaveURL(/\/handbuch\/it-budget\/uebersicht$/);

  await page.goto("/handbuch/hilfe/begriffe");
  await expect(
    page.getByRole("term").filter({ hasText: "Verfügbar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("term").filter({ hasText: "Steuerbar" }),
  ).toHaveCount(0);
});
