import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate } from "../../router";
import { entryPath, parseEvergreenPath, type Entry } from "./api";
import { EntriesPage } from "./EntriesPage";

vi.mock("../../router", () => ({ navigate: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(navigate).mockClear();
});

function stubFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .filter(
          (route) => `${method} ${url}` === route || `${method} ${url}`.startsWith(`${route}?`),
        )
        .sort((left, right) => right.length - left.length)[0];
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

const entry: Entry = {
  id: 5,
  number: "EV-2026-005",
  software: "m365",
  title: "Neue Funktion in Teams",
  source: "nachrichtencenter",
  source_ref: "MC100001",
  services: ["Microsoft Teams"],
  major_change: true,
  action_required_by: "2026-12-01T00:00:00Z",
  status: "neu",
  created_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-20T10:00:00Z",
  last_editor: null,
  category: "planForChange",
  published_at: "2026-11-19T08:00:00Z",
  modified_at: "2026-11-19T08:00:00Z",
  body: "Erste Zeile\n\nZweite Zeile <b>kein HTML</b>",
  closed_at: null,
  notes: [],
  can_edit: true,
};

const worked: Entry = {
  ...entry,
  status: "bearbeitet",
  last_editor: "Ina Beispiel",
  notes: [
    {
      id: 1,
      kind: "notiz",
      text: "Mit Fachabteilung klären",
      author: "Ina Beispiel",
      created_at: "2026-11-21T08:00:00Z",
    },
  ],
};

const routes = {
  "GET /api/evergreen/entries": { entries: [entry], total: 1, open: 1, new: 1, can_edit: true },
  "GET /api/evergreen/entries/5": entry,
  "POST /api/evergreen/entries/5/notes": worked,
  "POST /api/evergreen/entries/5/close": { ...worked, status: "abgeschlossen" },
  "POST /api/evergreen/entries": { ...entry, id: 9, source: "manuell" },
};

describe("Evergreen-Pfade", () => {
  it("liest Software und Eintrag aus dem Pfad", () => {
    expect(parseEvergreenPath("/evergreen/m365")).toEqual({ software: "m365", entryId: null });
    expect(parseEvergreenPath("/evergreen/m365/12")).toEqual({ software: "m365", entryId: 12 });
    expect(parseEvergreenPath("/evergreen")).toEqual({ software: "m365", entryId: null });
    expect(parseEvergreenPath("/evergreen/andere")).toBeNull();
    expect(parseEvergreenPath("/evergreen/m365/x")).toBeNull();
    expect(entryPath("m365", 3)).toBe("/evergreen/m365/3");
  });
});

describe("EntriesPage", () => {
  it("zeigt die Einträge als Tabelle und öffnet einen per Klick auf die Zeile", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={null} roles={["Evergreen.Reader"]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Microsoft 365" })).toBeVisible();
    const table = await screen.findByRole("table", { name: "Einträge Microsoft 365" });
    expect(screen.getByText("1 offen, davon 1 neu")).toBeVisible();
    expect(screen.getByRole("button", { name: "Neu · 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Neuer Eintrag" })).toBeNull();
    expect(calls[0]?.url).toContain("software=m365");
    expect(calls[0]?.url).toContain("state=offen");
    fireEvent.click(table.querySelector("tbody td") as HTMLElement);
    expect(navigate).toHaveBeenCalledWith("/evergreen/m365/5");

    fireEvent.click(screen.getByRole("button", { name: "Abgeschlossen" }));
    await waitFor(() => expect(calls.at(-1)?.url).toContain("state=abgeschlossen"));
  });

  it("zeigt Lesern den Eintrag ohne Bearbeitung, den Text als reinen Text", async () => {
    stubFetch({ ...routes, "GET /api/evergreen/entries/5": { ...entry, can_edit: false } });
    render(<EntriesPage software="m365" entryId={5} roles={["Evergreen.Reader"]} />);
    expect(await screen.findByRole("heading", { name: "Neue Funktion in Teams" })).toBeVisible();
    expect(screen.getByText("MC100001")).toBeVisible();
    expect(screen.getByText(/Zweite Zeile <b>kein HTML<\/b>/)).toBeVisible();
    expect(screen.getByText("Noch keine Notizen.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Notiz anfügen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abschließen" })).toBeNull();
  });

  it("fügt als Bearbeiter eine Notiz an und schließt ab", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={5} roles={["Evergreen.Editor"]} />);
    await screen.findByRole("heading", { name: "Neue Funktion in Teams" });

    fireEvent.click(screen.getByRole("button", { name: "Notiz anfügen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte eine Notiz eingeben.");

    fireEvent.change(screen.getByLabelText("Notiz"), {
      target: { value: "  Mit Fachabteilung klären " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Notiz anfügen" }));
    expect(await screen.findByText("Mit Fachabteilung klären")).toBeVisible();
    const note = calls.find((call) => call.url.endsWith("/notes"));
    expect(note?.body).toEqual({ text: "Mit Fachabteilung klären" });

    fireEvent.click(screen.getByRole("button", { name: "Abschließen" }));
    expect(await screen.findByRole("button", { name: "Wieder öffnen" })).toBeVisible();
    const close = calls.find((call) => call.url.endsWith("/close"));
    expect(close?.body).toEqual({ text: null });
  });

  it("legt als Bearbeiter einen Eintrag von Hand an", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={null} roles={["Evergreen.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Neuer Eintrag" }));
    fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte einen Titel eingeben.");
    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "Neuerung aus der Presse" },
    });
    fireEvent.change(screen.getByLabelText("Dienst (optional)"), { target: { value: "Teams" } });
    fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/evergreen/m365/9"));
    const created = calls.find((call) => call.method === "POST");
    expect(created?.body).toEqual({
      software: "m365",
      title: "Neuerung aus der Presse",
      service: "Teams",
    });
  });
});
