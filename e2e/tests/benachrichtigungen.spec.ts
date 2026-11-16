import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

test("Glocke öffnet die Benachrichtigungen, Arten lassen sich ausschalten", async ({
  page,
}, testInfo) => {
  // Eigene Person je Gerät und Versuch: Die Einstellung wird gespeichert und gilt überall.
  await loginAs(
    page,
    ["Budget.Manager"],
    `Gerda Glocke ${testInfo.project.name} ${testInfo.retry}`,
  );
  await page.goto("/");
  const bell = page.getByRole("button", { name: /^Benachrichtigungen/ });
  await expect(bell).toHaveAttribute("aria-expanded", "false");
  await bell.click();
  await expect(bell).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("region", { name: "Benachrichtigungen" });
  await expect(panel).toBeVisible();
  await expectNoA11yViolations(page);

  // Escape schließt und gibt den Fokus an die Glocke zurück
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();

  await bell.click();
  await panel.getByRole("link", { name: "Alle anzeigen" }).click();
  await expect(page).toHaveURL(/\/benachrichtigungen$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Benachrichtigungen" }),
  ).toBeVisible();
  await expect(panel).toBeHidden();

  await expectNoA11yViolations(page);

  // Eingestellt wird im Konto
  await page.getByRole("link", { name: "Konto", exact: true }).click();
  await expect(page).toHaveURL(/\/konto$/);
  const bellBox = page.getByRole("checkbox", {
    name: "Rechnung wartet auf Prüfung: Glocke",
  });
  const mailBox = page.getByRole("checkbox", {
    name: "Rechnung wartet auf Prüfung: Mail",
  });
  await expect(bellBox).toBeChecked();
  // Ohne eingerichteten Mailversand lässt sich Mail nicht einschalten
  await expect(mailBox).not.toBeChecked();
  await expect(mailBox).toBeDisabled();
  // Arten anderer Rollen stehen nicht zur Wahl
  await expect(
    page.getByRole("checkbox", {
      name: /Störung eines Microsoft-365-Dienstes/,
    }),
  ).toHaveCount(0);
  await bellBox.uncheck();
  await expect(
    page.getByRole("status").filter({ hasText: "Gespeichert." }),
  ).toBeVisible();
  await expect(bellBox).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Rechnung wartet auf Prüfung: Glocke" }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: "Rechnung wartet auf Prüfung: Glocke" })
    .check();
  await expect(
    page.getByRole("status").filter({ hasText: "Gespeichert." }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Benachrichtigungen gibt es nur mit Anmeldung", async ({ page }) => {
  const anonymous = await page.request.get("/api/notifications");
  expect(anonymous.status()).toBe(401);
});
