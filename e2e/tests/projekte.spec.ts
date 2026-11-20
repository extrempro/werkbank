import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openPage } from "./helpers";

test("IT-Projekte: Projekt anlegen, einstellen, Jour Fixe und Aufgaben", async ({
  page,
}, testInfo) => {
  const name = `Projekt ${testInfo.project.name} ${Date.now()}`;
  await loginAs(page, ["Projekte.Editor"], "Paula Projekt");
  await page.goto("/");
  await openPage(page, "IT-Projekte", "Alle Projekte");
  await expect(page).toHaveURL(/\/projekte$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Projekte" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Neues Projekt: danach öffnen sich die Einstellungen.
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await expect(page).toHaveURL(/\/projekte\/\d+\/einstellungen$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByLabel(/^Betrag/).fill("10.000,00");
  await page.getByRole("button", { name: "Externe Person hinzufügen" }).click();
  await page.getByLabel("Name", { exact: true }).nth(1).fill("Jana Muster");
  await page.getByRole("button", { name: "Link hinzufügen" }).click();
  await page.getByLabel("Bezeichnung", { exact: true }).fill("Ablage");
  await page
    .getByLabel("Adresse", { exact: true })
    .fill("https://ablage.example.com/projekt");
  await page.getByRole("button", { name: "Einstellungen speichern" }).click();
  await expect(
    page.getByText("Die Einstellungen sind gespeichert."),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Übersicht
  await page.getByRole("link", { name: "Übersicht", exact: true }).click();
  await expect(page.getByText("Jana Muster")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ablage/ })).toBeVisible();
  await expectNoA11yViolations(page);

  // Jour Fixe mit Leiste und Vorschau
  await page.getByRole("link", { name: "Jour Fixe", exact: true }).click();
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page
    .getByLabel("Protokoll", { exact: true })
    .fill("## Stand\n- [ ] Termin festlegen");
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByRole("heading", { name: "Stand" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText(/ist gespeichert/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stand" })).toBeVisible();
  await expectNoA11yViolations(page);

  // Aufgaben
  await page.getByRole("main").getByRole("link", { name: "Aufgaben", exact: true }).click();
  await page.getByLabel("Neue Aufgabe").fill("Angebote vergleichen");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Angebote vergleichen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Budget ohne zugeordnete Posten
  await page.getByRole("link", { name: "Budget", exact: true }).click();
  await expect(
    page.getByText(/noch kein Budgetposten zugeordnet/),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Lesende sehen keine Einstellungen, ohne Rolle gibt es den Bereich nicht", async ({
  page,
}) => {
  await loginAs(page, ["Projekte.Reader"], "Lena Lesen");
  await page.goto("/projekte");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projekte" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Neues Projekt" })).toHaveCount(
    0,
  );
  await expectNoA11yViolations(page);

  await loginAs(page, ["Budget.Reader"], "Bea Budget");
  await page.goto("/projekte");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/projects");
  expect(api.status()).toBe(403);
});
