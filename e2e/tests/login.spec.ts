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
      name: /^Guten (Morgen|Tag|Abend), Erika Beispiel$/,
    }),
  ).toBeVisible();
  // Audit-Log und Einstellungen stehen im eigenen Bereich „Verwaltung“.
  expect(await areaNames(page)).toContain("Verwaltung");
  await openPage(page, "Microsoft 365", "Änderungen");
  await expect(page).toHaveURL(/\/m365\/aenderungen$/);
  await openPage(page, "Evergreen", "Microsoft 365");
  await expect(page).toHaveURL(/\/evergreen\/m365$/);
  await expectNoA11yViolations(page);
});

test("Evergreen-Leser sehen nur Start und Evergreen", async ({ page }) => {
  await loginAs(page, ["Evergreen.Reader"], "Karl Rat");
  await page.goto("/");
  expect(await areaNames(page)).toEqual(["Start", "Evergreen"]);
  await openPage(page, "Evergreen", "Microsoft 365");
  await expect(page).toHaveURL(/\/evergreen\/m365$/);
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
