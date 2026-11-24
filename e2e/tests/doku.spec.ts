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

  // Schreiben: live verbunden, wird automatisch gespeichert
  await expect(
    page.getByText("Live · wird automatisch gespeichert"),
  ).toBeVisible({
    timeout: 10_000,
  });
  const content = page.getByRole("textbox", { name: "Inhalt der Seite" });
  await content.click();
  await content.pressSequentially("Toner liegt im Lager.");
  // Baustein über „/“
  await content.press("End");
  await content.press("Enter");
  await content.press("/");
  const blocks = page.getByRole("combobox", { name: "Baustein suchen" });
  await blocks.fill("Aufgaben");
  await blocks.press("Enter");
  await content.pressSequentially("Toner bestellen");
  await expect(content.getByRole("checkbox")).toHaveCount(1);
  // Der Server speichert kurz nach der letzten Änderung
  await expect
    .poll(
      async () =>
        JSON.stringify(
          (
            (await (
              await page.request.get(`/api/doku/pages/${pageId}`)
            ).json()) as {
              content: unknown;
            }
          ).content,
        ),
      { timeout: 10_000 },
    )
    .toContain("Toner bestellen");
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

test("Doku: zwei Personen schreiben gleichzeitig, Lesen sieht live mit", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  const editor = await apiAs(browser, ["Doku.Nutzer"], s.editor);
  const created = await editor.post("/api/doku/pages", {
    data: { space_id: s.spaceId, parent_id: null, title: `Gemeinsam ${stamp}` },
    headers: HEADERS,
  });
  const id = ((await created.json()) as { id: string }).id;
  const admin = await apiAs(browser, ["Doku.Admin"], s.admin);
  const second = `Max ${stamp}`;
  await admin.put(`/api/doku/admin/spaces/${s.spaceId}`, {
    data: {
      name: s.space,
      description: "",
      archived: false,
      members: [
        { oid: `test:${slug(s.editor)}`, name: s.editor, role: "manage" },
        { oid: `test:${slug(second)}`, name: second, role: "edit" },
        { oid: `test:${slug(s.reader)}`, name: s.reader, role: "read" },
      ],
    },
    headers: HEADERS,
  });

  await loginAs(page, ["Doku.Nutzer"], s.editor);
  await page.goto(`/doku/seite/${id}`);
  const otherContext = await browser.newContext({ baseURL: BASE_URL });
  const other = await otherContext.newPage();
  await loginAs(other, ["Doku.Nutzer"], second);
  await other.goto(`/doku/seite/${id}`);
  const readerContext = await browser.newContext({ baseURL: BASE_URL });
  const reader = await readerContext.newPage();
  await loginAs(reader, ["Doku.Nutzer"], s.reader);
  await reader.goto(`/doku/seite/${id}`);

  const mine = page.getByRole("textbox", { name: "Inhalt der Seite" });
  const theirs = other.getByRole("textbox", { name: "Inhalt der Seite" });
  await mine.click();
  await mine.pressSequentially("Von Ina.");
  await expect(theirs).toContainText("Von Ina.");
  await theirs.click();
  await theirs.press("End");
  await theirs.pressSequentially(" Von Max.");
  await expect(mine).toContainText("Von Max.");
  // Lesen: sieht beides, ohne Eingabefeld
  const view = reader.getByRole("document", { name: "Inhalt der Seite" });
  await expect(view).toContainText("Von Ina.");
  await expect(view).toContainText("Von Max.");
  // Anwesenheit
  await expect(
    page.getByRole("list", { name: "Gerade auf der Seite" }).getByText(second),
  ).toBeAttached();
  await expectNoA11yViolations(page);
  await otherContext.close();
  await readerContext.close();
});

test("Doku D3: Verweis, Live-Baustein, Kommentar mit Erwähnung und Rückverweis", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  // Erwähnen lassen sich Personen, die die Werkbank kennt (schon einmal angemeldet)
  await apiAs(browser, ["Doku.Nutzer"], s.reader);
  const projects = await apiAs(browser, ["Projekte.Editor"], `Pia ${stamp}`);
  const projectName = `Druckerumstellung ${stamp}`;
  const created = await projects.post("/api/projects", {
    data: { name: projectName },
    headers: HEADERS,
  });
  expect(created.status()).toBe(201);
  const projectId = ((await created.json()) as { id: number }).id;

  const editor = await apiAs(
    browser,
    ["Doku.Nutzer", "Projekte.Reader"],
    s.editor,
  );
  const made = await editor.post("/api/doku/pages", {
    data: { space_id: s.spaceId, title: `Umstellung ${stamp}` },
    headers: HEADERS,
  });
  const pageId = ((await made.json()) as { id: string }).id;

  await loginAs(page, ["Doku.Nutzer", "Projekte.Reader"], s.editor);
  await page.goto(`/doku/seite/${pageId}`);
  await expect(
    page.getByText("Live · wird automatisch gespeichert"),
  ).toBeVisible({ timeout: 10_000 });
  const content = page.getByRole("textbox", { name: "Inhalt der Seite" });
  await content.click();
  await content.pressSequentially("Toner bis Freitag bestellen.");
  await content.press("Enter");
  await content.pressSequentially("Projekt: ");

  // Verweis auf das Projekt
  await page
    .getByRole("button", { name: "Verweis auf Ticket, Gerät, Projekt …" })
    .click();
  const picker = page.getByRole("dialog", { name: "Verweis einfügen" });
  await picker.getByLabel("Art").selectOption("projekt");
  await picker.getByLabel("Suchen").fill(projectName);
  await picker.getByRole("button", { name: new RegExp(projectName) }).click();
  await expect(
    content.getByRole("link", { name: new RegExp(projectName) }),
  ).toBeVisible();

  // Live-Baustein „Projektstand“ über „/“ in einer neuen Zeile
  await content.press("End");
  await content.press("Enter");
  await content.press("/");
  const blocks = page.getByRole("combobox", { name: "Baustein suchen" });
  await blocks.fill("Live");
  await blocks.press("Enter");
  const form = page.getByRole("form", { name: "Live-Baustein einfügen" });
  await form.getByRole("radio", { name: "Projektstand" }).check();
  await form
    .getByRole("combobox", { name: /^Projekt/ })
    .selectOption({ label: projectName });
  await form.getByRole("button", { name: "Einfügen" }).click();
  await expect(
    page.getByRole("region", { name: "Live-Baustein: Projektstand" }),
  ).toContainText("0 von 0 Aufgaben erledigt");

  // Kommentar an einer Textstelle mit Erwähnung
  await page.getByText("Toner bis Freitag bestellen.").click();
  await content.press("Home");
  await content.press("Shift+End");
  const narrow = await page
    .getByRole("button", { name: /^Kommentare · / })
    .isVisible();
  if (narrow) {
    await page.getByRole("button", { name: /^Kommentare · / }).click();
  }
  const panel = page.getByRole("region", { name: /^Kommentare/ });
  await panel.getByRole("button", { name: "Kommentieren" }).click();
  const field = panel.getByLabel("Neuer Kommentar");
  await field.fill(`Bitte prüfen @${s.reader.slice(0, 3)}`);
  await panel.getByRole("button", { name: s.reader }).click();
  await expect(field).toHaveValue(`Bitte prüfen @${s.reader} `);
  await panel.getByRole("button", { name: "Kommentar speichern" }).click();
  await expect(page.getByText("Der Kommentar ist gespeichert.")).toBeVisible();
  await expect(panel.getByText("Offen · 1")).toBeVisible();
  await expectNoA11yViolations(page);
  const threads = (await (
    await page.request.get(`/api/doku/pages/${pageId}/threads`)
  ).json()) as { comments: { mentions: string[] }[] }[];
  expect(threads[0]?.comments[0]?.mentions).toEqual([`test:${slug(s.reader)}`]);

  // Umgekehrt: Das Projekt zeigt die Seite unter „In der Dokumentation“
  await page.goto(`/projekte/${projectId}`);
  const backlinks = page.getByRole("region", { name: /In der Dokumentation/ });
  await expect(
    backlinks.getByRole("link", { name: `Umstellung ${stamp}` }),
  ).toBeVisible();

  // Wer lesen darf, antwortet; ohne Projektrechte steht beim Verweis „Kein Zugriff“
  await loginAs(page, ["Doku.Nutzer"], s.reader);
  await page.goto(`/doku/seite/${pageId}`);
  await expect(page.getByText("Kein Zugriff").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole("region", { name: "Live-Baustein: Projektstand" }),
  ).toContainText("keine Rechte");
  if (narrow) {
    await page.getByRole("button", { name: /^Kommentare · / }).click();
  }
  const readerPanel = page.getByRole("region", { name: /^Kommentare/ });
  await readerPanel.getByRole("button", { name: "Antworten" }).click();
  await readerPanel.getByLabel("Antwort").fill("Erledigt, danke.");
  await readerPanel
    .getByRole("button", { name: "Antworten", exact: true })
    .click();
  await expect(readerPanel.getByText("Erledigt, danke.")).toBeVisible();
  await readerPanel
    .getByRole("button", { name: "Erledigt", exact: true })
    .click();
  await expect(readerPanel.getByText("Offen · 0")).toBeVisible();
  await expectNoA11yViolations(page);
});
