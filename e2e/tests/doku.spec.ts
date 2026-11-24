import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

// Dokumentation (Phase D1): Arbeitsbereich, Seite anlegen und schreiben (automatisch gespeichert),
// Bausteine, Versionen, eigene Rechte, Sperren, Papierkorb und Verwaltung.

const HEADERS = { Origin: new URL(BASE_URL).origin };

function slug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

async function apiAs(
  browser: Browser,
  roles: string[],
  name: string,
): Promise<APIRequestContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const response = await context.request.post("/auth/test-login", {
    data: { oid: slug(name), name, roles },
    headers: HEADERS,
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  return context.request;
}

interface Setup {
  space: string;
  spaceId: number;
  editor: string;
  reader: string;
  admin: string;
}

async function setup(browser: Browser, stamp: string): Promise<Setup> {
  const s = {
    space: `Doku ${stamp}`,
    editor: `Ina ${stamp}`,
    reader: `Lea ${stamp}`,
    admin: `Ada ${stamp}`,
  };
  const admin = await apiAs(browser, ["Doku.Admin"], s.admin);
  const created = await admin.post("/api/doku/admin/spaces", {
    data: {
      name: s.space,
      description: "Testbereich",
      archived: false,
      members: [
        { oid: `test:${slug(s.editor)}`, name: s.editor, role: "manage" },
        { oid: `test:${slug(s.reader)}`, name: s.reader, role: "read" },
      ],
    },
    headers: HEADERS,
  });
  expect(created.status()).toBe(201);
  return { ...s, spaceId: ((await created.json()) as { id: number }).id };
}

/** Am Handy steht der Seitenbaum hinter „Seiten“. */
async function tree(page: Page) {
  const phone = page.getByRole("button", { name: "Seiten", exact: true });
  if (await phone.isVisible()) {
    await phone.click();
    return page.getByRole("dialog", { name: "Seiten" });
  }
  return page.getByRole("navigation", { name: "Seiten: Dokumentation" });
}

test("Doku: Seite anlegen, schreiben, Versionen, Rechte, Sperren und Papierkorb", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);

  await loginAs(page, ["Doku.Nutzer"], s.editor);
  await page.goto("/doku");
  await expect(
    page.getByRole("heading", { level: 2, name: s.space }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Neue Seite
  await page
    .getByRole("main")
    .getByRole("button", { name: "Neue Seite" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Neue Seite" });
  await dialog.getByLabel("Titel").fill(`Drucker ${stamp}`);
  await dialog.getByLabel("Arbeitsbereich").selectOption({ label: s.space });
  await dialog.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/doku\/seite\/[0-9a-f-]{36}$/);
  const pageUrl = page.url();
  const pageId = pageUrl.split("/").pop() ?? "";

  // Schreiben: wird automatisch gespeichert
  const content = page.getByRole("textbox", { name: "Inhalt der Seite" });
  await content.click();
  await content.pressSequentially("Toner liegt im Lager.");
  await expect(
    page.getByRole("status").filter({ hasText: /^Gespeichert$/ }),
  ).toBeVisible({
    timeout: 10_000,
  });
  // Baustein über „/“
  await content.press("End");
  await content.press("Enter");
  await content.press("/");
  const blocks = page.getByRole("combobox", { name: "Baustein suchen" });
  await blocks.fill("Aufgaben");
  await blocks.press("Enter");
  await content.pressSequentially("Toner bestellen");
  await expect(content.getByRole("checkbox")).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: /^Gespeichert$/ }),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expectNoA11yViolations(page);

  // Im Seitenbaum
  const menu = await tree(page);
  await expect(
    menu.getByRole("link", { name: `Drucker ${stamp}` }),
  ).toBeVisible();
  if ((await menu.getAttribute("role")) === "dialog") {
    await menu.getByRole("button", { name: "Schließen" }).click();
  }

  // Version benennen und ansehen
  await page.getByRole("button", { name: "Aktuellen Stand benennen" }).click();
  await page.getByLabel("Name der Version").fill("Freigegeben");
  await page.getByRole("button", { name: "Benennen" }).click();
  await expect(
    page.getByText("Der Stand wurde als Version gespeichert."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Freigegeben/ }).click();
  await expect(page.getByText("Du siehst eine ältere Version:")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Inhalt der Seite" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Zur aktuellen Fassung" }).click();

  // Eigene Rechte: Lea bekommt keinen Zugriff
  const reader = await apiAs(browser, ["Doku.Nutzer"], s.reader);
  expect((await reader.get(`/api/doku/pages/${pageId}`)).status()).toBe(200);
  await page.getByRole("button", { name: "Rechte und Teilen" }).click();
  const rights = page.getByRole("dialog", { name: "Rechte und Teilen" });
  await rights.getByRole("radio", { name: /Eigene Rechte/ }).check();
  await rights
    .getByLabel(`Recht für ${s.reader}`)
    .selectOption({ label: "Kein Zugriff" });
  await expectNoA11yViolations(page);
  await rights.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Die Rechte wurden gespeichert.")).toBeVisible();
  expect((await reader.get(`/api/doku/pages/${pageId}`)).status()).toBe(404);

  // Sperren und entsperren
  await page.getByRole("button", { name: "Sperren" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sperren" })
    .click();
  await expect(page.getByText(/Gesperrt von/)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Inhalt der Seite" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Entsperren" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Entsperren" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Inhalt der Seite" }),
  ).toBeVisible();

  // Papierkorb (am Handy liegt der Knopf ganz unten: in die Mitte holen)
  // Die Rückmeldung pausiert, solange die Maus darüber steht
  await page.mouse.move(5, 5);
  await expect(page.getByText("Die Seite ist entsperrt.")).toBeHidden({
    timeout: 15_000,
  });
  const trash = page.getByRole("button", { name: "In den Papierkorb" });
  await trash.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await trash.click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "In den Papierkorb" })
    .click();
  await expect(page).toHaveURL(/\/doku$/);

  // Verwaltung: Papierkorb und eigene Rechte
  await loginAs(page, ["Doku.Admin"], s.admin);
  await page.goto("/doku/verwaltung/papierkorb");
  const row = page.getByRole("row", { name: new RegExp(`Drucker ${stamp}`) });
  await expect(row).toBeVisible();
  await expectNoA11yViolations(page);
  await row.getByRole("button", { name: /Wiederherstellen/ }).click();
  await expect(
    page.getByText("Die Seite wurde wiederhergestellt."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Seiten mit eigenen Rechten" }).click();
  await expect(
    page.getByRole("row", { name: new RegExp(`Drucker ${stamp}`) }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Arbeitsbereiche" }).click();
  await expect(
    page.getByRole("row", { name: new RegExp(s.space) }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Doku: ohne Rolle kein Zugriff, Lesen ohne Bearbeiten", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  const editor = await apiAs(browser, ["Doku.Nutzer"], s.editor);
  const created = await editor.post("/api/doku/pages", {
    data: { space_id: s.spaceId, parent_id: null, title: `Anleitung ${stamp}` },
    headers: HEADERS,
  });
  const id = ((await created.json()) as { id: string }).id;

  const nobody = await apiAs(browser, ["Tools.User"], `Nora ${stamp}`);
  expect((await nobody.get("/api/doku/tree")).status()).toBe(403);

  await loginAs(page, ["Doku.Nutzer"], s.reader);
  await page.goto(`/doku/seite/${id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Anleitung ${stamp}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Inhalt der Seite" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sperren" })).toHaveCount(0);
  await expectNoA11yViolations(page);
});
