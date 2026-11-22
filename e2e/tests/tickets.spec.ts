import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

// Tickets, Phase 1: Bereiche mit Rollen (Gruppen aus der Testquelle), Sichtbarkeit,
// Status und Zuständigkeit erst nach „Bestätigen“, interne Notizen, Einstellungen.

const HEADERS = { Origin: new URL(BASE_URL).origin };

/** Auf Tablet und Handy stehen die Angaben eingeklappt unter „Angaben“. */
async function openFacts(page: Page): Promise<void> {
  const toggle = page.locator("details.ticket-facts-toggle");
  if (
    (await toggle.count()) > 0 &&
    !(await toggle.evaluate((el) => (el as HTMLDetailsElement).open))
  ) {
    await toggle.locator("summary").click();
  }
}

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
  await page.getByRole("button", { name: /^Interne Notiz/ }).click();
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

function rawMail(subject: string, messageId: string, extra = ""): string {
  return (
    `From: M. Muster <m.muster@example.com>\r\nTo: it@example.com\r\nSubject: ${subject}\r\n` +
    `Message-ID: <${messageId}>\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n` +
    "Seit heute früh kommen nur leere Seiten.\r\n"
  );
}

async function areaId(api: APIRequestContext, name: string): Promise<number> {
  const me = (await (await api.get("/api/tickets/me")).json()) as {
    areas: { id: number; name: string }[];
  };
  const found = me.areas.find((area) => area.name === name);
  expect(found).toBeTruthy();
  return found?.id ?? 0;
}

test("Tickets: Mail wird Ticket, Antwort landet im selben Ticket, Notiz erzeugt keine Mail", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  const editor = await apiAs(browser, ["Tickets.Nutzer"], s.editor);
  const area = await areaId(editor, s.areaName);

  const first = await editor.post("/api/tickets/test/mail", {
    data: {
      area_id: area,
      raw: rawMail(`Bildschirm flackert ${stamp}`, `m1-${stamp}@example.com`),
    },
    headers: HEADERS,
  });
  const created = (await first.json()) as {
    result: string;
    ticket_number: number;
  };
  expect(created.result).toBe("neu");
  const number = created.ticket_number;

  // Antwort über die Nummer im Betreff
  const reply = await editor.post("/api/tickets/test/mail", {
    data: {
      area_id: area,
      raw: rawMail(`AW: [#T-${number}] Bildschirm`, `m2-${stamp}@example.com`),
    },
    headers: HEADERS,
  });
  expect(
    ((await reply.json()) as { ticket_number: number }).ticket_number,
  ).toBe(number);

  await loginAs(page, ["Tickets.Nutzer"], s.editor);
  await page.goto(`/tickets/${number}`);
  await expect(page.getByText("vom Melder").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Original-Mail/ }).first(),
  ).toBeVisible();

  // Interne Notiz: keine Mail
  await page.getByRole("button", { name: /^Interne Notiz/ }).click();
  await page
    .getByRole("textbox", { name: /^Interne Notiz/ })
    .fill("Nur für uns");
  await page.getByRole("button", { name: "Interne Notiz speichern" }).click();
  await expect(page.getByText("Nur für uns")).toBeVisible();
  let outbox = (await (
    await editor.get("/api/tickets/test/outbox", { params: { ticket: number } })
  ).json()) as { kind: string }[];
  expect(outbox).toEqual([]);

  // Antwort an den Melder
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  await expect(
    page.getByText("Geht per E-Mail an: m.muster@example.com"),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page
    .getByRole("textbox", { name: /Antwort an M. Muster/ })
    .fill("Bitte einmal neu starten.");
  await page
    .getByLabel("Status danach")
    .selectOption({ label: "Wartet auf Rückmeldung" });
  await page.getByRole("button", { name: "An M. Muster senden" }).click();
  await expect(page.getByText("an Melder gesendet")).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue("waiting");
  outbox = (await (
    await editor.get("/api/tickets/test/outbox", { params: { ticket: number } })
  ).json()) as { kind: string }[];
  expect(outbox.map((mail) => mail.kind)).toEqual(["antwort"]);

  // Weiterleiten: interner Eintrag, Melder bekommt nichts
  await page
    .getByRole("button", { name: "Weiterleiten", exact: true })
    .first()
    .click();
  const panel = page.getByRole("region", { name: /Weiterleiten:/ });
  await panel.getByLabel(/^An/).fill("service@example.com");
  await panel.getByLabel(/Text dazu/).fill("Bitte prüfen.");
  // Am Seitenende liegt die Antwortleiste an ihrem Platz und verdeckt keine Knöpfe.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoA11yViolations(page);
  await panel.getByRole("button", { name: "Weiterleiten" }).click();
  await expect(
    page.getByText("Weitergeleitet an service@example.com").first(),
  ).toBeVisible();
  outbox = (await (
    await editor.get("/api/tickets/test/outbox", { params: { ticket: number } })
  ).json()) as { kind: string }[];
  expect(outbox.map((mail) => mail.kind)).toEqual(["antwort", "weiterleitung"]);
});

test("Tickets: Mail an ein geschlossenes Ticket je nach Einstellung", async ({
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  const editor = await apiAs(browser, ["Tickets.Nutzer"], s.editor);
  const area = await areaId(editor, s.areaName);
  const number = s.number;
  // Ticket schließen
  const closed = await editor.patch(`/api/tickets/${number}`, {
    data: {
      expected_status: "new",
      expected_assignee_oid: null,
      status: "closed",
    },
    headers: HEADERS,
  });
  expect(closed.ok()).toBe(true);
  // Vorgabe: innerhalb von 14 Tagen wieder öffnen
  const reopened = await editor.post("/api/tickets/test/mail", {
    data: {
      area_id: area,
      raw: rawMail(`AW: [#T-${number}] x`, `z1-${stamp}@example.com`),
    },
    headers: HEADERS,
  });
  expect(
    ((await reopened.json()) as { ticket_number: number }).ticket_number,
  ).toBe(number);
  expect(
    (
      (await (await editor.get(`/api/tickets/${number}`)).json()) as {
        status: string;
      }
    ).status,
  ).toBe("in_progress");
  // Einstellung „immer neues Ticket“ (Bereichsverwaltung)
  const admin = await apiAs(browser, ["Tickets.Nutzer"], `Ina ${stamp}`);
  const current = (await (
    await admin.get(`/api/tickets/settings/areas/${area}/mail`)
  ).json()) as Record<string, unknown>;
  const keys = [
    "external_policy",
    "max_attachment_mb",
    "allowed_types",
    "processed_days",
    "ignored_days",
    "intake_log_days",
    "review_days",
    "reopen_policy",
    "reopen_days",
    "sender_name",
    "header_title",
    "signature",
    "ack_enabled",
    "ack_text",
    "mail_events",
  ];
  const body = Object.fromEntries(keys.map((key) => [key, current[key]]));
  body.reopen_policy = "new";
  expect(
    (
      await admin.put(`/api/tickets/settings/areas/${area}/mail`, {
        data: body,
        headers: HEADERS,
      })
    ).ok(),
  ).toBe(true);
  await editor.patch(`/api/tickets/${number}`, {
    data: {
      expected_status: "in_progress",
      expected_assignee_oid: null,
      status: "closed",
    },
    headers: HEADERS,
  });
  const fresh = await editor.post("/api/tickets/test/mail", {
    data: {
      area_id: area,
      raw: rawMail(`AW: [#T-${number}] x`, `z2-${stamp}@example.com`),
    },
    headers: HEADERS,
  });
  const result = (await fresh.json()) as {
    ticket_number: number;
    detail: string;
  };
  expect(result.ticket_number).not.toBe(number);
  expect(result.detail).toBe(`Bezug auf T-${number}`);
});

test("Tickets: Einstellungen zur E-Mail und „Letzte Eingänge“", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  const editor = await apiAs(browser, ["Tickets.Nutzer"], s.editor);
  const area = await areaId(editor, s.areaName);
  await editor.post("/api/tickets/test/mail", {
    data: {
      area_id: area,
      raw: rawMail(
        `Abwesend ${stamp}`,
        `o1-${stamp}@example.com`,
        "Auto-Submitted: auto-replied\r\n",
      ),
    },
    headers: HEADERS,
  });
  await loginAs(page, ["Tickets.Nutzer"], `Ina ${stamp}`);
  await page.goto("/tickets/einstellungen/email");
  const panel = page.locator("#inhalt");
  await expect(
    panel.getByRole("combobox", { name: /^Externe Absender/ }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: /^Externe Absender/ })
    .selectOption({ label: "unbekannte erst prüfen" });
  await expect(
    panel.getByRole("spinbutton", {
      name: "„Zu prüfen“ verwerfen nach (Tagen ohne Entscheidung)",
    }),
  ).toHaveValue("30");
  await panel
    .getByRole("spinbutton", {
      name: "„Letzte Eingänge“ ohne Ticket löschen nach (Tagen)",
    })
    .fill("60");
  await panel.getByRole("button", { name: "Speichern" }).first().click();
  await expect(
    page.getByText("Die Einstellungen zur E-Mail wurden gespeichert."),
  ).toBeVisible();
  await expect(
    panel.getByText("Abwesenheitsnotiz oder automatische Antwort", {
      exact: false,
    }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Tickets: Zusammenführen, Textbaustein, ohne Fristen keine Frist", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  const admin = await apiAs(browser, ["Tickets.Nutzer"], `Ina ${stamp}`);
  const editorApi = await apiAs(browser, ["Tickets.Nutzer"], s.editor);
  const id = await areaId(admin, s.areaName);
  const tpl = await admin.post(`/api/tickets/settings/areas/${id}/templates`, {
    data: {
      name: "Drucker gelöst",
      shortcut: "drucker",
      kind: "reply",
      status_after: "solved",
      body: "Hallo {Vorname}, der Drucker läuft wieder.",
    },
    headers: HEADERS,
  });
  expect(tpl.status()).toBe(201);
  const second = await editorApi.post("/api/tickets", {
    data: {
      area_id: id,
      subject: `Drucker immer noch ${stamp}`,
      reporter_name: "M. Muster",
      reporter_mail: "m.muster@example.com",
      channel: "phone",
      body: "Immer noch leere Seiten.",
    },
    headers: HEADERS,
  });
  expect(second.status()).toBe(201);
  const { number: dup } = (await second.json()) as { number: number };

  await loginAs(page, ["Tickets.Nutzer"], s.editor);
  await page.goto(`/tickets/${dup}`);
  await expect(page.getByText("Anruf erfasst")).toBeVisible();
  // Bereich ohne Fristen: nirgends eine Frist
  await expect(page.getByText("Frist", { exact: false })).toHaveCount(0);

  // Textbaustein über /kürzel
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  const field = page.getByRole("textbox", { name: /^Antwort an M. Muster/ });
  await field.fill("/dru");
  await expect(
    page.getByRole("listbox", { name: "Textbausteine" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await field.press("Enter");
  await expect(field).toHaveValue("Hallo M., der Drucker läuft wieder.");
  await expect(page.getByLabel("Status danach")).toHaveValue("solved");
  await page
    .locator("form.ticket-reply-form")
    .getByRole("button", { name: "Einklappen" })
    .click();

  // Zusammenführen mit Bestätigung
  await page
    .getByRole("button", { name: "Zusammenführen", exact: true })
    .click();
  const candidate = page.getByRole("button", {
    name: new RegExp(`T-${s.number} Drucker druckt nicht`),
  });
  await expect(candidate).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Melder benachrichtigen" })
    .uncheck();
  await expectNoA11yViolations(page);
  await candidate.click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog).toContainText("nicht rückgängig");
  await dialog.getByRole("button", { name: "Zusammenführen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "wurde in" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Zusammengeführt in");
  // Abgeschlossen: weder Zusammenführen noch Status ändern
  await expect(
    page.getByRole("button", { name: "Zusammenführen", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Status")).toBeDisabled();
  await page.getByRole("link", { name: `T-${s.number}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${s.number}$`));
  await expect(page.getByText(`aus T-${dup}`).first()).toBeVisible();
  await expect(page.getByText("Immer noch leere Seiten.")).toBeVisible();
});

test("Tickets: Einstellungen für Kategorien, Fristen und Textbausteine", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);
  await loginAs(page, ["Tickets.Nutzer"], `Ina ${stamp}`);
  await page.goto("/tickets/einstellungen/kategorien");
  const panel = page.locator("#inhalt");

  await panel.getByRole("textbox", { name: "Neue Kategorie" }).fill("Drucker");
  await panel.getByRole("button", { name: "Anlegen" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Die Kategorie wurde angelegt." }),
  ).toBeVisible();

  await panel
    .getByRole("checkbox", { name: "Fristen in diesem Bereich verwenden" })
    .check();
  await expect(
    panel.getByRole("textbox", { name: "Lösung bei Hoch in Stunden" }),
  ).toBeVisible();
  // Felder nicht unter der festen Kopfzeile prüfen
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);
  await panel.getByRole("button", { name: "Speichern" }).last().click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Die Fristen wurden gespeichert." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Textbausteine", exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/einstellungen\/textbausteine/);
  await panel.getByRole("button", { name: "Textbaustein anlegen" }).click();
  await panel.getByLabel("Name", { exact: true }).fill("Drucker gelöst");
  await panel.getByLabel("Kürzel (ohne Schrägstrich)").fill("drucker");
  await panel
    .getByLabel("Text", { exact: true })
    .fill("Hallo {Vorname}, erledigt.");
  await expect(panel.getByText("Hallo Max, erledigt.")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);
  await panel.getByRole("button", { name: "Speichern" }).last().click();
  await expect(panel.getByText("/drucker")).toBeVisible();

  // Mit Fristen zeigt das Ticket eine Frist
  await page.goto(`/tickets/${s.number}`);
  await expect(page.getByText("Anruf erfasst")).toBeVisible();
  await openFacts(page);
  await expect(page.getByText(/Lösung bis/)).toBeVisible();
});

test("Tickets: Übersicht, Aufbewahrung mit Ausnahme, Export und Protokoll", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);

  // Übersicht für Mitglieder
  await loginAs(page, ["Tickets.Nutzer"], s.editor);
  await page.goto("/tickets/uebersicht");
  await expect(
    page.getByRole("heading", { level: 1, name: "Übersicht" }),
  ).toBeVisible();
  const tiles = page.getByRole("list", { name: "Kennzahlen" });
  await expect(tiles.getByRole("link", { name: /^Offen/ })).toBeVisible();
  await expect(tiles.getByText("Überfällig")).toHaveCount(0);
  await expectNoA11yViolations(page);
  await expect(
    page.getByRole("link", { name: "Als Excel exportieren" }),
  ).toHaveCount(0);

  // Bereichsverwaltung: eigene Regel mit Vorschau und Bestätigung
  await loginAs(page, ["Tickets.Nutzer"], `Ina ${stamp}`);
  await page.goto("/tickets/einstellungen/aufbewahrung");
  const panel = page.locator("#inhalt");
  await panel.getByRole("radio", { name: "Eigene Regel" }).check();
  await panel
    .getByRole("checkbox", {
      name: "Nach einer Frist anonymisieren oder löschen",
    })
    .check();
  await panel.getByRole("spinbutton", { name: "Nach" }).fill("2");
  await panel.getByRole("combobox", { name: "Einheit" }).selectOption("years");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);
  await panel.getByRole("button", { name: "Speichern" }).last().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "2 Jahre nach dem Schließen anonymisieren",
  );
  await expect(dialog).toContainText("Beim nächsten Lauf betroffen: 0 Tickets");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Die Aufbewahrung des Bereichs wurde gespeichert." }),
  ).toBeVisible();
  await expect(panel.getByText(/Wirksam jetzt: 2 Jahre/)).toBeVisible();

  // Ausnahme am Ticket
  await page.goto(`/tickets/${s.number}`);
  await expect(page.getByText("Anruf erfasst")).toBeVisible();
  await openFacts(page);
  await expect(
    page.getByText("2 Jahre nach dem Schließen anonymisieren"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ausnahme setzen" }).click();
  await page.getByLabel("Begründung (Pflicht)").fill("Gewährleistung");
  await page
    .getByRole("complementary", { name: "Angaben zum Ticket" })
    .getByRole("button", { name: "Speichern" })
    .click();
  await expect(page.getByText(/Ausnahme bis/)).toBeVisible();
  await expect(page.getByText(/Gewährleistung/)).toBeVisible();
  await expectNoA11yViolations(page);

  // Export nur für die Bereichsverwaltung
  await page.goto("/tickets?ansicht=all");
  const link = page.getByRole("link", { name: "Als Excel exportieren" });
  await expect(link).toHaveAttribute(
    "href",
    /\/api\/tickets\/export\?view=all/,
  );
  const file = await page.request.get((await link.getAttribute("href")) ?? "");
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain("attachment");

  // Rollen und Protokoll im Reiter „Rollen“
  await page.goto("/tickets/einstellungen/rollen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Einstellungen" }),
  ).toBeVisible();
  const log = page.getByRole("region", { name: "Protokoll" });
  await expect(log.getByText("Export als Excel").first()).toBeVisible();
  await expect(log.getByText("Ausnahme gesetzt").first()).toBeVisible();
  await expect(
    log.getByText("Aufbewahrung des Bereichs geändert").first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Rollen", exact: true })
      .getByText(s.areaName),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Tickets: Melder im IT-Bestand nur mit Rechten dort; Melder frei eintragbar", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`.replace(/\s+/g, "-");
  const s = await setup(browser, stamp);

  await loginAs(page, ["Tickets.Nutzer"], s.editor);
  await page.goto(`/tickets/${s.number}`);
  await expect(page.getByText("Anruf erfasst")).toBeVisible();
  await expect(page.getByText("Im IT-Bestand", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Gerät verknüpfen")).toHaveCount(0);

  await loginAs(page, ["Tickets.Nutzer", "Bestand.Reader"], s.editor);
  await page.goto(`/tickets/${s.number}`);
  await expect(page.getByText("Anruf erfasst")).toBeVisible();
  await openFacts(page);
  await expect(page.getByText("Im IT-Bestand", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Keine Stelle im IT-Bestand gefunden."),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Neues Ticket: Name frei eintragbar, auch ohne Vorschläge aus Entra
  await page.goto("/tickets/neu");
  await page.getByLabel("Name des Melders").fill("Paul Beispiel");
  await expect(page.getByLabel("Name des Melders")).toHaveValue(
    "Paul Beispiel",
  );
  await expectNoA11yViolations(page);
});
