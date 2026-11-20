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
  return new RegExp(`^${escape(label)}(,|$)`);
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

/** Volle Namen aller Bereiche, die die Person sieht (ohne Handbuch). */
export async function areaNames(page: Page): Promise<string[]> {
  await ready(page);
  const strip = (name: string | null) =>
    (name ?? "").replace(/, offene Aufgaben$/, "").trim();
  if (!isPhone(page)) {
    const links = page
      .getByRole("navigation", { name: "Bereiche" })
      .getByRole("link");
    const names = await links.evaluateAll((all) =>
      all.map((a) => a.getAttribute("aria-label")),
    );
    return names.map(strip).filter((name) => name !== "Handbuch");
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

/** Öffnet das Handbuch: am Computer unten in der Bereichsleiste, am Handy im Menü. */
export async function openHandbook(page: Page) {
  await ready(page);
  if (!isPhone(page)) {
    await page
      .getByRole("navigation", { name: "Bereiche" })
      .getByRole("link", { name: "Handbuch" })
      .click();
    return;
  }
  const sheet = await openMenu(page);
  const back = sheet.getByRole("button", { name: "Alle Bereiche" });
  if (await back.isVisible()) {
    await back.click();
  }
  await sheet.getByRole("link", { name: "Handbuch" }).click();
}
