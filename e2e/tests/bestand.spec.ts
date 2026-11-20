import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openNavigation } from "./helpers";

test("IT-Bestand: Gerät erfassen, Inventurnummer setzen, ausmustern", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const name = `Monitor ${stamp}`;
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/");
  await openNavigation(page);
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "IT-Bestand" })
    .click();
  await expect(page).toHaveURL(/\/bestand\/hardware$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Hardware" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Erfassen mit Inventurnummer: erst nach der Rückfrage
  await page.getByRole("button", { name: "Gerät erfassen" }).click();
  await page.getByLabel("Bezeichnung", { exact: true }).fill(name);
  await page
    .getByRole("combobox", { name: /^Art/ })
    .selectOption({ label: "Monitor" });
  await page.getByLabel("Seriennummer", { exact: true }).fill(`SN-${stamp}`);
  await page.getByLabel("Inventurnummer (freiwillig)").fill(`INV-${stamp}`);
  await page.getByRole("button", { name: "Gerät anlegen" }).click();
  await expect(page.getByText(/für dieses Gerät eintragen/)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Ja, Gerät anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/hardware\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(`INV-${stamp}`)).toBeVisible();
  await expectNoA11yViolations(page);

  // Ausmustern
  await page.getByRole("button", { name: "Ausmustern" }).click();
  await page
    .getByRole("combobox", { name: /^Grund/ })
    .selectOption({ label: "defekt" });
  await page
    .getByRole("combobox", { name: /^Verbleib/ })
    .selectOption({ label: "entsorgt" });
  await page.getByRole("button", { name: "Weiter" }).click();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Ja, ausmustern" }).click();
  await expect(
    page.getByRole("heading", { name: "Ausgemustert" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Verlauf
  await page.getByRole("link", { name: "Verlauf", exact: true }).click();
  await expect(page.getByText(/^Ausgemustert am/)).toBeVisible();
  await expect(page.getByText("Von Hand erfasst")).toBeVisible();
  await expectNoA11yViolations(page);

  // Liste: unter „Ausgemustert“ zu finden
  await page.goto("/bestand/hardware");
  await page.getByRole("button", { name: "Ausgemustert" }).click();
  await page.getByLabel("Geräte durchsuchen").fill(stamp);
  await expect(page.getByRole("link", { name })).toBeVisible();
  await expectNoA11yViolations(page);

  // Stammdaten
  await page.goto("/bestand/stammdaten");
  await expect(
    page.getByRole("heading", { level: 1, name: "Stammdaten" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Lesende ändern nichts, ohne Rolle gibt es den Bereich nicht", async ({
  page,
}) => {
  await loginAs(page, ["Bestand.Reader"], "Lisa Lesen");
  await page.goto("/bestand/hardware");
  await expect(
    page.getByRole("heading", { level: 1, name: "Hardware" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Gerät erfassen" }),
  ).toHaveCount(0);
  await expectNoA11yViolations(page);

  await loginAs(page, ["Budget.Reader"], "Bea Budget");
  await page.goto("/bestand/hardware");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/inventory/hardware");
  expect(api.status()).toBe(403);
});
