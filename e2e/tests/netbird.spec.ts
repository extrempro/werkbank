import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

const ORIGIN = new URL(BASE_URL).origin;

/** Erfundene NetBird-Daten laden (nur in der Test-Umgebung). */
async function loadSample(page: Page) {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  const response = await page.request.post(
    "/api/monitoring/netbird/test/sample",
    {
      headers: { Origin: ORIGIN },
    },
  );
  expect(response.status()).toBe(204);
}

test("NetBird: ohne eigenes Recht kein Zugriff, auch nicht für Admins", async ({
  page,
}) => {
  await loginAs(
    page,
    ["Werkbank.Admin", "Monitoring.Reader"],
    "Mona Monitoring",
  );
  await page.goto("/monitoring/netbird/peers");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/monitoring/netbird/peers");
  expect(api.status()).toBe(403);
});

test("NetBird: Übersicht mit Hinweisen und Peers mit Detail", async ({
  page,
}) => {
  await loadSample(page);
  await loginAs(page, ["NetBird.Reader"], "Nora NetBird");
  await page.goto("/monitoring/netbird");
  await expect(
    page.getByRole("heading", { level: 1, name: "Übersicht" }),
  ).toBeVisible();
  await expect(page.getByText("3 / 6")).toBeVisible();
  const hints = page.getByRole("region", { name: "Hinweise" });
  await expect(hints).toContainText("Anmeldung von nb-peer-07");
  await expect(page.getByRole("button", { name: "Jetzt abrufen" })).toHaveCount(
    0,
  );
  await expectNoA11yViolations(page);
  await hints
    .getByRole("listitem")
    .filter({ hasText: "Anmeldung von nb-peer-07" })
    .getByRole("link", { name: "Ansehen" })
    .click();
  await expect(page).toHaveURL(/\/monitoring\/netbird\/peers\?auswahl=p-07/);
  const detail = page.getByRole("complementary", { name: "Detail des Peers" });
  await expect(
    detail.getByRole("heading", { name: "nb-peer-07" }),
  ).toBeVisible();
  await expect(detail).toContainText("grp-beispiel-it");
  await expect(page.getByRole("link", { name: "CSV exportieren" })).toHaveCount(
    0,
  );
  await page.getByRole("searchbox", { name: "Suchen" }).fill("Max");
  await expect(
    page
      .getByRole("table", { name: "Peers" })
      .getByRole("row", { name: /nb-peer-19/ }),
  ).toContainText("Anmeldung abgelaufen");
  await expectNoA11yViolations(page);
});

test("NetBird: Verwaltung mit Zugang und Abruf für Admins mit Recht", async ({
  page,
}) => {
  await loadSample(page);
  await loginAs(page, ["Werkbank.Admin", "NetBird.Reader"], "Ada Admin");
  await page.goto("/verwaltung/netbird");
  const url = page.getByRole("textbox", { name: /Management-URL/ });
  await expect(url).toHaveValue("https://netbird.example.com");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Die Einstellungen für NetBird sind gespeichert." }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto("/monitoring/netbird");
  await page.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Der Abruf ist angestoßen" }),
  ).toBeVisible();
  await page.goto("/monitoring/netbird/peers");
  await expect(
    page.getByRole("link", { name: "CSV exportieren" }),
  ).toBeVisible();
});
