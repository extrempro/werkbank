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
  await expect(nav.getByRole("link", { name: "Audit-Log" })).toBeVisible();
  await nav.getByRole("link", { name: /^Microsoft 365/ }).click();
  await openNavigation(page);
  await expect(nav.getByRole("link", { name: "Änderungen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Betriebsrat sieht nur Start und Evergreen", async ({ page }) => {
  await loginAs(page, ["Evergreen.Betriebsrat"], "Karl Rat");
  await page.goto("/");
  await openNavigation(page);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByText("Verwaltung")).toHaveCount(0);
  await nav.getByRole("link", { name: /^Microsoft 365/ }).click();
  await expect(page).toHaveURL(/\/evergreen$/);
  await openNavigation(page);
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toBeVisible();
  await expect(nav.getByText("Konfiguration")).toHaveCount(0);
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
