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
  await expect(page.getByText(/^4 von \d+ Policies/)).toBeVisible();
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

test("FortiGate: Fabric-Sync und unbenutzte Objekte mit Aufräumliste", async ({
  page,
}) => {
  await loadSample(page);
  await loginAs(page, ["FortiGate.Reader"], "Fritz Firewall");
  await page.goto("/monitoring/fortigate/objekte?art=address_groups");
  const sync = page.getByRole("region", { name: "Objekt-Synchronisierung" });
  await expect(sync).toContainText("fw-standort-b");
  await expect(sync).toContainText("nur lokal");
  await expect(
    page
      .getByRole("table", { name: "Adressgruppen" })
      .getByRole("row", { name: /Grp-Server/ }),
  ).toContainText("Sync abweichend");
  await page.getByRole("link", { name: /Nur unbenutzte anzeigen/ }).click();
  await expect(page).toHaveURL(/\/monitoring\/fortigate\/unbenutzt$/);
  const table = page.getByRole("table", { name: "Unbenutzte Objekte" });
  await expect(table.getByRole("row", { name: /Netz-Gast-alt/ })).toContainText(
    "Fabric-Objekt",
  );
  await expect(table.getByRole("row", { name: /test-host-1/ })).toBeVisible();
  await expectNoA11yViolations(page);
  await page
    .getByRole("checkbox", { name: /Nur in deaktivierten Policies/ })
    .uncheck();
  await expect(table.getByRole("row", { name: /Drucker-Netz/ })).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Drucker-Netz für die Aufräumliste wählen" })
    .check();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Auswahl als Aufräumliste (1)" })
    .click();
  expect((await download).suggestedFilename()).toBe(
    "fortigate-aufraeumliste.csv",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Gelöscht wurde nichts" }),
  ).toBeVisible();
});

test("FortiGate: Befunde mit Ausnahme und Verweis auf die Policy", async ({
  page,
}) => {
  await loadSample(page);
  await loginAs(
    page,
    ["FortiGate.Reader", "FortiGate.Editor"],
    "Fritz Firewall",
  );
  // Ausnahmen aus einem abgebrochenen früheren Lauf entfernen
  const old = await page.request.get(
    "/api/monitoring/fortigate/findings?excepted=true",
  );
  for (const item of (await old.json()).rows as {
    exception: { id: number };
  }[]) {
    await page.request.delete(
      `/api/monitoring/fortigate/exceptions/${item.exception.id}`,
      { headers: { Origin: ORIGIN } },
    );
  }
  await page.goto("/monitoring/fortigate");
  await page.getByRole("link", { name: /\d+ hoch/ }).click();
  await expect(page).toHaveURL(/\/monitoring\/fortigate\/befunde\?stufe=hoch/);
  const table = page.getByRole("table", { name: "Befunde" });
  const row = table.getByRole("row", { name: /Fernwartung Altsystem/ }).first();
  await expect(row).toContainText("Hoch");
  await expectNoA11yViolations(page);
  await row.getByRole("button", { name: /Aus dem Internet/ }).click();
  const detail = page.getByRole("complementary", {
    name: "Detail des Befunds",
  });
  await detail
    .getByRole("textbox", { name: /Begründung/ })
    .fill("Fernwartung für Altsystem bewusst offen");
  await detail.getByRole("radio", { name: /6 Monate/ }).check();
  await detail.getByRole("button", { name: "Als Ausnahme hinnehmen" }).click();
  await page
    .getByRole("alertdialog", { name: /als Ausnahme hinnehmen/ })
    .getByRole("button", { name: "Hinnehmen" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Der Befund ist als Ausnahme hingenommen." }),
  ).toBeVisible();
  await expect(
    table.getByRole("row", { name: /Aus dem Internet.*Fernwartung/ }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Ausnahmen zeigen/ }).check();
  const excepted = page
    .getByRole("table", { name: "Befunde" })
    .getByRole("row", { name: /Fernwartung Altsystem/ });
  await excepted.getByRole("button").first().click();
  await expect(detail).toContainText("Fernwartung für Altsystem bewusst offen");
  await detail.getByRole("button", { name: "Ausnahme aufheben" }).click();
  await page
    .getByRole("alertdialog", { name: "Ausnahme aufheben?" })
    .getByRole("button", { name: "Aufheben" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Die Ausnahme ist aufgehoben." }),
  ).toBeVisible();

  // Policy mit Befund und Link zurück
  await page.goto(
    "/monitoring/fortigate/policies?geraet=fw-core&q=%2344&auswahl=fw-core%3A44",
  );
  const policyDetail = page.getByRole("complementary", {
    name: "Detail der Policy",
  });
  await policyDetail.getByRole("link", { name: "Verdeckte Policy" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Verdeckte Policy" }),
  ).toBeVisible();
});

test("FortiGate: Prüfregeln in der Verwaltung", async ({ page }) => {
  await loginAs(page, ["Werkbank.Admin"], "Ada Admin");
  await page.goto("/verwaltung/fortigate");
  const section = page.getByRole("region", { name: "Prüfregeln für Befunde" });
  await expect(
    section.getByRole("checkbox", { name: /Verdeckte Policy/ }),
  ).toBeChecked();
  await section
    .getByRole("textbox", { name: /Schützenswerte Zonen/ })
    .fill("dmz-server");
  await section.getByRole("button", { name: "Prüfregeln speichern" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Die Prüfregeln sind gespeichert." }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("FortiGate: Pfad-Analyse mit Gegenprüfung, Internet-Ausgang und Änderungen", async ({
  page,
}) => {
  await loadSample(page);
  await loginAs(page, ["FortiGate.Reader"], "Fritz Firewall");
  await page.goto("/monitoring/fortigate/pfad");
  await page.getByRole("textbox", { name: /Quelle/ }).fill("10.40.12.7");
  await page.getByRole("textbox", { name: /Ziel/ }).fill("203.0.113.10");
  await page.getByRole("textbox", { name: /Port/ }).fill("443");
  await page.getByRole("button", { name: "Pfad berechnen" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Ausgang ins Internet: fw-edge wan1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: /fw-standort-b/ }),
  ).toBeVisible();
  await expect(
    page.getByText("#15 davor passt nicht (Dienst nur DNS)"),
  ).toBeVisible();
  await expect(page).toHaveURL(/quelle=10\.40\.12\.7/);
  await expectNoA11yViolations(page);

  await page.goto("/monitoring/fortigate/internet");
  const table = page.getByRole("table", { name: "Internet-Ausgang je Netz" });
  const row = table.getByRole("row", { name: /10\.40\.0\.0\/16/ });
  await expect(row).toContainText("fw-standort-b #3 → fw-edge #18");
  await expect(
    page.getByText("fw-edge ↔ fw-standort-b: IPsec ipsec-standort-b"),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await row.getByRole("link", { name: "Pfad im Detail" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Ausgang ins Internet" }),
  ).toBeVisible();

  await page.goto("/monitoring/fortigate/aenderungen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Änderungen" }),
  ).toBeVisible();
  const compare = page.getByRole("region", { name: /Zwei Abrufe vergleichen/ });
  await compare
    .getByRole("combobox", { name: "Gerät" })
    .selectOption("fw-edge");
  await expect(
    compare.getByRole("combobox", { name: "Neuerer Abruf" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});
