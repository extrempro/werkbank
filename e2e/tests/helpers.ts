import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Anmeldung über den Test-Login (nur in der Testumgebung aktiv). */
export async function loginAs(page: Page, roles: string[], name = "Erika Beispiel") {
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
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** Öffnet auf kleinen Bildschirmen das Menü, damit die Navigation sichtbar ist. */
export async function openNavigation(page: Page) {
  // Erst warten, bis die Oberfläche nach der Anmeldung geladen ist.
  await page.getByRole("button", { name: "Abmelden" }).first().waitFor();
  const toggle = page.getByRole("button", { name: "Menü" });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}
