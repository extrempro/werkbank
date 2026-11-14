import { expect, test } from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("Ein Vorgang läuft von der IT über Betriebsrat bis zur Geschäftsführung", async ({
  page,
}, testInfo) => {
  const title = `Neue Funktion ${testInfo.project.name} ${Date.now()}`;

  // IT legt den Vorgang an und bringt ihn bis zur Vorlage beim Betriebsrat
  await loginAs(page, ["Evergreen.IT"], "Ina IT");
  await page.goto("/evergreen");
  await expect(page.getByRole("heading", { level: 1, name: "Vorgänge" })).toBeVisible();
  await page.getByRole("button", { name: "Vorgang anlegen" }).click();
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Dienst (z. B. Teams, Exchange)").fill("Teams");
  await page.getByLabel("Rollout-Datum").fill(isoInDays(10));
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Anlegen" }).click();

  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByText("(dringend)")).toBeVisible();
  await expectNoA11yViolations(page);
  const itemUrl = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "Mitbestimmungspflichtig", exact: true }).click();
  await expect(page.getByText("Neuer Schritt: Fachabteilungen.")).toBeVisible();
  await page.getByRole("button", { name: "Rückmeldungen liegen vor" }).click();
  await expect(page.getByText("Neuer Schritt: Vorlage BR.")).toBeVisible();
  await page.getByRole("button", { name: "An den Betriebsrat übergeben" }).click();
  await expect(
    page.getByRole("heading", { name: "Beschluss im Auftrag erfassen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Betriebsrat entscheidet selbst; ohne Kommentar geht „Mit Auflagen“ nicht
  await loginAs(page, ["Evergreen.Betriebsrat"], "Bea Betriebsrat");
  await page.goto("/evergreen");
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: "Entscheidung: Betriebsrat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Angaben bearbeiten" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mit Auflagen zustimmen" }).click();
  await expect(page.getByRole("alert")).toContainText("Kommentar nötig");
  await page.getByLabel("Kommentar").fill("Nur für die Pilotgruppe");
  await page.getByRole("button", { name: "Mit Auflagen zustimmen" }).click();
  await expect(page.getByText("Neuer Schritt: Geschäftsführung.")).toBeVisible();
  await expectNoA11yViolations(page);

  // Geschäftsführung sieht die Aufgabe auf der Startseite und nimmt ab
  await loginAs(page, ["Evergreen.GF"], "Gerd Geschaeftsfuehrung");
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /Geschäftsführung: Vorgänge bearbeiten/ }),
  ).toBeVisible();
  await page.goto(itemUrl);
  await page.getByRole("button", { name: "Abnehmen" }).click();
  await expect(page.getByText("Neuer Schritt: Umsetzung.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Nur für die Pilotgruppe" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abnehmen" })).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test("Der Betriebsrat sieht einen Vorgang erst, wenn er ihm vorgelegt wurde", async ({ page }) => {
  await loginAs(page, ["Evergreen.IT"], "Ina IT");
  const created = await page.request.post("/api/evergreen/items", {
    data: { title: `Noch nicht vorgelegt ${Date.now()}` },
    headers: { Origin: new URL(BASE_URL).origin },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as number;

  await loginAs(page, ["Evergreen.Betriebsrat"], "Bea Betriebsrat");
  expect((await page.request.get(`/api/evergreen/items/${id}`)).status()).toBe(404);
  await page.goto(`/evergreen/${id}`);
  await expect(page.getByText("für dich nicht sichtbar")).toBeVisible();
});

test("Ohne Evergreen-Rolle bleibt das Modul verschlossen", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/evergreen");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  expect((await page.request.get("/api/evergreen/items")).status()).toBe(403);
});

test("Der Eingang ist für IT erreichbar und zunächst leer", async ({ page }) => {
  await loginAs(page, ["Evergreen.IT"], "Ina IT");
  await page.goto("/evergreen/eingang");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  await expect(page.getByText("Keine Meldungen für diese Auswahl.")).toBeVisible();
  await expectNoA11yViolations(page);

  await loginAs(page, ["Evergreen.GF"], "Gerd Geschaeftsfuehrung");
  await page.goto("/evergreen/eingang");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  expect((await page.request.get("/api/evergreen/messages")).status()).toBe(403);
});
