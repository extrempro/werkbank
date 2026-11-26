import { expect, test } from "@playwright/test";
import {
  areaNames,
  expectNoA11yViolations,
  itemName,
  loginAs,
  openAccountMenu,
  openMenu,
  openPage,
} from "./helpers";

test("ohne Anmeldung erscheint die Login-Seite", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Werkbank" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Mit Microsoft anmelden" }),
  ).toHaveAttribute("href", "/auth/login");
  await expectNoA11yViolations(page);
});

test("Admin sieht alle Bereiche", async ({ page }) => {
  await loginAs(page, [
    "Werkbank.Admin",
    "Config.Reviewer",
    "Evergreen.Editor",
  ]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /^(Guten Morgen|Hallo|Guten Abend), Erika$/,
    }),
  ).toBeVisible();
  // Audit-Log und Einstellungen stehen in der Verwaltung, erreichbar über das Kontomenü.
  expect(await areaNames(page)).not.toContain("Verwaltung");
  const account = await openAccountMenu(page);
  await expect(
    account.getByRole("menuitem", { name: "Verwaltung" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await openPage(page, "Microsoft 365", "Änderungen");
  await expect(page).toHaveURL(/\/m365\/aenderungen$/);
  await openPage(page, "Microsoft 365", "Nachrichtencenter");
  await expect(page).toHaveURL(/\/m365\/neuerungen$/);
  await expectNoA11yViolations(page);
});

test("Evergreen-Leser sehen nur Start und die Neuerungen unter Microsoft 365", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Reader"], "Karl Rat");
  await page.goto("/");
  expect(await areaNames(page)).toEqual(["Start", "Microsoft 365"]);
  await openPage(page, "Microsoft 365", "Nachrichtencenter");
  await expect(page).toHaveURL(/\/m365\/neuerungen$/);
});

test("Abmelden führt zur Login-Seite", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/");
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Abmelden" }).click();
  await expect(
    page.getByRole("link", { name: "Mit Microsoft anmelden" }),
  ).toBeVisible();
});

test("API ist ohne Anmeldung gesperrt", async ({ request }) => {
  const response = await request.get("/api/me");
  expect(response.status()).toBe(401);
});

test("Abgelaufene Sitzung: Die Anmeldeseite erscheint mit Hinweis und Rückweg", async ({
  page,
  context,
}) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/m365/snapshots");
  await expect(
    page.getByRole("button", { name: /^Benachrichtigungen/ }),
  ).toBeVisible();
  // Sitzung endet, während die Seite offen ist.
  await context.clearCookies();
  const menu = await openMenu(page);
  await menu.getByRole("link", { name: itemName("Änderungen") }).click();
  await expect(page.getByText(/Deine Sitzung ist abgelaufen/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Mit Microsoft anmelden" }),
  ).toHaveAttribute("href", "/auth/login?return_to=%2Fm365%2Faenderungen");
  await expectNoA11yViolations(page);
});
