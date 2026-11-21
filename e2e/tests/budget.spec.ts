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

  // Tags pflegt der Budgetverwalter in den Einstellungen.
  await page.goto("/budget/einstellungen");
  await page.getByLabel("Neuer Tag", { exact: true }).fill(`Tag ${number}`);
  await page.getByRole("button", { name: "Tag anlegen" }).click();
  await expect(page.getByText(`Der Tag „Tag ${number}“ ist angelegt.`)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/partner");
  await expect(page.getByRole("heading", { level: 1, name: "Partner" })).toBeVisible();
  await page.getByRole("button", { name: "Partner anlegen" }).click();
  await page.getByLabel("Name der Firma", { exact: true }).fill(`Beispiel Partner ${number}`);
  await page.getByRole("button", { name: "Partner speichern" }).click();
  await expect(page.getByText(`Beispiel Partner ${number} ist gespeichert.`)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/posten");
  await expect(page.getByRole("heading", { level: 1, name: "Budgetposten" })).toBeVisible();
  await page.getByRole("button", { name: "Posten hinzufügen" }).click();
  await page
    .getByRole("combobox", { name: /^Konto/ })
    .selectOption({ label: `${number} Testkonto Wartung` });
  await page.getByLabel("Bezeichnung", { exact: true }).fill(`Posten ${number}`);
  // Der Partner ist am Budgetposten Pflicht.
  await page
    .getByRole("combobox", { name: /^Partner/ })
    .selectOption({ label: `Beispiel Partner ${number}` });
  await page.getByRole("textbox", { name: /^Erwartete Kosten/ }).fill("1.500,00");
  // Tags stehen sichtbar im Formular.
  await page
    .getByRole("group", { name: "Tags (freiwillig)" })
    .getByRole("button", { name: `Tag ${number}`, exact: true })
    .click();
  // Das Formular ist länger; nach dem Scrollen läge „Posten hinzufügen“ unter der festen Kopfzeile.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Posten speichern" }).click();
  await expect(page.getByText(`Posten ${number} ist gespeichert.`)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);
  // Abhaken und wieder öffnen, ohne Rechnung
  await page.getByRole("button", { name: `Posten ${number} abschließen` }).click();
  await expect(
    page.getByText(new RegExp(`Posten ${number} ist im .* abgeschlossen\\.`)),
  ).toBeVisible();
  await page.getByRole("button", { name: `Posten ${number} wieder öffnen` }).click();
  await expect(page.getByText(`Posten ${number} ist wieder offen.`)).toBeVisible();

  await page.goto("/budget/vertraege");
  await expect(page.getByRole("heading", { level: 1, name: "Verträge" })).toBeVisible();
  await page.getByRole("button", { name: "Vertrag anlegen" }).click();
  await page.getByLabel("Bezeichnung", { exact: true }).fill(`Wartung ${number}`);
  await page
    .getByRole("combobox", { name: /^Vertragspartner/ })
    .selectOption({ label: `Beispiel Partner ${number}` });
  // Ein Vertrag lässt sich mehreren Posten zuordnen; hier einem.
  await page.getByRole("searchbox", { name: "Budgetposten suchen" }).fill(`Posten ${number}`);
  await page.getByLabel(`${number} · Posten ${number}`, { exact: true }).check();
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
  // Die Position hängt am Budgetposten; den Vertrag gibt der Posten vor.
  await page.getByRole("searchbox", { name: "Budgetposten suchen" }).fill(`Posten ${number}`);
  await page.getByRole("combobox", { name: /^Budgetposten/ }).selectOption({ index: 1 });
  await expect(page.getByText(`Vertrag des Postens: Wartung ${number}`)).toBeVisible();
  await page.getByRole("textbox", { name: /^Betrag netto/ }).fill("100,00");
  // Hat der Posten einen Vertrag, schließt die Position ihn nicht ab.
  await expect(page.getByLabel("Schließt den Budgetposten ab")).not.toBeChecked();
  // Zweite Position mit anderem Steuersatz auf denselben Budgetposten.
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const second = page.getByRole("group", { name: "Position 2" });
  await second.getByRole("searchbox", { name: "Budgetposten suchen" }).fill(`Posten ${number}`);
  await second.getByRole("combobox", { name: /^Budgetposten/ }).selectOption({ index: 1 });
  await second.getByRole("textbox", { name: /^Betrag netto/ }).fill("50,00");
  await second.getByRole("textbox", { name: /^Steuersatz/ }).fill("7");
  await expect(second.getByLabel("Schließt den Budgetposten ab")).not.toBeChecked();
  await page.getByRole("textbox", { name: /^Rechnungsbetrag laut Beleg/ }).fill("170,00");
  await page.getByRole("button", { name: "Rechnung speichern" }).click();
  await expect(page.getByRole("alert")).toContainText("mehr als der Rechnungsbetrag");
  await page.getByRole("textbox", { name: /^Rechnungsbetrag laut Beleg/ }).fill("172,50");
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Rechnung speichern" }).click();
  // Der Budgetverwalter bucht beim Erfassen sofort.
  await expect(page.getByText(`Rechnung RE-${number} ist gespeichert und gebucht.`)).toBeVisible();
  const invoiceRow = page.getByRole("row", { name: new RegExp(`RE-${number}`) });
  await expect(invoiceRow).toContainText("119,00");
  await expect(invoiceRow).toContainText("53,50");
  await expect(invoiceRow).toContainText("172,50");

  // Beleg hochladen: eine kleine PDF-Datei aus dem Speicher, dann wieder herunterladen.
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
  await page
    .getByLabel(`Beleg zu Rechnung RE-${number} hochladen (PDF)`)
    .setInputFiles({ name: "Rechnung Test.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(`Der Beleg zu RE-${number} ist gespeichert.`)).toBeVisible();
  const beleg = page
    .getByRole("row", { name: new RegExp(`RE-${number}`) })
    .getByRole("link", { name: "Rechnung Test.pdf" });
  await expect(beleg).toBeVisible();
  const download = await page.request.get((await beleg.getAttribute("href")) ?? "");
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect((await download.body()).equals(pdf)).toBe(true);
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
  const itemRow = page.getByRole("row", { name: new RegExp(`Posten ${number}`) });
  // Rechnung da, aber nichts schließt ab: erwartet 1.500,00, gebucht 172,50. Die Prognose
  // ist das Höhere aus Erwartung und Ist, also 1.500,00.
  await expect(itemRow).toContainText("Rechnung liegt vor");
  await expect(itemRow).toContainText("1.500,00");
  await expect(itemRow).toContainText("172,50");
  await expectNoA11yViolations(page);

  // Tags: in der Liste filtern, dann über fünf Jahre auswerten und die Auswahl speichern.
  await page.getByRole("button", { name: `Nach Tag Tag ${number} filtern` }).click();
  await expect(page.getByText(/^1 von \d+ Budgetposten$/)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("link", { name: `Statistik zu „Tag ${number}“` }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Statistik" })).toBeVisible();
  const yearRow = page
    .getByRole("region", { name: "Erwartet und Ist je Geschäftsjahr" })
    .getByRole("row", { name: new RegExp(`^${new Date().getFullYear()}`) });
  await expect(yearRow).toContainText("1.500,00");
  await expect(yearRow).toContainText("172,50");
  await expect(page.getByRole("img", { name: /^Erwartet und Ist je Geschäftsjahr/ })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Budgetposten der Auswahl" }).getByRole("row", {
      name: new RegExp(`Posten ${number}`),
    }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByLabel("Auswahl speichern unter", { exact: true }).fill(`Statistik ${number}`);
  await page.getByRole("button", { name: "Statistik speichern" }).click();
  await expect(page.getByText(`Die Statistik „Statistik ${number}“ ist gespeichert.`)).toBeVisible();
  await expect(page.getByRole("button", { name: `Statistik ${number}`, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Nach dem Speichern steht die Seite unten; oben kommen die gespeicherten Statistiken dazu.
  // Ohne Zurückscrollen lägen deren Knöpfe teils unter der festen Kopfzeile, und axe meldet sie
  // als verdeckt. Geprüft wird daher von oben.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);

  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Kündigungstermine – nächste 120 Tage/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Testkonto Wartung: Ist \d+ %, Prognose \d+ % der Erwartung/ }).first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/budget/planung");
  await expect(page.getByRole("heading", { level: 1, name: "Mehrjahresübersicht" })).toBeVisible();
  const planRow = page.getByRole("row", { name: new RegExp(`^Posten ${number}`) });
  await expect(planRow).toContainText("Rechnung liegt vor");
  await expect(planRow).toContainText("Ist 172,50");
  await expectNoA11yViolations(page);
  const excel = await page.request.get(
    (await page.getByRole("link", { name: "Als Excel-Datei herunterladen" }).getAttribute("href")) ??
      "",
  );
  expect(excel.status()).toBe(200);
  expect(excel.headers()["content-type"]).toContain("spreadsheetml");
  // Eine xlsx-Datei ist ein ZIP-Archiv.
  expect((await excel.body()).subarray(0, 2).toString()).toBe("PK");

  await page.goto("/budget/einstellungen");
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
  await expect(page.getByLabel("Beginn des Geschäftsjahrs")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Lesende sehen das Budget, ändern aber nichts", async ({ page }) => {
  await loginAs(page, ["Budget.Reader"], "Lena Lesend");
  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await expect(page.getByText(/^Erwartet Geschäftsjahr/)).toBeVisible();
  await expect(page.getByText(/Nur Lesezugriff/)).toBeVisible();
  await page.goto("/budget/posten");
  await expect(page.getByRole("heading", { level: 1, name: "Budgetposten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Posten hinzufügen" })).toHaveCount(0);
  await page.goto("/budget/konten");
  await expect(page.getByRole("heading", { level: 1, name: "Konten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Konto anlegen" })).toHaveCount(0);
  for (const [path, title] of [
    ["/budget/vertraege", "Verträge"],
    ["/budget/rechnungen", "Rechnungen"],
    ["/budget/planung", "Mehrjahresübersicht"],
    ["/budget/statistik", "Statistik"],
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
  const item = { account_id: 1, name: "Unerlaubt", amount_cents: 1 };
  expect((await page.request.post("/api/budget/items", { data: item, headers })).status()).toBe(
    403,
  );
  const statistic = { name: "Unerlaubt", tags: ["Cloud"], mode: "any" };
  expect(
    (await page.request.post("/api/budget/statistics", { data: statistic, headers })).status(),
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
    "/api/budget/planning",
    "/api/budget/export",
    "/api/budget/tags",
    "/api/budget/statistics",
    "/api/budget/contracts",
  ]) {
    expect((await page.request.get(path)).status()).toBe(403);
  }
});
