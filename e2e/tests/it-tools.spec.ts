import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openNavigation } from "./helpers";

test("IT-Tools: Übersicht mit Suche und Favoriten", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");
  await page.goto("/");
  await openNavigation(page);
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: /^IT-Tools/ })
    .click();
  await expect(page).toHaveURL(/\/it-tools$/);
  await expect(page.getByRole("heading", { level: 1, name: "IT-Tools" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Subnetz-Rechner" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel("Tool suchen").fill("chmod");
  await expect(page.getByRole("link", { name: "Subnetz-Rechner" })).toHaveCount(0);
  await page.getByRole("button", { name: "chmod-Rechner zu den Favoriten" }).click();
  await page.getByLabel("Tool suchen").fill("");
  await expect(page.getByRole("heading", { level: 2, name: "Favoriten" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Favoriten" })).toBeVisible();
  await page
    .getByRole("button", { name: "chmod-Rechner aus den Favoriten entfernen" })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 2, name: "Favoriten" })).toHaveCount(0);
});

test("IT-Tools: Subnetz-Rechner rechnet und der Link lässt sich teilen", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");
  await page.goto("/it-tools/subnetz");
  await expect(page.getByRole("heading", { level: 1, name: "Subnetz-Rechner" })).toBeVisible();
  await page.getByLabel("Netz, Adresse oder Bereich").fill("192.168.10.77/24");
  await expect(page.getByRole("row", { name: /^Broadcast/ })).toContainText("192.168.10.255");
  await expect(page).toHaveURL(/netz=192\.168\.10\.77/);
  await expectNoA11yViolations(page);
  // Dieselbe Adresse neu geöffnet zeigt dasselbe Ergebnis.
  await page.reload();
  await expect(page.getByLabel("Netz, Adresse oder Bereich")).toHaveValue("192.168.10.77/24");
  await expect(page.getByRole("row", { name: /^Subnetzmaske/ })).toContainText("255.255.255.0");
});

test("IT-Tools: chmod, Base64, UUID und Passwort-Generator", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/chmod");
  await page.getByLabel("Andere Schreiben").check();
  await expect(page.getByRole("row", { name: /^Oktal/ })).toContainText("757");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/base64");
  await page.getByLabel("Eingabe").fill("Grüße");
  await expect(page.getByLabel("Ergebnis", { exact: true })).toHaveText("R3LDvMOfZQ==");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/uuid");
  await expect(page.getByLabel("UUIDs", { exact: true })).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-4/);
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/passwort");
  const passwords = page.getByRole("list", { name: "Erzeugte Kennwörter" }).getByRole("listitem");
  await expect(passwords).toHaveCount(5);
  const first = (await passwords.first().locator("code").textContent()) ?? "";
  expect(first).toHaveLength(20);
  // Das Kennwort steht nie in der Adresszeile.
  expect(page.url()).not.toContain(encodeURIComponent(first));
  await expectNoA11yViolations(page);
});

test("IT-Tools: weitere Netzwerk-Tools", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/subnetting-bits");
  await expect(page.getByRole("row", { name: /^Subnetzmaske/ })).toContainText("255.255.255.192");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/netze-zusammenfassen");
  await page
    .getByRole("textbox", { name: /^Netze, Adressen oder Bereiche/ })
    .fill("192.168.0.0/24\n192.168.1.0/24");
  await expect(page.getByLabel("Zusammengefasst (IPv4)", { exact: true })).toHaveText(
    "192.168.0.0/23",
  );
  expect(page.url()).not.toContain("192.168");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/firewall-regeln");
  await expect(page.getByText("Das Paket wird verworfen")).toBeVisible();
  await expect(page.getByText(/greift nie: Regel 3 deckt alles ab/)).toBeVisible();
  await expectNoA11yViolations(page);

  // Die Herstellerliste liegt in der Werkbank; es gibt keine Abfrage nach außen.
  const foreign: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin) {
      foreign.push(request.url());
    }
  });
  await page.goto("/it-tools/mac-adressen");
  await page.getByRole("textbox", { name: /^MAC-Adressen/ }).fill("00-00-00-AB-CD-EF");
  await expect(page.getByText("Xerox Corporation")).toBeVisible({ timeout: 15000 });
  expect(foreign).toEqual([]);
  expect(page.url()).not.toContain("AB");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/ports?suche=3389");
  await expect(page.getByRole("row", { name: /^3389/ })).toContainText("RDP");
  await expect(page.getByLabel("Windows (PowerShell)", { exact: true })).toContainText(
    "-LocalPort 3389",
  );
  await expectNoA11yViolations(page);
});

test("IT-Tools: ohne die Rolle gibt es den Bereich nicht", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/it-tools");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  await page.goto("/it-tools/chmod");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  await openNavigation(page);
  await expect(
    page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: /^IT-Tools/ }),
  ).toHaveCount(0);
});
