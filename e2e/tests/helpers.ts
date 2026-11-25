import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
export const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

/** Anmeldung über den Test-Login (nur in der Testumgebung aktiv). */
export async function loginAs(
  page: Page,
  roles: string[],
  name = "Erika Beispiel",
) {
  const response = await page.request.post("/auth/test-login", {
    data: { oid: name.toLowerCase().replace(/\s+/g, "-"), name, roles },
    headers: { Origin: new URL(BASE_URL).origin },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
}

/** Barrierefreiheit nach WCAG 2.2 AA mit axe-core: keine Verstöße. */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Name eines Menüpunkts: am Anfang der Text, danach höchstens Zähler oder Bereich. */
export function itemName(label: string): RegExp {
  return new RegExp(`^${escape(label)}(\\s|$)`);
}

function areaName(label: string): RegExp {
  return new RegExp(`^${escape(label)}\\s*(,|$)`);
}

/** Handy-Ansicht (bis 760 px): Leiste unten statt Bereichsleiste und Seitenmenü. */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) <= 760;
}

/** Wartet, bis die Oberfläche nach der Anmeldung geladen ist. */
async function ready(page: Page) {
  await page.getByRole("button", { name: /^Benachrichtigungen/ }).waitFor();
}

/**
 * Menü mit den Seiten des aktuellen Bereichs: am Computer das Seitenmenü links,
 * am Handy das Blatt „Menü“ (wird dafür geöffnet).
 */
export async function openMenu(page: Page): Promise<Locator> {
  await ready(page);
  if (!isPhone(page)) {
    const menu = page.getByRole("navigation", { name: /^Seiten:/ });
    if (!(await menu.isVisible())) {
      await page.getByRole("button", { name: "Menü ausklappen" }).click();
    }
    return menu;
  }
  const sheet = page
    .getByRole("dialog", { name: /.+/ })
    .filter({ has: page.locator(".sheet-body") });
  if (!(await sheet.isVisible())) {
    await page
      .getByRole("navigation", { name: "Schnellzugriff" })
      .getByRole("button", { name: "Menü" })
      .click();
  }
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Wechselt in einen Bereich (voller Name) und öffnet dort eine Seite. */
export async function openPage(page: Page, area: string, label: string) {
  await ready(page);
  if (area === "Verwaltung") {
    // Die Verwaltung steht im Kontomenü, ihre Seiten dann im Menü des Bereichs
    const account = await openAccountMenu(page);
    await account.getByRole("menuitem", { name: "Verwaltung" }).click();
    await expect(page).toHaveURL(/\/verwaltung$/);
    if (label === "Allgemein") {
      return;
    }
    const menu = await openMenu(page);
    await menu
      .getByRole("link", { name: itemName(label) })
      .first()
      .click();
    if (isPhone(page)) {
      await expect(menu).toBeHidden();
    }
    return;
  }
  if (!isPhone(page)) {
    await page
      .getByRole("navigation", { name: "Bereiche" })
      .getByRole("link", { name: areaName(area) })
      .click();
    const menu = await openMenu(page);
    const link = menu.getByRole("link", { name: itemName(label) }).first();
    if ((await link.getAttribute("aria-current")) !== "page") {
      await link.click();
    }
    return;
  }
  const sheet = await openMenu(page);
  const back = sheet.getByRole("button", { name: "Alle Bereiche" });
  if (await back.isVisible()) {
    await back.click();
  }
  await sheet.getByRole("button", { name: areaName(area) }).click();
  await sheet
    .getByRole("link", { name: itemName(label) })
    .first()
    .click();
  await expect(sheet).toBeHidden();
}

/** Öffnet das Kontomenü oben rechts und gibt es zurück. */
export async function openAccountMenu(page: Page): Promise<Locator> {
  await ready(page);
  await page.getByRole("button", { name: /^Konto und Einstellungen/ }).click();
  const menu = page.getByRole("menu", { name: "Konto" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Volle Namen aller Bereiche in der Bereichsleiste bzw. im Menü (ohne Handbuch und Verwaltung). */
export async function areaNames(page: Page): Promise<string[]> {
  await ready(page);
  const strip = (name: string | null) =>
    (name ?? "").replace(/, offene Aufgaben$/, "").trim();
  if (!isPhone(page)) {
    // Sichtbar steht der Kurzname, der volle Name steht für Screenreader daneben.
    const labels = page
      .getByRole("navigation", { name: "Bereiche" })
      .locator("a.area-link .visually-hidden");
    return (await labels.allTextContents()).map(strip);
  }
  const sheet = await openMenu(page);
  const back = sheet.getByRole("button", { name: "Alle Bereiche" });
  if (await back.isVisible()) {
    await back.click();
  }
  const labels = sheet.locator(".sheet-area .nav-label");
  await expect(labels.first()).toBeVisible();
  const names = (await labels.allTextContents())
    .map(strip)
    .filter((name) => name !== "Handbuch");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  return names;
}

/** Öffnet das Handbuch über das Kontomenü oben rechts (auf allen Geräten). */
export async function openHandbook(page: Page) {
  const account = await openAccountMenu(page);
  await account.getByRole("menuitem", { name: "Handbuch" }).click();
}

/**
 * Status über einer Liste wählen (gemeinsame Filterzeile): am Computer und Tablet ein Chip
 * „Name · Anzahl“, am Handy und in Listen mit fester Breite eine Auswahl.
 */
export async function chooseStatus(page: Page, label: string, option: string) {
  const select = page.getByRole("combobox", { name: label, exact: true });
  // Am Handy und in Listen mit fester Breite (z. B. Evergreen) ist der Status eine Auswahl
  await expect(
    select.or(page.getByRole("group", { name: label, exact: true })).first(),
  ).toBeVisible();
  if (isPhone(page) || (await select.count()) > 0) {
    const value = await select
      .getByRole("option", { name: new RegExp(`^${escape(option)}( ·|$)`) })
      .getAttribute("value");
    await select.selectOption(value ?? "");
  } else {
    await page
      .getByRole("group", { name: label, exact: true })
      .getByRole("button", { name: new RegExp(`^${escape(option)}( ·|$)`) })
      .click();
  }
}

/** Prüft, welcher Status über einer Liste gewählt ist. */
export async function expectStatus(page: Page, label: string, option: string) {
  const name = new RegExp(`^${escape(option)}( ·|$)`);
  const select = page.getByRole("combobox", { name: label, exact: true });
  await expect(
    select.or(page.getByRole("group", { name: label, exact: true })).first(),
  ).toBeVisible();
  if (isPhone(page) || (await select.count()) > 0) {
    await expect(select.locator("option:checked")).toHaveText(name);
  } else {
    await expect(
      page
        .getByRole("group", { name: label, exact: true })
        .getByRole("button", { name }),
    ).toHaveAttribute("aria-pressed", "true");
  }
}

/**
 * Ein weiteres Filterfeld setzen: am Computer und Tablet in der Filterzeile, am Handy im Blatt
 * „Weitere Filter“, das danach mit „Fertig“ schließt.
 */
export async function chooseFilter(page: Page, label: string, option: string) {
  if (isPhone(page)) {
    await page.getByRole("button", { name: /^Weitere Filter/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet
      .getByRole("combobox", { name: label, exact: true })
      .selectOption({ label: option });
    await sheet.getByRole("button", { name: "Fertig" }).click();
  } else {
    await page
      .getByRole("combobox", { name: label, exact: true })
      .selectOption({ label: option });
  }
}

/** Bestätigungsdialog abwarten, optional auf Barrierefreiheit prüfen und mit `action` bestätigen. */
export async function confirmDialog(
  page: Page,
  action: string,
  checkA11y = false,
) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  if (checkA11y) {
    await expectNoA11yViolations(page);
  }
  await dialog.getByRole("button", { name: action, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Eintrag in einer Auswahl mit Suche wählen (Raum, Stelle, Partner …). */
export async function pickFromList(
  scope: Locator,
  label: RegExp,
  text: string,
) {
  const box = scope.getByRole("combobox", { name: label });
  await box.fill(text);
  await scope
    .getByRole("option", { name: new RegExp(escapeRegExp(text)) })
    .click();
}

/**
 * Wählt in einer Listen-Auswahl (`ListChoice`): bis zehn Möglichkeiten sind Auswahlkarten,
 * darüber ein Suchfeld mit schwebendem Fenster.
 */
export async function pickChoice(scope: Locator, label: string, text: string) {
  const cards = scope.getByRole("group", { name: label, exact: true });
  if (
    (await cards.count()) > 0 &&
    (await cards.getByRole("radio").count()) > 0
  ) {
    await cards
      .getByRole("radio", { name: new RegExp(escapeRegExp(text)) })
      .check();
    return;
  }
  await pickFromList(scope, new RegExp(`^${escapeRegExp(label)}`), text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
