import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import {
  BASE_URL,
  chooseFilter,
  chooseStatus,
  expectNoA11yViolations,
  isPhone,
  loginAs,
  openPage,
  confirmDialog,
} from "./helpers";

test("IT-Bestand: Gerät erfassen, Inventurnummer setzen, ausmustern", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const name = `Monitor ${stamp}`;
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/");
  await openPage(page, "IT-Bestand", "Hardware");
  await expect(page).toHaveURL(/\/bestand\/hardware$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Hardware" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Erfassen mit Inventurnummer: erst nach der Rückfrage
  await page.getByRole("button", { name: "Gerät erfassen" }).click();
  await page.getByLabel("Bezeichnung", { exact: true }).fill(name);
  await page
    .getByRole("combobox", { name: /^Art/ })
    .selectOption({ label: "Monitor" });
  await page.getByLabel("Seriennummer", { exact: true }).fill(`SN-${stamp}`);
  await page.getByLabel("Inventurnummer (freiwillig)").fill(`INV-${stamp}`);
  await page.getByRole("button", { name: "Gerät anlegen" }).click();
  await confirmDialog(page, "Gerät anlegen", true);
  await expect(page).toHaveURL(/\/bestand\/hardware\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(`INV-${stamp}`)).toBeVisible();
  await expectNoA11yViolations(page);

  // Ausmustern
  await page.getByRole("button", { name: "Ausmustern" }).click();
  await page
    .getByRole("combobox", { name: /^Grund/ })
    .selectOption({ label: "defekt" });
  await page
    .getByRole("combobox", { name: /^Verbleib/ })
    .selectOption({ label: "entsorgt" });
  await page.getByRole("button", { name: "Weiter" }).click();
  await confirmDialog(page, "Ausmustern", true);
  await expect(
    page.getByRole("heading", { name: "Ausgemustert" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Verlauf
  await page.getByRole("link", { name: "Verlauf", exact: true }).click();
  await expect(page.getByText(/^Ausgemustert am/)).toBeVisible();
  await expect(page.getByText("Von Hand erfasst")).toBeVisible();
  await expectNoA11yViolations(page);

  // Liste: unter „Ausgemustert“ zu finden
  await page.goto("/bestand/hardware");
  await chooseStatus(page, "Status", "Ausgemustert");
  await page.getByLabel("Geräte durchsuchen").fill(stamp);
  await expect(page.getByRole("link", { name })).toBeVisible();
  await expectNoA11yViolations(page);

  // Stammdaten
  await page.goto("/bestand/stammdaten");
  await expect(
    page.getByRole("heading", { level: 1, name: "Stammdaten" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Lesende ändern nichts, ohne Rolle gibt es den Bereich nicht", async ({
  page,
}) => {
  await loginAs(page, ["Bestand.Reader"], "Lisa Lesen");
  await page.goto("/bestand/hardware");
  await expect(
    page.getByRole("heading", { level: 1, name: "Hardware" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Gerät erfassen" }),
  ).toHaveCount(0);
  await expectNoA11yViolations(page);

  await loginAs(page, ["Budget.Reader"], "Bea Budget");
  await page.goto("/bestand/hardware");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  const api = await page.request.get("/api/inventory/hardware");
  expect(api.status()).toBe(403);
});

test("IT-Bestand: Standorte anlegen und Etage öffnen", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/bestand/standorte");
  await expect(
    page.getByRole("heading", { level: 1, name: "Standorte" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  const tree = page.getByRole("navigation", { name: "Standorte" });
  // Schmal steht der Baum hinter „Standort wechseln“.
  const openTree = async () => {
    const toggle = page.getByRole("button", { name: "Standort wechseln" });
    if (await toggle.isVisible()) {
      await toggle.click();
    }
  };

  // Neue Stadt: ohne Standorte im leeren Zustand, sonst unten im Baum
  const empty = page.getByRole("region", { name: "Noch keine Standorte" });
  const toggle = page.getByRole("button", { name: "Standort wechseln" });
  await expect(empty.or(tree).or(toggle).first()).toBeVisible();
  if (await empty.isVisible()) {
    await empty.getByLabel("Neue Stadt").fill(`Stadt ${stamp}`);
    await empty.getByRole("button", { name: "Anlegen" }).click();
  } else {
    await openTree();
    await tree.locator("summary", { hasText: "Neue Stadt" }).click();
    await tree.getByLabel("Neue Stadt").fill(`Stadt ${stamp}`);
    await tree.getByRole("button", { name: "Anlegen" }).click();
  }
  await tree.getByRole("link", { name: new RegExp(`^Stadt ${stamp}`) }).click();
  await expect(page).toHaveURL(/\/bestand\/standorte\/stadt\/\d+$/);

  // Darunter jeweils dort anlegen, wo man gerade ist
  const steps: [string, string][] = [
    ["Neuer Standort", `Haus ${stamp}`],
    ["Neuer Gebäudeabschnitt", `Bauteil ${stamp}`],
  ];
  for (const [label, name] of steps) {
    const level = page.getByRole("main").getByRole("region").first();
    await level.getByLabel(label).fill(name);
    await level.getByRole("button", { name: "Anlegen" }).click();
    await level.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 2, name, exact: true }),
    ).toBeVisible();
  }
  await expectNoA11yViolations(page);
  const section = page.getByRole("main").getByRole("region").first();
  await section.getByLabel("Neue Etage").fill(`Etage ${stamp}`);
  await section.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/standorte\/etage\/\d+$/);
  await expect(
    page.getByRole("heading", { level: 2, name: `Etage ${stamp}` }),
  ).toBeVisible();
  await expect(page.getByText("Noch kein Grundriss")).toBeVisible();
  await expect(
    page.getByRole("link", { name: `Bauteil ${stamp}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Etage bearbeiten" }).click();
  await expect(
    page.getByRole("button", { name: "Grundriss hochladen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Grundriss quer hochladen und hochkant drehen: Räume drehen mit, gespeichert wird ungedreht
  const floorId = new URL(page.url()).pathname.split("/").pop();
  await page.getByRole("button", { name: "Grundriss hochladen" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "grundriss.png",
    mimeType: "image/png",
    buffer: png(200, 100),
  });
  const plan = page.getByRole("group", { name: `Grundriss Etage ${stamp}` });
  await expect(plan).toHaveAttribute("style", /aspect-ratio: 200 \/ 100/);
  await page
    .getByRole("combobox", { name: "Ausrichtung des Grundrisses" })
    .selectOption({ label: "90° nach rechts gedreht" });
  await expect(
    page.getByText("Die Ausrichtung des Grundrisses ist gespeichert."),
  ).toBeVisible();
  await expect(plan).toHaveAttribute("style", /aspect-ratio: 100 \/ 200/);
  await expect(plan.locator("img")).toHaveClass(/plan-image-turn-90/);
  const stored = await page.request.get(`/api/inventory/floors/${floorId}`);
  expect(
    ((await stored.json()) as { plan: { rotation: number } }).plan.rotation,
  ).toBe(90);
  await expectNoA11yViolations(page);

  // Breit lässt sich der Baum ausblenden; Ebenen klappen auf und zu.
  // (Schmal, auch am Tablet neben dem Menü, steht der Baum hinter „Standort wechseln“.)
  if (
    !(await page.getByRole("button", { name: "Standort wechseln" }).isVisible())
  ) {
    await tree
      .getByRole("button", { name: `Bauteil ${stamp} zuklappen` })
      .click();
    await expect(
      tree.getByRole("link", { name: new RegExp(`^Etage ${stamp}`) }),
    ).toHaveCount(0);
    // Ansicht: ausführlich mit Kennzahlen, kompakt in einer Zeile
    await expect(
      tree.getByRole("link", { name: new RegExp(`^Bauteil ${stamp}`) }),
    ).toContainText("1 Etage");
    await tree.getByRole("button", { name: "Kompakt" }).click();
    await expect(tree).toHaveAttribute("data-view", "kompakt");
    await expectNoA11yViolations(page);
    await tree.getByRole("button", { name: "Ausführlich" }).click();
    await tree.getByRole("button", { name: "Alles einklappen" }).click();
    await expect(
      tree.getByRole("link", { name: new RegExp(`^Bauteil ${stamp}`) }),
    ).toHaveCount(0);
    await tree.getByRole("button", { name: "Standortbaum ausblenden" }).click();
    await expect(tree).toBeHidden();
    await page.getByRole("button", { name: "Standortbaum einblenden" }).click();
    await expect(tree).toBeVisible();
  }
});

test("IT-Bestand: Stelle und Arbeitsplatz anlegen", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");

  // Abteilung in den Stammdaten
  await page.goto("/bestand/stammdaten");
  await page.getByRole("button", { name: "Abteilungen" }).click();
  await page.getByLabel("Neue Abteilung").fill(`Abteilung ${stamp}`);
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText(`Abteilung ${stamp}`)).toBeVisible();
  await expectNoA11yViolations(page);

  // Stelle ohne Person
  await page.goto("/bestand/stellen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Stellen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stelle anlegen" }).click();
  await page.getByLabel("Bezeichnung", { exact: true }).fill(`Stelle ${stamp}`);
  await page
    .getByRole("combobox", { name: /^Abteilung/ })
    .selectOption({ label: `Abteilung ${stamp}` });
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Stelle anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/stellen\/\d+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: `Stelle ${stamp}` }),
  ).toBeVisible();
  const positionUrl = new URL(page.url()).pathname;
  await expect(
    page.getByText("Unbesetzt", { exact: false }).first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Ein Raum für den Arbeitsplatz (der Raum ist beim Anlegen Pflicht)
  const headers = { Origin: new URL(BASE_URL).origin };
  const post = async (url: string, data: object) => {
    const response = await page.request.post(`/api/inventory/${url}`, {
      data,
      headers,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const cities = await post("cities", { name: `Ort ${stamp}` });
  const city = cities.cities.find(
    (entry: { name: string }) => entry.name === `Ort ${stamp}`,
  );
  const sites = await post("sites", {
    name: `Gebäude ${stamp}`,
    city_id: city.id,
  });
  const site = sites.cities.find(
    (entry: { id: number }) => entry.id === city.id,
  ).sites[0];
  const sections = await post("sections", {
    name: `Teil ${stamp}`,
    site_id: site.id,
  });
  const section = sections.cities.find(
    (entry: { id: number }) => entry.id === city.id,
  ).sites[0].sections[0];
  const floor = await post("floors", {
    name: "EG",
    section_id: section.id,
    position: 0,
  });
  await post(`floors/${floor.id}/rooms`, {
    name: `R ${stamp}`,
    x: 10,
    y: 10,
    w: 30,
    h: 30,
  });

  // Arbeitsplatz mit der Stelle
  await page.goto("/bestand/arbeitsplaetze");
  await expect(
    page.getByRole("heading", { level: 1, name: "Arbeitsplätze" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  const form = page.getByRole("region", { name: "Arbeitsplatz anlegen" });
  // Ohne Raum geht es nicht
  await form.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  await expect(form.getByText("Bitte wähle einen Raum.")).toBeVisible();
  await form
    .getByRole("combobox", { name: "Raum" })
    .fill(`R ${stamp}`);
  await form
    .getByRole("option", { name: new RegExp(`Raum R ${stamp}`) })
    .click();
  await expect(form.getByText(/keinen Grundriss/)).toBeVisible();
  await form
    .getByRole("combobox", { name: "Stelle hinzufügen" })
    .fill(`Stelle ${stamp}`);
  await form
    .getByRole("option", { name: new RegExp(`Stelle ${stamp}`) })
    .click();
  await expectNoA11yViolations(page);
  await form.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/arbeitsplaetze\/\d+$/);
  await expect(
    page.getByRole("link", { name: new RegExp(`Stelle ${stamp}`) }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: "Ausstattung", exact: true }).click();
  await expect(page.getByText(/Keine Vorlage gewählt/)).toBeVisible();
  await expectNoA11yViolations(page);

  // Ein Monitor am Arbeitsplatz steht bei der Stelle unter „Über Arbeitsplätze“
  const workplaceId = Number(new URL(page.url()).pathname.split("/")[3]);
  const master = await (
    await page.request.get("/api/inventory/master-data")
  ).json();
  const kind = master.kinds.find(
    (entry: { name: string }) => entry.name === "Monitor",
  );
  await post("hardware", {
    kind_id: kind.id,
    name: `Monitor ${stamp}`,
    workplace_id: workplaceId,
  });
  await page.goto(positionUrl);
  await page
    .getByRole("navigation", { name: "Bereiche der Stelle" })
    .getByRole("link", { name: "Hardware", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Direkt an der Stelle \(0\)/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Über Arbeitsplätze \(1\)/ }),
  ).toBeVisible();
  await expect(
    page.getByText("über Arbeitsplatz", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: `Monitor ${stamp}` }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Pool-Arbeitsplatz im selben Raum: Zweck Pflicht, keine Stellen
  await page.goto("/bestand/arbeitsplaetze");
  await page.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  const poolForm = page.getByRole("region", { name: "Arbeitsplatz anlegen" });
  await poolForm
    .getByRole("combobox", { name: "Raum" })
    .fill(`R ${stamp}`);
  await poolForm
    .getByRole("option", { name: new RegExp(`Raum R ${stamp}`) })
    .click();
  await poolForm
    .getByRole("button", { name: "Pool-Arbeitsplatz", exact: true })
    .click();
  await expect(
    poolForm.getByRole("combobox", { name: "Stelle hinzufügen" }),
  ).toHaveCount(0);
  await poolForm.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  await expect(poolForm.getByText("Bitte wähle den Zweck.")).toBeVisible();
  await poolForm
    .getByRole("combobox", { name: /^Zweck/ })
    .selectOption({ label: "Desk-Sharing" });
  await expectNoA11yViolations(page);
  await poolForm.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
  await expect(page).toHaveURL(/\/bestand\/arbeitsplaetze\/\d+$/);
  await expect(
    page.getByText("Pool-Arbeitsplatz", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Desk-Sharing", { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Vorgänge und Technik ohne NinjaOne", async ({ page }) => {
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/bestand/vorgaenge");
  await expect(
    page.getByRole("heading", { level: 1, name: "Vorgänge" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Der Abgleich mit NinjaOne ist ausgeschaltet/),
  ).toBeVisible();
  // Suche und Filter stehen über der Tabelle; am Handy der Status als Auswahl und die Art
  // unter „Weitere Filter“.
  await expect(
    page.getByRole("searchbox", { name: "Vorgänge durchsuchen" }),
  ).toBeVisible();
  if (isPhone(page)) {
    await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
  } else {
    await expect(page.getByRole("group", { name: "Status" })).toBeVisible();
  }
  await chooseFilter(page, "Art", "Rückgabe prüfen");
  await expect(
    page
      .getByRole("button", {
        name: /^(Weitere Filter 1 geändert|Filter aufheben)$/,
      })
      .first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Verleih ansehen und neuen Verleih öffnen", async ({
  page,
}) => {
  await loginAs(page, ["Bestand.Editor"], "Bernd Bestand");
  await page.goto("/bestand/verleih");
  await expect(
    page.getByRole("heading", { level: 1, name: "Verleih" }),
  ).toBeVisible();
  const wide = (page.viewportSize()?.width ?? 1280) >= 1024;
  await expect(page.getByText("Wähle links einen Verleih.")).toBeVisible({
    visible: wide,
  });
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Neuer Verleih" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Neuer Verleih" }),
  ).toBeVisible();
  await expect(page.getByLabel("Rückgabe bis")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Bestand: Statistik", async ({ page }) => {
  await loginAs(page, ["Bestand.Reader"], "Lena Leser");
  await page.goto("/bestand/statistik");
  await expect(
    page.getByRole("heading", { level: 1, name: "Statistik" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Hersteller" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Abteilung" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Aktive Geräte\s*:\s*\d+/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Geräte je Art" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  // Eine Kennzahl öffnet ihren Bereich
  await page.getByRole("button", { name: /^Verliehen\s*:/ }).click();
  await expect(page.getByRole("heading", { name: "Rückgabe" })).toBeVisible();
  await expect(page).toHaveURL(/bereich=verleih/);
  for (const name of [
    "Alter & Erneuerung",
    "Standorte & Arbeitsplätze",
    "Ausmusterung",
    "Datenqualität",
  ]) {
    await page
      .getByRole("navigation", { name: "Bereiche der Statistik" })
      .getByRole("button", { name })
      .click();
    await expectNoA11yViolations(page);
  }
  await expect(
    page.getByRole("heading", { name: "Fehlende Angaben" }),
  ).toBeVisible();
});

/** Ein einfarbiges PNG in der gewünschten Größe (für Grundrisse). */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bittiefe
  header[9] = 0; // Graustufen
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0xdd)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
