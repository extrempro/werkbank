import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

// Gerätezuordnung mit nachgestelltem Microsoft Graph (ENVIRONMENT=test): Das Admin-Konto
// verbindet der Test über /api/devices/admin/test-login. Die QR-Codes in fixtures/ enthalten
// erfundene Gerätedaten; die Seriennummer steuert das Verhalten (DOPPELT, FEHLER500).

const ORIGIN = new URL(BASE_URL).origin;
const PAGE = "/m365/geraete/zuordnung";
const ROLE = ["Geraete.Zuordnung"];

function fixture(name: string): string {
  return `tests/fixtures/qr-${name}.png`;
}

async function connectAdmin(page: Page) {
  const response = await page.request.post("/api/devices/admin/test-login", {
    data: { upn: "admin@example.com" },
    headers: { Origin: ORIGIN },
  });
  expect(response.ok()).toBe(true);
}

/** Scan-Dialog öffnen und den QR-Code als Foto übergeben (ohne Kamera im Test). */
async function scanPhoto(page: Page, name: string) {
  await page.getByRole("button", { name: /QR-Code scannen/ }).click();
  const dialog = page.getByRole("dialog", { name: "Gerät zuordnen" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Foto auswählen/).setInputFiles(fixture(name));
  await expect(
    dialog.getByRole("heading", { name: "Gerät prüfen" }),
  ).toBeVisible();
  return dialog;
}

test("Scannen, zur Freigabe senden, eine andere Person gibt frei", async ({
  page,
}) => {
  await loginAs(page, ROLE, "Erika Beispiel");
  await page.goto(PAGE);
  await expect(
    page.getByRole("heading", { level: 1, name: "Gerätezuordnung" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Mit Admin-Konto anmelden" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  const dialog = await scanPhoto(page, "freigabe");
  await expect(dialog.getByText("E2E-FREIGABE")).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Zur Freigabe senden" }).click();
  await expect(dialog.getByText(/Zur Freigabe gesendet/)).toBeVisible();
  await dialog.getByRole("button", { name: "Zur Liste" }).click();
  await expect(dialog).toBeHidden();

  // Eine andere Person mit Admin-Konto gibt am PC frei
  await loginAs(page, ROLE, "Ole Beispiel");
  await connectAdmin(page);
  await page.goto(`${PAGE}?ansicht=freigabe`);
  await expect(page.getByText(/Admin-Konto verbunden/)).toBeVisible();
  await page
    .getByRole("button", { name: /E2E-FREIGABE/ })
    .first()
    .click();
  const drawer = page.getByRole("dialog", { name: "Modell 1" });
  await expect(drawer.getByText(/verschlüsselt/)).toBeVisible();
  await drawer
    .getByLabel("Device-Preparation-Richtlinie")
    .selectOption({ label: "Testrichtlinie Büro" });
  await expectNoA11yViolations(page);
  await drawer.getByRole("button", { name: "Jetzt freigeben" }).click();
  await expect(
    page.getByText(/Vorab zugeordnet\. Jetzt am Gerät/),
  ).toBeVisible();
  await expect(drawer.getByText("Testrichtlinie Büro")).toBeVisible();
});

test("Wartendes Gerät verwerfen", async ({ page }) => {
  await loginAs(page, ROLE, "Erika Beispiel");
  await page.goto(PAGE);
  const dialog = await scanPhoto(page, "verwerfen");
  await dialog.getByRole("button", { name: "Zur Freigabe senden" }).click();
  await expect(dialog.getByText(/Zur Freigabe gesendet/)).toBeVisible();
  await dialog.getByRole("button", { name: "Zur Liste" }).click();

  await page.goto(`${PAGE}?ansicht=freigabe`);
  await page
    .getByRole("button", { name: /E2E-VERWERFEN/ })
    .first()
    .click();
  const drawer = page.getByRole("dialog", { name: "Modell 1" });
  await drawer.getByRole("button", { name: "Verwerfen" }).click();
  await expect(
    drawer.getByText(/Eintrag und Gerätedaten löschen/),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await drawer
    .getByRole("group", { name: "Verwerfen bestätigen" })
    .getByRole("button", { name: "Verwerfen" })
    .click();
  await expect(page.getByText(/Gerätedaten gelöscht/)).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E-VERWERFEN/ })).toHaveCount(
    0,
  );
});

test("Sofort freigeben mit Admin-Konto, Duplikat und Fehler von Microsoft", async ({
  page,
}) => {
  await loginAs(page, ROLE, "Ole Beispiel");
  await connectAdmin(page);
  await page.goto(PAGE);

  // Sofortfreigabe: erst nach Bestätigung des Tenants
  let dialog = await scanPhoto(page, "sofort");
  const go = dialog.getByRole("button", { name: "Jetzt freigeben" });
  await expect(go).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /Beispiel-Tenant/ }).check();
  await expectNoA11yViolations(page);
  await go.click();
  await expect(
    dialog.getByText(/Jetzt am Gerät auf „Weiter“ klicken/),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Duplikat: zweiter Import gesperrt
  await dialog.getByRole("button", { name: "Nächstes Gerät scannen" }).click();
  await dialog.getByLabel(/Foto auswählen/).setInputFiles(fixture("doppelt"));
  await expect(
    dialog.getByText(/Ein zweiter Import ist gesperrt/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Jetzt freigeben" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Anderes Gerät scannen" }).click();

  // 5xx: Voraussetzungen und Request-ID, kein neuer Versuch
  await dialog.getByLabel(/Foto auswählen/).setInputFiles(fixture("fehler500"));
  await dialog.getByRole("checkbox", { name: /Beispiel-Tenant/ }).check();
  await dialog.getByRole("button", { name: "Jetzt freigeben" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText(
    "Microsoft konnte das Gerät nicht zuordnen",
  );
  await expect(alert).toContainText("Secure Boot");
  await expect(alert).toContainText("00000000-test-0500");
  await expect(
    dialog.getByRole("button", { name: "Noch einmal versuchen" }),
  ).toHaveCount(0);
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Zur Liste" }).click();
  dialog = page.getByRole("dialog", { name: "Gerät zuordnen" });
  await expect(dialog).toBeHidden();
});
