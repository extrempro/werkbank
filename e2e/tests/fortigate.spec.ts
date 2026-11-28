import { expect, test, type Page } from "@playwright/test";
import {
  BASE_URL,
  expectNoA11yViolations,
  isPhone,
  loginAs,
  openPage,
} from "./helpers";

const ORIGIN = new URL(BASE_URL).origin;

/** Erfundene Beispielgeräte laden (nur in der Test-Umgebung). */
async function loadSample(page: Page) {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  const response = await page.request.post(
    "/api/monitoring/fortigate/test/sample",
    {
      headers: { Origin: ORIGIN },
    },
  );
  expect(response.status()).toBe(204);
}

test("FortiGate: ohne eigenes Recht kein Zugriff, auch nicht für Admins", async ({
  page,
}) => {
  await loginAs(
    page,
    ["Monitoring.Reader", "Werkbank.Admin"],
    "Mona Monitoring",
  );
  await page.goto("/monitoring/fortigate/policies");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/monitoring/fortigate/policies");
  expect(api.status()).toBe(403);
});

test("FortiGate: Übersicht, Policies mit IP-Suche und Adressen & Dienste", async ({
  page,
}) => {
  await loadSample(page);
  await loginAs(page, ["FortiGate.Reader"], "Fritz Firewall");
  await page.goto("/");
  await openPage(page, "IT-Monitoring", "Übersicht");
  await expect(page).toHaveURL(/\/monitoring\/fortigate$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Übersicht" }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /fw-edge/ })).toContainText(
    "Aktiv-Passiv",
  );
  await expect(page.getByRole("button", { name: "Jetzt abrufen" })).toHaveCount(
    0,
  );
  await expectNoA11yViolations(page);

  await page.goto("/monitoring/fortigate/policies");
  await expect(
    page.getByRole("heading", { level: 1, name: "Policies" }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Suchen" }).fill("10.20.30.15");
  await expect(page.getByText(/^3 von \d+ Policies/)).toBeVisible();
  const table = page.getByRole("table", { name: "Policies" });
  const row = table.getByRole("row", { name: /LAN ins Internet/ });
  await expect(row).toContainText("10.20.30.15 in Quelle");
  await row.getByRole("button", { name: /fw-edge/ }).click();
  const detail = page.getByRole("complementary", { name: "Detail der Policy" });
  await expect(
    detail.getByRole("heading", { name: "LAN ins Internet" }),
  ).toBeVisible();
  await expect(detail).toContainText("SNAT");
  await expectNoA11yViolations(page);

  await page.goto("/monitoring/fortigate/objekte?art=address_groups");
  const groups = page.getByRole("table", { name: "Adressgruppen" });
  await groups.getByRole("button", { name: "Grp-Server" }).click();
  const objectDetail = page.getByRole("complementary", {
    name: "Detail des Objekts",
  });
  await expect(
    objectDetail.getByRole("row", { name: /srv-druck/ }),
  ).toContainText("fehlt");
  await expectNoA11yViolations(page);
  await objectDetail.getByRole("link", { name: /Policy #31/ }).click();
  await expect(page).toHaveURL(/\/monitoring\/fortigate\/policies\?/);
  await expect(
    page
      .getByRole("complementary", { name: "Detail der Policy" })
      .getByRole("heading", { name: "Buero zu Servern" }),
  ).toBeVisible();
});

test("FortiGate: Verwaltung mit Geräten, Bearbeiten und Jetzt abrufen", async ({
  page,
}) => {
  await loadSample(page);
  await page.goto("/verwaltung/fortigate");
  await expect(
    page.getByRole("heading", { level: 1, name: "FortiGate" }),
  ).toBeVisible();
  const row = page.getByRole("row", { name: /fw-core/ });
  await expect(row).toBeVisible();
  await expectNoA11yViolations(page);
  await row.getByRole("button", { name: "Bearbeiten" }).click();
  const name = page.getByRole("textbox", { name: /Name/ });
  await name.fill("fw core");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText(/Nur Buchstaben, Ziffern/)).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  if (!isPhone(page)) {
    await expect(
      page.getByRole("combobox", { name: /Aufbewahrung/ }),
    ).toHaveValue("3");
  }

  await loginAs(
    page,
    ["FortiGate.Reader", "FortiGate.Editor"],
    "Bea Bearbeiter",
  );
  await page.goto("/monitoring/fortigate");
  await page.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Der Abruf ist angestoßen" }),
  ).toBeVisible();
});
