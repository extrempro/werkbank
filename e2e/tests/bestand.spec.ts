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

test("IT-Bestand: Standorte anlegen und Etage öffnen", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/bestand/standorte");
  await expect(
    page.getByRole("heading", { level: 1, name: "Standorte" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  const levels: [string, string, string | null][] = [
    ["Stadt", `Stadt ${stamp}`, null],
    ["Standort", `Haus ${stamp}`, `Stadt ${stamp}`],
    ["Gebäudeabschnitt", `Bauteil ${stamp}`, `Haus ${stamp}`],
  ];
  for (const [level, name, parent] of levels) {
    await page
      .getByRole("combobox", { name: /^Neu anlegen/ })
      .selectOption({ label: level });
    if (parent) {
      const parentSelect = page.getByRole("combobox", { name: /^Gehört zu/ });
      const value = await parentSelect
        .locator("option", { hasText: parent })
        .getAttribute("value");
      await parentSelect.selectOption(value ?? "");
    }
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Anlegen" }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  }
  await page
    .getByRole("combobox", { name: /^Neu anlegen/ })
    .selectOption({ label: "Etage" });
  const sectionOption = page
    .getByRole("combobox", { name: /^Gehört zu/ })
    .locator("option", { hasText: `Bauteil ${stamp}` });
  const sectionValue = await sectionOption.getAttribute("value");
  await page
    .getByRole("combobox", { name: /^Gehört zu/ })
    .selectOption(sectionValue ?? "");
  await page.getByLabel("Name", { exact: true }).fill(`Etage ${stamp}`);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/standorte\/etage\/\d+$/);
  await expect(
    page.getByRole("heading", { level: 2, name: `Etage ${stamp}` }),
  ).toBeVisible();
  await expect(page.getByText("Noch kein Grundriss")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Stelle und Arbeitsplatz anlegen", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");

  // Abteilung in den Stammdaten
  await page.goto("/bestand/stammdaten");
  await page.getByRole("button", { name: "Abteilungen" }).click();
  await page.getByLabel("Neue Abteilung").fill(`Abteilung ${stamp}`);
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText(`Abteilung ${stamp}`)).toBeVisible();
  await expectNoA11yViolations(page);

  // Stelle ohne Person
  await page.goto("/bestand/stellen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Stellen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stelle anlegen" }).click();
  await page.getByLabel("Bezeichnung", { exact: true }).fill(`Stelle ${stamp}`);
  await page
    .getByRole("combobox", { name: /^Abteilung/ })
    .selectOption({ label: `Abteilung ${stamp}` });
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Stelle anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/stellen\/\d+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: `Stelle ${stamp}` }),
  ).toBeVisible();
  await expect(
    page.getByText("Unbesetzt", { exact: false }).first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Arbeitsplatz mit der Stelle
  await page.goto("/bestand/arbeitsplaetze");
  await expect(
    page.getByRole("heading", { level: 1, name: "Arbeitsplätze" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  await page.getByLabel("Bezeichnung (freiwillig)").fill(`Platz ${stamp}`);
  const add = page.getByRole("combobox", { name: /^Stelle hinzufügen/ });
  const value = await add
    .locator("option", { hasText: `Stelle ${stamp}` })
    .getAttribute("value");
  await add.selectOption(value ?? "");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/arbeitsplaetze\/\d+$/);
  await expect(
    page.getByRole("link", { name: new RegExp(`Stelle ${stamp}`) }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: "Ausstattung", exact: true }).click();
  await expect(page.getByText(/Keine Vorlage gewählt/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Vorgänge und Technik ohne NinjaOne", async ({ page }) => {
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/bestand/vorgaenge");
  await expect(
    page.getByRole("heading", { level: 1, name: "Vorgänge" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Der Abgleich mit NinjaOne ist ausgeschaltet/),
  ).toBeVisible();
  await expect(page.getByText("Wähle links einen Vorgang.")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Verleih ansehen und neuen Verleih öffnen", async ({
  page,
}) => {
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/bestand/verleih");
  await expect(
    page.getByRole("heading", { level: 1, name: "Verleih" }),
  ).toBeVisible();
  await expect(page.getByText("Wähle links einen Verleih.")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Neuer Verleih" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Neuer Verleih" }),
  ).toBeVisible();
  await expect(page.getByLabel("Rückgabe bis")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Statistik", async ({ page }) => {
  await loginAs(page, ["Bestand.Reader"], "Lena Leser");
  await page.goto("/bestand/statistik");
  await expect(
    page.getByRole("heading", { level: 1, name: "Statistik" }),
  ).toBeVisible();
  await expect(page.getByLabel("Hersteller")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verleih" })).toBeVisible();
  await expectNoA11yViolations(page);
});
