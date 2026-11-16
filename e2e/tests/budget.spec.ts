import { expect, test } from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

const ORIGIN = new URL(BASE_URL).origin;

test("Budgetverwalter legt ein Konto an und plant es", async ({ page }) => {
  // Eigene Kontonummer je Lauf, damit eine Wiederholung nicht an einem vorhandenen Konto scheitert.
  const number = `T${Date.now() % 100_000_000}`;
  await loginAs(page, ["Budget.Manager"], "Bodo Budget");

  await page.goto("/budget/konten");
  await expect(page.getByRole("heading", { level: 1, name: "Konten" })).toBeVisible();
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByLabel("Kontonummer", { exact: true }).fill(number);
  await page.getByLabel("Bezeichnung", { exact: true }).fill("Testkonto Wartung");
  await page.getByRole("button", { name: "Konto speichern" }).click();
  await expect(page.getByText(`Konto ${number} ist gespeichert.`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(number) })).toContainText("aktiv");
  await expectNoA11yViolations(page);

  await page.goto("/budget/posten");
  await expect(page.getByRole("heading", { level: 1, name: "Budgetposten" })).toBeVisible();
  await page.getByRole("button", { name: "Budgetposten anlegen" }).click();
  await page
    .getByRole("combobox", { name: /^Konto/ })
    .selectOption({ label: `${number} Testkonto Wartung` });
  await page.getByLabel("Bezeichnung", { exact: true }).fill(`Posten ${number}`);
  await page.getByRole("button", { name: "Budgetposten speichern" }).click();
  await expect(page.getByText(`Posten ${number} ist gespeichert.`)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/partner");
  await expect(page.getByRole("heading", { level: 1, name: "Partner" })).toBeVisible();
  await page.getByRole("button", { name: "Partner anlegen" }).click();
  await page.getByLabel("Name der Firma", { exact: true }).fill(`Beispiel Partner ${number}`);
  await page.getByRole("button", { name: "Partner speichern" }).click();
  await expect(page.getByText(`Beispiel Partner ${number} ist gespeichert.`)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/vertraege");
  await expect(page.getByRole("heading", { level: 1, name: "Verträge" })).toBeVisible();
  await page.getByRole("button", { name: "Vertrag anlegen" }).click();
  await page.getByLabel("Bezeichnung", { exact: true }).fill(`Wartung ${number}`);
  await page
    .getByRole("combobox", { name: /^Vertragspartner/ })
    .selectOption({ label: `Beispiel Partner ${number}` });
  await page
    .getByRole("combobox", { name: /^Budgetposten/ })
    .selectOption({ label: `${number} Testkonto Wartung · Posten ${number}` });
  await page.getByRole("textbox", { name: /^Betrag je Zahlung/ }).fill("100,00");
  await expect(page.getByText(/^Brutto je Zahlung: 119,00/)).toBeVisible();
  await page.getByRole("combobox", { name: /^Turnus/ }).selectOption("monatlich");
  await page.getByLabel("Beginn", { exact: true }).fill(`${new Date().getFullYear()}-01-01`);
  await page.getByRole("button", { name: "Vertrag speichern" }).click();
  await expect(page.getByText(`Wartung ${number} ist gespeichert.`)).toBeVisible();
  // Zwölf Monatszahlungen im laufenden Jahr, brutto mit 19 %
  await expect(page.getByRole("row", { name: new RegExp(`Wartung ${number}`) })).toContainText(
    "1.428,00",
  );
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: `Wartung ${number}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Wartung ${number}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vertragsdaten" })).toBeVisible();
  await expect(page.getByText("Läuft unbefristet weiter.")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/rechnungen");
  await expect(page.getByRole("heading", { level: 1, name: "Rechnungen" })).toBeVisible();
  await page.getByRole("button", { name: "Rechnung erfassen" }).click();
  await page
    .getByRole("combobox", { name: /^Rechnungssteller/ })
    .selectOption({ label: `Beispiel Partner ${number}` });
  await page.getByLabel("Rechnungsnummer", { exact: true }).fill(`RE-${number}`);
  await page
    .getByLabel("Rechnungsdatum", { exact: true })
    .fill(`${new Date().getFullYear()}-02-01`);
  await page
    .getByRole("combobox", { name: /^Vertrag/ })
    .selectOption({ label: `Wartung ${number} · Beispiel Partner ${number}` });
  await page.getByRole("textbox", { name: /^Betrag netto/ }).fill("100,00");
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Rechnung speichern" }).click();
  // Der Budgetverwalter bucht beim Erfassen sofort.
  await expect(page.getByText(`Rechnung RE-${number} ist gespeichert und gebucht.`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`RE-${number}`) })).toContainText("119,00");
  await expectNoA11yViolations(page);

  await page.goto("/budget/partner");
  await page.getByRole("link", { name: `Beispiel Partner ${number}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Beispiel Partner ${number}` }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verträge (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rechnungen (1)" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/posten");
  await page.getByRole("button", { name: "Plan bearbeiten" }).click();
  await page
    .getByRole("textbox", { name: new RegExp(`Plan für Posten ${number}`) })
    .fill("1.500,00");
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Plan speichern" }).click();
  await expect(page.getByText("Der Plan ist gespeichert.")).toBeVisible();
  const itemRow = page.getByRole("row", { name: new RegExp(`Posten ${number}`) });
  await expect(itemRow).toContainText("1.500,00");
  await expect(itemRow).toContainText("1.428,00");
  // Gebucht sind 119,00; gebunden bleibt der Rest, die Prognose bleibt gleich.
  await expect(itemRow).toContainText("119,00");
  await expect(itemRow).toContainText("1.309,00");
  await expect(itemRow).toContainText("72,00");
  await expectNoA11yViolations(page);

  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Kündigungstermine – nächste 120 Tage/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Testkonto Wartung: Ist \d+ %, Prognose \d+ % des Plans/ }).first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/einstellungen");
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
  await expect(page.getByLabel("Beginn des Geschäftsjahrs")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Lesende sehen das Budget, ändern aber nichts", async ({ page }) => {
  await loginAs(page, ["Budget.Reader"], "Lena Lesend");
  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await expect(page.getByText(/^Plan Geschäftsjahr/)).toBeVisible();
  await expect(page.getByText(/Nur Lesezugriff/)).toBeVisible();
  await page.goto("/budget/posten");
  await expect(page.getByRole("heading", { level: 1, name: "Budgetposten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan bearbeiten" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Budgetposten anlegen" })).toHaveCount(0);
  await page.goto("/budget/konten");
  await expect(page.getByRole("heading", { level: 1, name: "Konten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Konto anlegen" })).toHaveCount(0);
  for (const [path, title] of [
    ["/budget/vertraege", "Verträge"],
    ["/budget/rechnungen", "Rechnungen"],
    ["/budget/partner", "Partner"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("button", { name: /(anlegen|erfassen)$/ })).toHaveCount(0);
  }
  await page.goto("/budget/einstellungen");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();

  const headers = { Origin: ORIGIN };
  const account = { number: "X1", name: "Unerlaubt", kind: "laufend" };
  expect(
    (await page.request.post("/api/budget/accounts", { data: account, headers })).status(),
  ).toBe(403);
  expect(
    (await page.request.put("/api/budget/plans/2026", { data: { entries: [] }, headers })).status(),
  ).toBe(403);
});

test("Ohne Budget-Rolle gibt es den Bereich und die Daten nicht", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");
  await page.goto("/budget");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  for (const path of [
    "/api/budget/overview",
    "/api/budget/accounts",
    "/api/budget/settings",
    "/api/budget/items",
    "/api/budget/partners",
    "/api/budget/invoices",
    "/api/budget/contracts",
  ]) {
    expect((await page.request.get(path)).status()).toBe(403);
  }
});
