import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { areasFor, TICKETS_MEMBER, TICKETS_SETTINGS } from "../../navigation";
import { fillTemplate, parseTicketPath, type Entry, type Template, type Ticket } from "./api";
import { parseMails } from "./NewTicketPage";
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
import { TicketsPage, TicketTable } from "./TicketsPage";
import { fromClock, toClock } from "./TicketWorkSettings";
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
    devices_enabled: false,
    device: null,
    merged_into: null,
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
