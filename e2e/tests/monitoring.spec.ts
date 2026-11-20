import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openPage } from "./helpers";

test("IT-Monitoring zeigt den DNS-Abgleich und ist barrierefrei", async ({
  page,
}) => {
  await loginAs(page, ["Monitoring.Reader"], "Mona Monitoring");
  await page.goto("/");
  await openPage(page, "IT-Monitoring", "DNS-Abgleich mit NetBox");
  await expect(page).toHaveURL(/\/monitoring\/dns$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "DNS-Abgleich mit NetBox" }),
  ).toBeVisible();
  await expect(
    page.getByText(/nicht eingerichtet oder ausgeschaltet/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt prüfen" })).toHaveCount(
    0,
  );
  await expectNoA11yViolations(page);
});

test("ohne Rolle gibt es den Bereich nicht", async ({ page }) => {
  await loginAs(page, ["Budget.Reader"], "Bea Budget");
  await page.goto("/monitoring/dns");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/monitoring/dns");
  expect(api.status()).toBe(403);
});
