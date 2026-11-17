import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openNavigation } from "./helpers";

test("ohne Anmeldung erscheint die Login-Seite", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Werkbank" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mit Microsoft anmelden" })).toHaveAttribute(
    "href",
    "/auth/login",
  );
  await expectNoA11yViolations(page);
});

test("Admin sieht alle Bereiche", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin", "Config.Reviewer", "Evergreen.IT"]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Guten (Morgen|Tag|Abend), Erika Beispiel$/ })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await openNavigation(page);
  // Audit-Log und Einstellungen stehen im eigenen Bereich „Verwaltung“.
  await expect(nav.getByRole("link", { name: /^Verwaltung/ })).toBeVisible();
  await nav.getByRole("link", { name: /^Microsoft 365/ }).click();
  await openNavigation(page);
  await expect(nav.getByRole("link", { name: "Änderungen" })).toBeVisible();
  await nav.getByRole("link", { name: /^Evergreen/ }).click();
  await openNavigation(page);
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Betriebsrat sieht nur Start und Evergreen", async ({ page }) => {
  await loginAs(page, ["Evergreen.Betriebsrat"], "Karl Rat");
  await page.goto("/");
  await openNavigation(page);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByText("Verwaltung")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: /^Microsoft 365/ })).toHaveCount(0);
  await nav.getByRole("link", { name: /^Evergreen/ }).click();
  await expect(page).toHaveURL(/\/evergreen$/);
  await openNavigation(page);
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toBeVisible();
});

test("Abmelden führt zur Login-Seite", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/");
  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("link", { name: "Mit Microsoft anmelden" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Abmelden" }).first()).toBeVisible();
  // Sitzung endet, während die Seite offen ist.
  await context.clearCookies();
  await openNavigation(page);
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "Änderungen" })
    .click();
  await expect(page.getByText(/Deine Sitzung ist abgelaufen/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Mit Microsoft anmelden" })).toHaveAttribute(
    "href",
    "/auth/login?return_to=%2Fm365%2Faenderungen",
  );
  await expectNoA11yViolations(page);
});
