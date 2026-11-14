import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

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
  await expect(page.getByRole("heading", { name: "Guten Tag, Erika Beispiel" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  if (await page.getByRole("button", { name: "Menü" }).isVisible()) {
    await page.getByRole("button", { name: "Menü" }).click();
  }
  await expect(nav.getByRole("link", { name: "Änderungen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Audit-Log" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Betriebsrat sieht nur Start und Evergreen", async ({ page }) => {
  await loginAs(page, ["Evergreen.Betriebsrat"], "Karl Rat");
  await page.goto("/");
  if (await page.getByRole("button", { name: "Menü" }).isVisible()) {
    await page.getByRole("button", { name: "Menü" }).click();
  }
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link", { name: "Vorgänge" })).toBeVisible();
  await expect(nav.getByText("M365-Konfiguration")).toHaveCount(0);
  await expect(nav.getByText("Verwaltung")).toHaveCount(0);
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
