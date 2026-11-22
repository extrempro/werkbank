import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { areasFor, TICKETS_MEMBER, TICKETS_SETTINGS } from "../../navigation";
import {
  auditDetails,
  exportUrl,
  fillTemplate,
  parseTicketPath,
  retentionText,
  type Entry,
  type Stats,
  type Template,
  type Ticket,
} from "./api";
import { NewTicketPage, parseMails } from "./NewTicketPage";
import { RelatedTickets } from "./RelatedTickets";
import { parseSettingsPath, settingsPath, TicketSettingsPage } from "./TicketSettingsPage";
import {
  changeSummary,
  entryMarker,
  inFuture,
  matchTemplates,
  reminderIso,
  shortcutAt,
  splitEntries,
  TicketPage,
} from "./TicketPage";
import { shareText, tilesOf, TicketsOverviewPage } from "./TicketsOverviewPage";
import { TicketsPage, TicketTable, viewFromUrl } from "./TicketsPage";
import { fromClock, joinMonths, splitMonths, toClock } from "./TicketWorkSettings";
import { ticketNavRoles } from "./useTicketAccess";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function entry(id: string, kind: Entry["kind"], original = false): Entry {
  return {
    id,
    kind,
    body: `Text ${id}`,
    author_name: "Ina Beispiel",
    original,
    created_at: "2026-11-22T08:00:00Z",
    quote: "",
    from_number: null,
    attachments: [],
  };
}

function ticket(extra: Partial<Ticket> = {}): Ticket {
  return {
    number: 1042,
    subject: "Drucker druckt nicht",
    area: { id: 1, name: "IT", role: "edit" },
    status: "new",
    priority: "medium",
    assignee_oid: null,
    assignee_name: "",
    reporter_name: "M. Muster",
    reporter_mail: "m.muster@example.com",
    channel: "phone",
    created_at: "2026-11-22T08:00:00Z",
    updated_at: "2026-11-22T08:00:00Z",
    created_by: "Ina Beispiel",
    participants: [],
    entries: [entry("a", "inbound", true), entry("b", "note"), entry("c", "system")],
    permissions: { edit: true, note: true, assign_any: false, move: true },
    assignees: [
      { oid: "oid-ina", name: "Ina Beispiel" },
      { oid: "oid-max", name: "Max Muster" },
    ],
    move_targets: [],
    me_oid: "oid-ina",
    can_reply: true,
    reply_hint: "",
    category: "",
    reminder_at: null,
    sla_solution_due: null,
    sla_overdue: false,
    category_id: null,
    categories: [],
    reminder_note: "",
    sla: null,
    inventory: false,
    reporter_inventory: null,
    merged_into: null,
    retention: {
      active: false,
      months: 0,
      action: "",
      hold_until: null,
      hold_reason: "",
      hold_by: "",
      can_manage: false,
    },
    anonymized_at: null,
    ...extra,
  };
}

describe("Hilfsfunktionen", () => {
  it("liest die Nummer aus dem Pfad", () => {
    expect(parseTicketPath("/tickets/1042")).toBe(1042);
    expect(parseTicketPath("/tickets/neu")).toBeNull();
    expect(parseTicketPath("/tickets/1042/x")).toBeNull();
  });

  it("teilt den Verlauf: Meldung oben, ältere eingeklappt, letzte vier", () => {
    const entries = [
      entry("o", "inbound", true),
      ...["1", "2", "3", "4", "5", "6"].map((id) => entry(id, "note")),
    ];
    const split = splitEntries(entries, false);
    expect(split.original?.id).toBe("o");
    expect(split.hidden).toBe(2);
    expect(split.shown.map((e) => e.id)).toEqual(["3", "4", "5", "6"]);
    expect(splitEntries(entries, true).hidden).toBe(0);
  });

  it("kennzeichnet Einträge mit Text", () => {
    const t = ticket();
    expect(entryMarker(entry("a", "inbound", true), t)).toBe("Anruf erfasst");
    expect(entryMarker(entry("a", "inbound"), t)).toBe("vom Melder");
    expect(entryMarker(entry("b", "note"), t)).toBe("Intern");
    expect(entryMarker(entry("r", "reply"), t)).toBe("an Melder gesendet");
  });

  it("fasst offene Änderungen zusammen", () => {
    const t = ticket({
      status: "in_progress",
      assignee_oid: "oid-ina",
      assignee_name: "Ina Beispiel",
    });
    expect(changeSummary(t, "solved", "oid-max")).toBe(
      "Status: In Arbeit → Gelöst · Zuständig: Ina Beispiel → Max Muster",
    );
    expect(changeSummary(t, "in_progress", "oid-ina")).toBe("");
  });

  it("liest Mailadressen aus Freitext", () => {
    expect(parseMails("a@example.com, B@example.com;a@example.com\nc@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("zeigt Tickets nur mit Bereich oder Einstellungsrolle in der Navigation", () => {
    expect(ticketNavRoles({ manager: true, settings: true, areas: [] })).toEqual([
      TICKETS_SETTINGS,
    ]);
    const roles = ticketNavRoles({
      manager: false,
      settings: false,
      areas: [{ id: 1, name: "IT", role: "read" }],
    });
    expect(roles).toEqual([TICKETS_MEMBER]);
    const area = areasFor(roles).find((a) => a.id === "tickets");
    expect(area?.groups.flatMap((g) => g.items.map((i) => i.path))).toEqual([
      "/tickets/uebersicht",
      "/tickets",
      "/tickets/neu",
    ]);
    expect(areasFor([]).some((a) => a.id === "tickets")).toBe(false);
  });
});

describe("TicketPage", () => {
  it("speichert Status und Zuständigkeit erst nach „Bestätigen“", async () => {
    const calls: { method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "PATCH") {
          calls.push({ method, body: JSON.parse(String(init?.body)) });
          return new Response(
            JSON.stringify(
              ticket({
                status: "in_progress",
                assignee_oid: "oid-ina",
                assignee_name: "Ina Beispiel",
              }),
            ),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(ticket()), { status: 200 });
      }),
    );
    render(<TicketPage number={1042} />);
    await screen.findByText("Drucker druckt nicht");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.click(screen.getByRole("button", { name: "Mir zuweisen" }));
    expect(
      await screen.findByText(/Status: Neu → In Arbeit · Zuständig: niemand → Ina Beispiel/),
    ).toBeTruthy();
    expect(calls).toHaveLength(0);
    // Verwerfen nimmt alles zurück
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("new");
    expect(calls).toHaveLength(0);
    // Erneut ändern und bestätigen
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.click(screen.getByRole("button", { name: "Mir zuweisen" }));
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toMatchObject({
      expected_status: "new",
      expected_assignee_oid: null,
      status: "in_progress",
      change_assignee: true,
      assignee_oid: "oid-ina",
    });
    expect(await screen.findByText("Die Änderung wurde gespeichert.")).toBeTruthy();
  });

  it("zeigt für fremde Tickets „nicht gefunden“", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    render(<TicketPage number={9} />);
    expect(await screen.findByText(/Dieses Ticket gibt es nicht/)).toBeTruthy();
  });

  it("speichert eine interne Notiz mit Hinweis, dass der Melder sie nicht sieht", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && url.endsWith("/notes")) {
          bodies.push(JSON.parse(String(init.body)));
        }
        return new Response(JSON.stringify(ticket()), { status: 200 });
      }),
    );
    render(<TicketPage number={1042} />);
    fireEvent.click(await screen.findByRole("button", { name: /Interne Notiz schreiben/ }));
    expect(
      screen.getByText("M. Muster sieht diesen Text nicht und bekommt keine Mail."),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /^Interne Notiz/ }), {
      target: { value: "Toner bestellt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Interne Notiz speichern" }));
    await waitFor(() => expect(bodies).toEqual([{ body: "Toner bestellt" }]));
  });
});

describe("Antwort an den Melder", () => {
  it("zeigt Empfänger, Kopie und sendet mit „Status danach“", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && url.endsWith("/replies")) {
          bodies.push(JSON.parse(String(init.body)));
        }
        return new Response(
          JSON.stringify(ticket({ participants: [{ name: "", mail: "kopie@example.com" }] })),
          { status: 200 },
        );
      }),
    );
    render(<TicketPage number={1042} />);
    fireEvent.click(await screen.findByRole("button", { name: /Antwort an M. Muster schreiben/ }));
    expect(
      screen.getByText("Geht per E-Mail an: m.muster@example.com (Kopie an kopie@example.com)"),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /Antwort an M. Muster/ }), {
      target: { value: "Bitte neu starten." },
    });
    fireEvent.change(screen.getByLabelText("Status danach"), { target: { value: "waiting" } });
    // Einklappen behält den Entwurf
    fireEvent.click(screen.getByRole("button", { name: "Einklappen" }));
    fireEvent.click(screen.getByRole("button", { name: /Antwort an M. Muster schreiben/ }));
    expect(
      (screen.getByRole("textbox", { name: /Antwort an M. Muster/ }) as HTMLTextAreaElement).value,
    ).toBe("Bitte neu starten.");
    fireEvent.click(screen.getByRole("button", { name: "An M. Muster senden" }));
    await waitFor(() =>
      expect(bodies).toEqual([{ body: "Bitte neu starten.", status_after: "waiting" }]),
    );
  });

  it("erklärt, warum keine Antwort möglich ist, und zeigt Anhänge und Zitate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              ticket({
                can_reply: false,
                reply_hint: "Für den Melder ist keine Mailadresse eingetragen.",
                entries: [
                  {
                    ...entry("a", "inbound", true),
                    quote: "> alt",
                    attachments: [
                      {
                        id: "f1",
                        filename: "a.pdf",
                        size: 2048,
                        original: false,
                        removed_reason: "",
                      },
                      {
                        id: "f2",
                        filename: "b.exe",
                        size: 10,
                        original: false,
                        removed_reason: "Dateityp nicht erlaubt",
                      },
                    ],
                  },
                ],
              }),
            ),
            { status: 200 },
          ),
      ),
    );
    render(<TicketPage number={1042} />);
    expect(await screen.findByText(/keine Mailadresse eingetragen/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Antwort an M. Muster schreiben/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("link", { name: /a.pdf/ }).getAttribute("href")).toBe(
      "/api/tickets/1042/attachments/f1",
    );
    expect(screen.getByText(/b.exe: entfernt/)).toBeTruthy();
    expect(screen.getByText("Zitat aus früheren Mails anzeigen")).toBeTruthy();
  });
});

describe("TicketsPage", () => {
  it("listet Tickets und filtert nach Auswahl", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ items: [ticket()], total: 1, has_more: false }), {
          status: 200,
        });
      }),
    );
    render(
      <TicketsPage
        access={{ manager: false, settings: false, areas: [{ id: 1, name: "IT", role: "edit" }] }}
      />,
    );
    const table = await screen.findByRole("region", { name: "Ticketliste" });
    expect(within(table).getByRole("link", { name: /T-1042 Drucker druckt nicht/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mir zugewiesen" }));
    await waitFor(() => expect(urls.some((u) => u.includes("view=mine"))).toBe(true));
  });
});

function template(id: number, shortcut: string, extra: Partial<Template> = {}): Template {
  return {
    id,
    name: `Baustein ${shortcut}`,
    shortcut,
    kind: "reply",
    status_after: "",
    body: `Hallo {Vorname}, zu {Nr}: ${shortcut}`,
    ...extra,
  };
}

describe("Arbeitshilfen: Hilfsfunktionen", () => {
  it("erkennt das Kürzel vor der Schreibmarke", () => {
    expect(shortcutAt("Hallo /dru", 10)).toEqual({ start: 6, word: "dru" });
    expect(shortcutAt("/", 1)).toEqual({ start: 0, word: "" });
    expect(shortcutAt("a/b", 3)).toBeNull();
    expect(shortcutAt("Pfad /x y", 9)).toBeNull();
  });

  it("sortiert Bausteine: Treffer am Anfang zuerst", () => {
    const list = [template(1, "zugang"), template(2, "drucker"), template(3, "druckerpatrone")];
    expect(matchTemplates(list, "dru").map((t) => t.id)).toEqual([2, 3]);
    expect(matchTemplates(list, "gang").map((t) => t.id)).toEqual([1]);
    expect(matchTemplates(list, "").length).toBe(3);
  });

  it("setzt Platzhalter ein und lässt unbekannte stehen", () => {
    expect(fillTemplate("Hallo {Vorname} {X}", { Vorname: "Max" })).toBe("Hallo Max {X}");
  });

  it("rechnet Erinnerung und Arbeitszeit um", () => {
    expect(reminderIso("2026-12-01", "08:00")).toBe(new Date("2026-12-01T08:00:00").toISOString());
    expect(reminderIso("kaputt", "08:00")).toBe("");
    expect(inFuture("")).toBe(false);
    expect(inFuture("2000-01-01T00:00:00Z")).toBe(false);
    expect(inFuture("2999-01-01T00:00:00Z")).toBe(true);
    expect(toClock(480)).toBe("08:00");
    expect(fromClock("17:30", 0)).toBe(1050);
    expect(fromClock("x", 42)).toBe(42);
  });

  it("zeigt die Erinnerung in der Zusammenfassung", () => {
    const text = changeSummary(ticket(), "reminder", null, "2026-12-01T07:00:00Z");
    expect(text).toMatch(/Status: Neu → Erinnerung am/);
  });
});

describe("TicketTable", () => {
  it("zeigt Kategorie und Frist nur, wenn es welche gibt", () => {
    const { unmount } = render(<TicketTable items={[ticket()]} showArea={false} />);
    expect(screen.queryByRole("columnheader", { name: "Frist" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Kategorie" })).toBeNull();
    unmount();
    render(
      <TicketTable
        items={[
          ticket({
            category: "Drucker",
            sla_solution_due: "2026-11-23T10:00:00Z",
            sla_overdue: true,
          }),
        ]}
        showArea={false}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Frist" })).toBeTruthy();
    expect(screen.getByText("Drucker")).toBeTruthy();
    expect(screen.getByText("überfällig")).toBeTruthy();
  });
});

describe("TicketPage: Arbeitshilfen", () => {
  it("verlangt für „Erinnerung“ einen Zeitpunkt und schickt ihn erst nach „Bestätigen“", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          calls.push(JSON.parse(String(init.body)));
        }
        return new Response(JSON.stringify(ticket()), { status: 200 });
      }),
    );
    render(<TicketPage number={1042} />);
    await screen.findByText("Drucker druckt nicht");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "reminder" } });
    const confirm = screen.getByRole("button", { name: "Bestätigen" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Erinnern am/, { selector: "input" }), {
      target: { value: "2999-01-04" },
    });
    fireEvent.change(screen.getByLabelText("Stichwort (freiwillig)"), {
      target: { value: "Toner da?" },
    });
    expect(confirm.disabled).toBe(false);
    expect(calls).toHaveLength(0);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      status: "reminder",
      reminder_at: new Date("2999-01-04T08:00:00").toISOString(),
      reminder_note: "Toner da?",
    });
  });

  it("bietet bei Übergabe an andere „Person benachrichtigen“ an", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          calls.push(JSON.parse(String(init.body)));
        }
        return new Response(
          JSON.stringify(
            ticket({ permissions: { edit: true, note: true, assign_any: true, move: false } }),
          ),
          { status: 200 },
        );
      }),
    );
    render(<TicketPage number={1042} />);
    await screen.findByText("Drucker druckt nicht");
    fireEvent.change(screen.getByLabelText("Zuständig"), { target: { value: "oid-max" } });
    const box = screen.getByRole("checkbox", {
      name: "Person benachrichtigen",
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ assignee_oid: "oid-max", notify_assignee: false });
  });

  it("zeigt zusammengeführte Tickets und Einträge „aus T-…“", async () => {
    const merged = entry("m", "note");
    merged.from_number = 1001;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              ticket({
                status: "merged",
                merged_into: 1050,
                entries: [entry("a", "inbound", true), merged],
              }),
            ),
            { status: 200 },
          ),
      ),
    );
    render(<TicketPage number={1042} />);
    expect(await screen.findByRole("link", { name: "T-1050" })).toBeTruthy();
    expect(screen.getByText(/aus T-1001/)).toBeTruthy();
    expect(screen.queryByText("Zusammenführen")).toBeNull();
  });

  it("fügt Textbausteine über /kürzel ein und übernimmt „Status danach“", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/templates")) {
          return new Response(
            JSON.stringify({
              templates: [
                template(1, "drucker", { status_after: "solved" }),
                template(2, "notiz", { kind: "note" }),
              ],
              values: { Vorname: "Max", Nr: "T-1042" },
              signature: "",
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(ticket()), { status: 200 });
      }),
    );
    render(<TicketPage number={1042} />);
    fireEvent.click(await screen.findByRole("button", { name: /Antwort an M. Muster schreiben/ }));
    await screen.findByText(/Schrägstrich und Kürzel tippen/);
    const field = screen.getByLabelText(/^Antwort an M. Muster/) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Danke! /dr", selectionStart: 10 } });
    const list = await screen.findByRole("listbox", { name: "Textbausteine" });
    // Notiz-Bausteine erscheinen in der Antwort nicht
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("Danke! Hallo Max, zu T-1042: drucker");
    expect((screen.getByLabelText("Status danach") as HTMLSelectElement).value).toBe("solved");
  });
});

function stats(extra: Partial<Stats> = {}): Stats {
  return {
    open: 5,
    mine: 2,
    unassigned_new: 1,
    waiting: 1,
    reminder: 0,
    overdue: null,
    sla: null,
    solved_recent: 7,
    created_by_channel: [
      { key: "mail", label: "E-Mail", count: 3 },
      { key: "manual", label: "Von Hand", count: 1 },
      { key: "phone", label: "Telefon", count: 0 },
    ],
    open_by_category: [{ key: "0", label: "Ohne Kategorie", count: 5 }],
    mine_list: [ticket({ number: 1050, subject: "Monitor flackert" })],
    unassigned_list: [],
    ...extra,
  };
}

describe("Betrieb: Hilfsfunktionen", () => {
  it("zeigt Frist-Kacheln nur mit Fristen", () => {
    expect(tilesOf(stats()).map((t) => t.label)).not.toContain("Überfällig");
    const labels = tilesOf(stats({ overdue: 2, sla: { met: 7, total: 8 } })).map(
      (t) => `${t.label}=${t.value}`,
    );
    expect(labels).toContain("Überfällig=2");
    expect(labels).toContain("Frist eingehalten=88 %");
    expect(shareText(1, 0)).toBe("–");
  });

  it("liest die Ansicht aus der Adresse", () => {
    expect(viewFromUrl("?ansicht=mine")).toBe("mine");
    expect(viewFromUrl("?ansicht=kaputt")).toBe("open");
    expect(viewFromUrl("")).toBe("open");
  });

  it("rechnet Fristen der Aufbewahrung um", () => {
    expect(retentionText(0)).toBe("aus");
    expect(retentionText(12)).toBe("1 Jahr");
    expect(retentionText(36)).toBe("3 Jahre");
    expect(retentionText(18)).toBe("18 Monate");
    expect(splitMonths(24)).toEqual({ amount: 2, unit: "years" });
    expect(splitMonths(18)).toEqual({ amount: 18, unit: "months" });
    expect(joinMonths(3, "years")).toBe(36);
    expect(joinMonths(5000, "months")).toBe(1200);
  });

  it("zeigt Angaben im Protokoll ohne Verschachtelung", () => {
    expect(auditDetails({ anzahl: 3, suche: false })).toBe("anzahl: 3 · suche: nein");
    expect(auditDetails({ nachher: { monate: 12, aktion: "delete" } })).toBe(
      "nachher: monate 12, aktion delete",
    );
  });

  it("baut die Adresse des Exports", () => {
    expect(exportUrl("done", 2, " Drucker ")).toBe(
      "/api/tickets/export?view=done&area=2&q=Drucker",
    );
  });
});

describe("Übersicht und Export", () => {
  it("zeigt Kennzahlen, Listen und Balken", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(stats()), { status: 200 })),
    );
    render(
      <TicketsOverviewPage
        access={{ manager: false, settings: false, areas: [{ id: 1, name: "IT", role: "edit" }] }}
      />,
    );
    const tiles = await screen.findByRole("list", { name: "Kennzahlen" });
    const links = within(tiles).getAllByRole("link");
    const mine = links.find((l) => l.textContent?.startsWith("Mir zugewiesen"));
    expect(mine?.textContent).toBe("Mir zugewiesen: 2, offen");
    expect(mine?.getAttribute("href")).toBe("/tickets?ansicht=mine");
    expect(screen.getByRole("link", { name: /T-1050 Monitor flackert/ })).toBeTruthy();
    expect(screen.getByText("Keine freien neuen Tickets.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Neue Tickets nach Eingangsweg" })).toBeTruthy();
  });

  it("bietet den Export nur der Bereichsverwaltung an", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [], total: 0, has_more: false }), { status: 200 }),
      ),
    );
    const { unmount } = render(
      <TicketsPage
        access={{ manager: false, settings: false, areas: [{ id: 1, name: "IT", role: "edit" }] }}
      />,
    );
    await screen.findByText("Keine Tickets für diese Auswahl.");
    expect(screen.queryByRole("link", { name: "Als Excel exportieren" })).toBeNull();
    unmount();
    render(
      <TicketsPage
        access={{
          manager: false,
          settings: true,
          areas: [
            { id: 1, name: "IT", role: "admin" },
            { id: 2, name: "Haustechnik", role: "read" },
          ],
        }}
      />,
    );
    const link = await screen.findByRole("link", { name: "Als Excel exportieren" });
    expect(link.getAttribute("href")).toBe("/api/tickets/export?view=open");
    expect(screen.getByText(/nur Tickets aus Bereichen, die du verwaltest/)).toBeTruthy();
  });
});

describe("TicketPage: Aufbewahrung", () => {
  it("setzt eine Ausnahme mit Begründung und hebt sie mit Bestätigung auf", async () => {
    const calls: { method: string; body: unknown }[] = [];
    const held = ticket({
      status: "closed",
      retention: {
        active: true,
        months: 36,
        action: "anonymize",
        hold_until: "2027-11-22T10:00:00Z",
        hold_reason: "Prüfung",
        hold_by: "Ina Beispiel",
        can_manage: true,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (url.endsWith("/hold")) {
          calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
          return new Response(
            JSON.stringify(
              method === "PUT"
                ? held
                : ticket({ status: "closed", retention: { ...held.retention, hold_until: null } }),
            ),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify(
            ticket({
              status: "closed",
              retention: { ...held.retention, hold_until: null, hold_reason: "", hold_by: "" },
            }),
          ),
          { status: 200 },
        );
      }),
    );
    render(<TicketPage number={1042} />);
    expect(await screen.findByText("3 Jahre nach dem Schließen anonymisieren")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ausnahme setzen" }));
    const save = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Begründung (Pflicht)"), {
      target: { value: "Prüfung" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ method: "PUT", body: { reason: "Prüfung" } });
    expect(await screen.findByText(/Ausnahme bis/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aufheben" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/gilt wieder die Frist des Bereichs/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Aufheben" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.method).toBe("DELETE");
  });

  it("zeigt anonymisierte Tickets ohne Bearbeitung", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              ticket({
                status: "closed",
                subject: "(anonymisiert)",
                entries: [],
                anonymized_at: "2026-11-01T03:00:00Z",
                permissions: { edit: false, note: false, assign_any: false, move: false },
              }),
            ),
            { status: 200 },
          ),
      ),
    );
    render(<TicketPage number={1042} />);
    expect(await screen.findByText(/nach der Aufbewahrungsfrist/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Interne Notiz schreiben/ })).toBeNull();
    expect((screen.getByLabelText("Status") as HTMLSelectElement).disabled).toBe(true);
  });
});

describe("Einstellungen in Reitern", () => {
  it("liest den Reiter aus dem Pfad", () => {
    expect(parseSettingsPath("/tickets/einstellungen")).toBe("bereiche");
    expect(parseSettingsPath("/tickets/einstellungen/email")).toBe("email");
    expect(parseSettingsPath("/tickets/einstellungen/unbekannt")).toBeNull();
    expect(parseSettingsPath("/tickets")).toBeNull();
    expect(settingsPath("bereiche")).toBe("/tickets/einstellungen");
    expect(settingsPath("aufbewahrung", 3)).toBe("/tickets/einstellungen/aufbewahrung?bereich=3");
  });

  it("zeigt die E-Mail-Gestaltung nur der Ticket-Verwaltung", async () => {
    const settings = (manager: boolean) =>
      new Response(
        JSON.stringify({
          manager,
          areas: [
            {
              id: 1,
              name: "IT",
              mailbox: "it@example.com",
              assignment: "first",
              active: true,
              manage: true,
              grants: [],
            },
          ],
        }),
        { status: 200 },
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settings(false)),
    );
    const { unmount } = render(<TicketSettingsPage tab="bereiche" />);
    const nav = await screen.findByRole("navigation", { name: "Einstellungen der Tickets" });
    await screen.findByRole("heading", { name: "IT" });
    expect(within(nav).queryByRole("link", { name: "E-Mail-Gestaltung" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Bereiche" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Aufbewahrung" }).getAttribute("href")).toBe(
      "/tickets/einstellungen/aufbewahrung?bereich=1",
    );
    unmount();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settings(true)),
    );
    render(<TicketSettingsPage tab="bereiche" />);
    const nav2 = await screen.findByRole("navigation", { name: "Einstellungen der Tickets" });
    await screen.findByRole("heading", { name: "IT" });
    expect(within(nav2).getByRole("link", { name: "E-Mail-Gestaltung" })).toBeTruthy();
  });
});

describe("Melder und IT-Bestand", () => {
  it("schlägt Melder aus Entra vor und übernimmt die Mailadresse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/people?")) {
          return new Response(
            JSON.stringify([{ name: "Ina Beispiel", mail: "ina@example.com", detail: "IT" }]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
    render(
      <NewTicketPage
        access={{ manager: false, settings: false, areas: [{ id: 1, name: "IT", role: "edit" }] }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name des Melders"), { target: { value: "Ina" } });
    const list = await screen.findByRole(
      "list",
      { name: "Vorschläge aus Entra" },
      { timeout: 2000 },
    );
    fireEvent.click(within(list).getByRole("button", { name: "Ina Beispiel" }));
    expect((screen.getByLabelText("Name des Melders") as HTMLInputElement).value).toBe(
      "Ina Beispiel",
    );
    expect(
      (screen.getByLabelText("Mailadresse des Melders (freiwillig)") as HTMLInputElement).value,
    ).toBe("ina@example.com");
    expect(screen.queryByRole("list", { name: "Vorschläge aus Entra" })).toBeNull();
  });

  it("zeigt Stelle, Geräte und Verleih des Melders nur mit Angaben aus dem IT-Bestand", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              ticket({
                inventory: true,
                reporter_inventory: {
                  positions: [
                    {
                      id: 7,
                      number: "ST-007",
                      name: "Sachbearbeitung",
                      department: "Verwaltung",
                      workplaces: [{ id: 3, number: "AP-003", room: "Raum 1" }],
                      devices: [{ id: 9, name: "NB-9", kind: "Notebook", inventory_no: "INV-9" }],
                    },
                  ],
                  loans: [
                    { id: 4, number: "V-004", due_on: "2026-11-01", overdue: true, items: 2 },
                  ],
                },
              }),
            ),
            { status: 200 },
          ),
      ),
    );
    render(<TicketPage number={1042} />);
    expect(await screen.findByText("Im IT-Bestand")).toBeTruthy();
    expect(screen.getByRole("link", { name: /ST-007 Sachbearbeitung/ })).toBeTruthy();
    expect(screen.getByText(/AP-003 \(Raum 1\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "NB-9" })).toBeTruthy();
    expect(screen.getByText(/2 Geräte/)).toBeTruthy();
  });

  it("zeigt Tickets zur Stelle, fremde nur als Anzahl", async () => {
    render(
      <RelatedTickets
        title="Tickets der Person"
        load={async () => ({
          items: [{ number: 1042, subject: "Drucker", status: "new" }],
          hidden: 2,
        })}
      />,
    );
    expect(await screen.findByRole("link", { name: "T-1042 Drucker" })).toBeTruthy();
    expect(
      screen.getByText("2 weitere Tickets liegen in Bereichen, die du nicht siehst."),
    ).toBeTruthy();
  });
});
