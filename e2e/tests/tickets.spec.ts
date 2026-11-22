import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

// Tickets, Phase 1: Bereiche mit Rollen (Gruppen aus der Testquelle), Sichtbarkeit,
// Status und Zuständigkeit erst nach „Bestätigen“, interne Notizen, Einstellungen.

const HEADERS = { Origin: new URL(BASE_URL).origin };

function slug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

/** Eigener Kontext, angemeldet mit den Rollen (für Vorbereitung über die API). */
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

async function membership(
  api: APIRequestContext,
  group: string,
  name: string,
  member = true,
) {
  const response = await api.post("/api/tickets/test/membership", {
    data: { group_oid: group, oid: `test:${slug(name)}`, name, member },
    headers: HEADERS,
  });
  expect(response.ok()).toBe(true);
}

interface Setup {
  areaName: string;
  otherName: string;
  editor: string;
  other: string;
  group: string;
  number: number;
}

/** Zwei Bereiche: Gruppe mit „Bearbeiten“ im ersten, andere Person im zweiten; ein Ticket. */
async function setup(browser: Browser, stamp: string): Promise<Setup> {
  const manager = await apiAs(browser, ["Tickets.Verwaltung"], `Vera ${stamp}`);
  const editor = `Max ${stamp}`;
  const other = `Hans ${stamp}`;
  const group = randomUUID();
  const areaName = `IT ${stamp}`;
  const otherName = `Haustechnik ${stamp}`;
  const created = await manager.post("/api/tickets/settings/areas", {
    data: {
      name: areaName,
      mailbox: "it@example.com",
      admin: {
        role: "admin",
        kind: "person",
        oid: `test:${slug(`Ina ${stamp}`)}`,
        name: `Ina ${stamp}`,
      },
    },
    headers: HEADERS,
  });
  expect(created.status()).toBe(201);
  const area = (await created.json()) as { id: number };
  const grant = await manager.post(
    `/api/tickets/settings/areas/${area.id}/grants`,
    {
      data: { role: "edit", kind: "group", oid: group, name: "IT-Team" },
      headers: HEADERS,
    },
  );
  expect(grant.status()).toBe(201);
  const second = await manager.post("/api/tickets/settings/areas", {
    data: {
      name: otherName,
      admin: {
        role: "admin",
        kind: "person",
        oid: `test:${slug(other)}`,
        name: other,
      },
    },
    headers: HEADERS,
  });
  expect(second.status()).toBe(201);
  await membership(manager, group, editor);
  const editorApi = await apiAs(browser, ["Tickets.Nutzer"], editor);
  const ticket = await editorApi.post("/api/tickets", {
    data: {
      area_id: area.id,
      subject: `Drucker druckt nicht ${stamp}`,
      reporter_name: "M. Muster",
      reporter_mail: "m.muster@example.com",
      channel: "phone",
      body: "Seit heute früh kommen nur leere Seiten.",
    },
    headers: HEADERS,
  });
  expect(ticket.status()).toBe(201);
  const { number } = (await ticket.json()) as { number: number };
  return { areaName, otherName, editor, other, group, number };
}

test("Tickets: Status und Zuständigkeit gelten erst nach „Bestätigen“, Notiz bleibt intern", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  await loginAs(page, ["Tickets.Nutzer"], s.editor);

  await page.goto("/tickets");
  await expect(
    page.getByRole("heading", { level: 1, name: "Alle Tickets" }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Tickets durchsuchen" })
    .fill(`T-${s.number}`);
  const link = page.getByRole("link", { name: new RegExp(`T-${s.number}`) });
  await expect(link).toBeVisible();
  await expectNoA11yViolations(page);
  await link.click();

  await expect(page).toHaveURL(new RegExp(`/tickets/${s.number}$`));
  await expect(page.getByText("Anruf erfasst")).toBeVisible();
  await expectNoA11yViolations(page);

  // Ändern, aber verwerfen: nichts gespeichert
  await page.getByLabel("Status").selectOption({ label: "In Arbeit" });
  await page.getByRole("button", { name: "Mir zuweisen" }).click();
  await expect(
    page.getByText(/Status: Neu → In Arbeit · Zuständig: niemand → Max/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verwerfen" }).click();
  await page.reload();
  await expect(page.getByLabel("Status")).toHaveValue("new");
  await expect(page.getByLabel("Zuständig")).toHaveValue("");

  // Jetzt bestätigen
  await page.getByLabel("Status").selectOption({ label: "In Arbeit" });
  await page.getByRole("button", { name: "Mir zuweisen" }).click();
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Die Änderung wurde gespeichert." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Status")).toHaveValue("in_progress");
  await expect(page.getByText(/Status: Neu → In Arbeit/).first()).toBeVisible();

  // Interne Notiz mit Hinweis
  await page.getByRole("button", { name: /Interne Notiz schreiben/ }).click();
  await expect(
    page.getByText("M. Muster sieht diesen Text nicht und bekommt keine Mail."),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page
    .getByRole("textbox", { name: /^Interne Notiz/ })
    .fill("Toner ist bestellt");
  await page.getByRole("button", { name: "Interne Notiz speichern" }).click();
  await expect(page.getByText("Toner ist bestellt")).toBeVisible();
  await page
    .getByRole("group", { name: "Verlauf filtern" })
    .getByRole("button", { name: "Nur Nachrichten" })
    .click();
  await expect(page.getByText("Toner ist bestellt")).toBeHidden();
});

test("Tickets: fremder Bereich ist nicht sichtbar, auch nicht per Direktaufruf; Gruppe entzogen", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);

  // Person aus dem anderen Bereich
  await loginAs(page, ["Tickets.Nutzer"], s.other);
  await page.goto(`/tickets/${s.number}`);
  await expect(page.getByText(/Dieses Ticket gibt es nicht/)).toBeVisible();
  const api = await page.request.get(`/api/tickets/${s.number}`);
  expect(api.status()).toBe(404);

  // Mitglied verliert die Gruppe: danach kein Zugriff mehr
  const manager = await apiAs(browser, ["Tickets.Verwaltung"], `Vera ${stamp}`);
  const editor = await apiAs(browser, ["Tickets.Nutzer"], s.editor);
  expect((await editor.get(`/api/tickets/${s.number}`)).status()).toBe(200);
  await membership(manager, s.group, s.editor, false);
  expect((await editor.get(`/api/tickets/${s.number}`)).status()).toBe(404);
});

test("Tickets: Einstellungen nur mit Rolle; Ticket-Verwaltung sieht keine Tickets", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);

  await loginAs(page, ["Tickets.Verwaltung"], `Vera ${stamp}`);
  await page.goto("/tickets/einstellungen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Einstellungen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: s.areaName }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  expect((await page.request.get(`/api/tickets/${s.number}`)).status()).toBe(
    404,
  );

  // Ohne Rolle: keine Einstellungen
  const nobody = await apiAs(browser, ["Tickets.Nutzer"], `Nora ${stamp}`);
  expect((await nobody.get("/api/tickets/settings")).status()).toBe(403);
  // Bearbeiten ohne Bereichsverwaltung: auch nicht
  const editor = await apiAs(browser, ["Tickets.Nutzer"], s.editor);
  expect((await editor.get("/api/tickets/settings")).status()).toBe(403);
});
