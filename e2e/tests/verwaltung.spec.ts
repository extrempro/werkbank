import { expect, test } from "@playwright/test";
import {
  BASE_URL,
  expectNoA11yViolations,
  itemName,
  loginAs,
  openMenu,
  openPage,
  confirmDialog,
} from "./helpers";

test("Admin sieht das Audit-Log mit der eigenen Anmeldung", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/audit");
  await expect(
    page.getByRole("heading", { level: 1, name: "Audit-Log" }),
  ).toBeVisible();
  await expect(page.getByText("anmeldung.erfolgreich").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Als CSV exportieren" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Audit-Log lässt sich nach Modul filtern", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/audit");
  await page.getByLabel("Modul").selectOption("kern");
  await page.getByLabel("Aktion enthält").fill("anmeldung");
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page.getByText("anmeldung.erfolgreich").first()).toBeVisible();

  await page.getByLabel("Aktion enthält").fill("gibt-es-nicht");
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(
    page.getByText("Keine Einträge für diese Auswahl."),
  ).toBeVisible();
});

test("Admin sieht die Rollen in der Verwaltung", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung/rollen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Rollen" }),
  ).toBeVisible();
  await expect(
    page.getByText("Evergreen Leser", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /Ada Admin/ }).first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Admin pflegt SMTP-Server und Aufbewahrungsfrist, das Passwort bleibt verborgen", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung/mail-teams");
  await expect(
    page.getByRole("heading", { level: 1, name: "Mail & Teams" }),
  ).toBeVisible();
  await page.getByLabel("Server", { exact: true }).fill("smtp.example.com");
  await page.getByLabel("Port", { exact: true }).fill("587");
  await page
    .getByLabel("Absenderadresse", { exact: true })
    .fill("werkbank@example.com");
  await page
    .getByLabel("Benutzername (freiwillig)")
    .fill("werkbank@example.com");
  // Beim ersten Durchlauf heißt das Feld „Passwort (freiwillig)“, danach „Neues Passwort“.
  await page
    .getByLabel(/^(Neues Passwort|Passwort \(freiwillig\))$/)
    .fill("e2e-geheim-4711");
  await page.getByRole("button", { name: "SMTP-Server speichern" }).click();
  await expect(
    page.getByText("Der SMTP-Server ist gespeichert."),
  ).toBeVisible();
  await expect(page.getByLabel("Neues Passwort")).toHaveValue("");
  await expectNoA11yViolations(page);

  const stored = await page.request.get("/api/admin/settings");
  expect(stored.status()).toBe(200);
  const text = await stored.text();
  expect(text).not.toContain("e2e-geheim-4711");
  expect(JSON.parse(text).smtp.password_set).toBe(true);

  await page.reload();
  await expect(page.getByLabel("Server", { exact: true })).toHaveValue(
    "smtp.example.com",
  );

  // Die Aufbewahrung steht unter „Allgemein“.
  await page.goto("/verwaltung");
  await expect(
    page.getByRole("heading", { level: 1, name: "Allgemein" }),
  ).toBeVisible();
  await page.getByLabel("Einträge löschen nach (Tage)").fill("120");
  await page.getByRole("button", { name: "Aufbewahrung speichern" }).click();
  await expect(
    page.getByText("Die Aufbewahrungsfrist ist gespeichert."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Einträge löschen nach (Tage)")).toHaveValue(
    "120",
  );
});

test("Admin stellt Logo und Akzentfarbe ein und nimmt beides wieder zurück", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung");
  await expect(
    page.getByRole("heading", { level: 3, name: "Branding" }),
  ).toBeVisible();
  const headerLogo = page.locator(".app-header img.brand-logo");

  await page
    .getByLabel(/^Bild (hochladen|ersetzen) – Logo für dunklen Hintergrund$/)
    .setInputFiles("tests/fixtures/logo.png");
  await expect(
    page.getByText("Logo für dunklen Hintergrund: gespeichert."),
  ).toBeVisible();
  await expect(headerLogo).toBeVisible();

  await page.getByLabel("Eigene Akzentfarbe verwenden").check();
  await page.getByLabel("Akzentfarbe", { exact: true }).fill("#0a7d5a");
  await page.getByRole("button", { name: "Name und Farbe speichern" }).click();
  await expect(
    page.getByText("Name und Farbe sind gespeichert."),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--farbe-primaer"),
      ),
    )
    .not.toBe("");
  await expectNoA11yViolations(page);

  // Name, Farbe und Bilder sind ohne Anmeldung abrufbar (Anmeldeseite), ändern aber nicht.
  const open = await page.request.get("/api/branding");
  const branding = await open.json();
  expect(branding.accent).toBe("#0a7d5a");
  expect(branding.logo_dark_url).toContain(
    "/api/branding/assets/logo-dunkel?v=",
  );

  // Zurück auf den Standard, damit die übrigen Tests das gewohnte Aussehen vorfinden.
  await page.getByLabel("Eigene Akzentfarbe verwenden").uncheck();
  await page.getByRole("button", { name: "Name und Farbe speichern" }).click();
  await expect(
    page.getByText("Name und Farbe sind gespeichert."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Entfernen – Logo für dunklen Hintergrund" })
    .click();
  await confirmDialog(page, "Entfernen");
  await expect(
    page.getByText("Logo für dunklen Hintergrund: entfernt."),
  ).toBeVisible();
  await expect(headerLogo).toHaveCount(0);
});

test("Admin legt Fußzeile, Datenschutz-Link und Logo für Mails fest", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung");
  await page
    .getByLabel("Fußzeile (freiwillig)")
    .fill("Firma A · Beispielweg 1");
  await page
    .getByLabel("Link zur Datenschutzerklärung (freiwillig)")
    .fill("https://example.com/datenschutz");
  await page
    .getByRole("button", { name: "Fußzeile und Link speichern" })
    .click();
  await expect(
    page.getByText("Fußzeile und Datenschutz-Link sind gespeichert."),
  ).toBeVisible();
  await page
    .getByLabel(/^Bild (hochladen|ersetzen) – Logo für Mails$/)
    .setInputFiles("tests/fixtures/logo.png");
  await expect(page.getByText("Logo für Mails: gespeichert.")).toBeVisible();
  await expectNoA11yViolations(page);
  const branding = await (await page.request.get("/api/branding")).json();
  expect(branding.privacy_url).toBe("https://example.com/datenschutz");
  expect(branding.logo_mail_url).toContain("/api/branding/assets/logo-mail?v=");

  // Zurück auf den Standard
  await page.getByLabel("Fußzeile (freiwillig)").fill("");
  await page.getByLabel("Link zur Datenschutzerklärung (freiwillig)").fill("");
  await page
    .getByRole("button", { name: "Fußzeile und Link speichern" })
    .click();
  await expect(
    page.getByText("Fußzeile und Datenschutz-Link sind gespeichert."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Entfernen – Logo für Mails" })
    .click();
  await confirmDialog(page, "Entfernen");
  await expect(page.getByText("Logo für Mails: entfernt.")).toBeVisible();
});

test("Admin trägt einen KI-Anbieter ein, der Schlüssel bleibt verborgen", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung/verbindungen");
  await expect(
    page.getByRole("heading", { level: 3, name: "KI-Texte" }),
  ).toBeVisible();
  // Ausgeschaltet lassen: Der Test soll keinen Anbieter ansprechen, außer beim Verbindungstest.
  await page.getByLabel("KI-Texte einschalten").uncheck();
  await page
    .getByLabel("Adresse der Schnittstelle")
    .fill("https://ki.example.com/v1");
  await page.getByLabel("Modell", { exact: true }).fill("beispiel-modell");
  await page
    .getByLabel(/^(Neuer Schlüssel|Schlüssel \(freiwillig\))$/)
    .fill("e2e-schluessel-4711");
  await page.getByLabel("Neue Texte je Stunde (höchstens)").fill("5");
  await page
    .getByRole("button", { name: "KI-Einstellungen speichern" })
    .click();
  await expect(
    page.getByText("Die KI-Einstellungen sind gespeichert."),
  ).toBeVisible();
  await expect(page.getByLabel("Neuer Schlüssel")).toHaveValue("");
  await expectNoA11yViolations(page);

  const stored = await page.request.get("/api/admin/settings");
  const text = await stored.text();
  expect(text).not.toContain("e2e-schluessel-4711");
  expect(JSON.parse(text).ai.api_key_set).toBe(true);

  // Ohne Schlüssel an eine Adresse, an der nichts lauscht: Die Meldung nennt den Grund.
  await page.getByLabel("Gespeicherten Schlüssel löschen").check();
  await page
    .getByLabel("Adresse der Schnittstelle")
    .fill("http://localhost:9/v1");
  await page
    .getByRole("button", { name: "KI-Einstellungen speichern" })
    .click();
  await expect(
    page.getByText("Die KI-Einstellungen sind gespeichert."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verbindung testen" }).click();
  await expect(
    page.getByText(/Die Verbindung funktioniert nicht:/),
  ).toBeVisible();
});

test("Zu große Bilder passt die Werkbank beim Hochladen selbst an", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung");
  await expect(page.getByLabel("Größe beim Hochladen")).toHaveValue("auto");

  await page
    .getByLabel(/^Bild (hochladen|ersetzen) – Logo für hellen Hintergrund$/)
    .setInputFiles("tests/fixtures/logo-gross.png");
  await expect(
    page.getByText(/von 2400 × 600 Pixel auf 800 × 200 Pixel angepasst/),
  ).toBeVisible();

  // Ein breites Bild wird als Favicon mittig in ein Quadrat gesetzt.
  await page
    .getByLabel(/^Bild (hochladen|ersetzen) – Favicon$/)
    .setInputFiles("tests/fixtures/favicon-breit.png");
  await expect(
    page.getByText(/von 300 × 120 Pixel auf 256 × 256 Pixel angepasst/),
  ).toBeVisible();
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    "href",
    /\/api\/branding\/assets\/favicon\?v=/,
  );

  // Im Original bleibt das große Bild zu groß; die Meldung nennt den Ausweg.
  await page.getByLabel("Größe beim Hochladen").selectOption("original");
  await page
    .getByLabel(/^Bild (hochladen|ersetzen) – Logo für dunklen Hintergrund$/)
    .setInputFiles("tests/fixtures/logo-gross.png");
  await expect(
    page.getByText(/Im Original ist das Bild zu groß/),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Aufräumen, damit die übrigen Tests das gewohnte Aussehen vorfinden.
  await page
    .getByRole("button", { name: "Entfernen – Logo für hellen Hintergrund" })
    .click();
  await confirmDialog(page, "Entfernen");
  await expect(
    page.getByText("Logo für hellen Hintergrund: entfernt."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Entfernen – Favicon" }).click();
  await confirmDialog(page, "Entfernen");
  await expect(page.getByText("Favicon: entfernt.")).toBeVisible();
});

test("Admin schaltet Push ein, das Konto zeigt Geräte und die Spalte Push", async ({
  page,
}) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung/mail-teams");
  await expect(
    page.getByRole("heading", { level: 3, name: "Push aufs Handy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Push einschalten" }).click();
  await expect(page.getByText(/Push ist eingeschaltet/)).toBeVisible();
  await expectNoA11yViolations(page);

  const stored = await (await page.request.get("/api/admin/settings")).text();
  expect(stored).not.toContain("PRIVATE KEY");

  await page.goto("/konto");
  await expect(
    page.getByRole("heading", { name: "Push auf deinen Geräten" }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Push" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);

  // Wieder aus, damit die übrigen Tests den gewohnten Stand vorfinden.
  await page.goto("/verwaltung/mail-teams");
  await page.getByRole("button", { name: "Push ausschalten" }).click();
  await expect(page.getByText(/Push ist ausgeschaltet/)).toBeVisible();
});

test("Verwaltung ist ein eigener Bereich mit Unterseiten", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/");
  await openPage(page, "Verwaltung", "Allgemein");
  await expect(page).toHaveURL(/\/verwaltung$/);
  const menu = await openMenu(page);
  for (const label of [
    "Allgemein",
    "Rollen",
    "Mail & Teams",
    "Verbindungen",
    "Audit-Log",
  ]) {
    await expect(
      menu.getByRole("link", { name: itemName(label) }),
    ).toBeVisible();
  }
  await menu.getByRole("link", { name: itemName("Audit-Log") }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Audit-Log" }),
  ).toBeVisible();
});

test("Ohne Admin-Rolle gibt es Audit-Log und Verwaltung nicht in der Oberfläche", async ({
  page,
}) => {
  await loginAs(page, ["Config.Reviewer"], "Rita Reviewer");
  for (const path of ["/audit", "/verwaltung", "/verwaltung/rollen"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Seite nicht gefunden" }),
    ).toBeVisible();
  }
});

test("Betriebsrat kommt nicht an Audit-Log und Verwaltung", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Reader"], "Karl Rat");
  await page.goto("/audit");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/audit");
  expect(api.status()).toBe(403);
  expect((await page.request.get("/api/admin/settings")).status()).toBe(403);
  const branding = await page.request.put("/api/admin/branding", {
    data: { app_name: "Fremd" },
    headers: { Origin: new URL(BASE_URL).origin },
  });
  expect(branding.status()).toBe(403);
  const roles = await page.request.get("/api/admin/roles");
  expect(roles.status()).toBe(403);
});

test("Verbindungen: Berechtigungen für den Abruf prüfen", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung/verbindungen");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /Berechtigungen für den Abruf/,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Berechtigungen prüfen" }).click();
  // In der Testumgebung ist keine Collector-App eingerichtet
  await expect(
    page.getByText("Die Verbindung zur Collector-App ist nicht eingerichtet."),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});
