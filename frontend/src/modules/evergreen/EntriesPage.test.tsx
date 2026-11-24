import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate } from "../../router";
import { entryPath, parseEvergreenPath, type Entry, type EntrySummary } from "./api";
import { EntriesPage, groupEntries } from "./EntriesPage";
import { confirmDialog } from "../../test/confirm";

vi.mock("../../router", () => ({ navigate: vi.fn() }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
  kind: "Neue Funktion",
  info_only: false,
  category: "planForChange",
  published_at: "2026-11-19T08:00:00Z",
  modified_at: "2026-11-19T08:00:00Z",
  body: "Erste Zeile",
  closed_at: null,
  tags: ["User impact", "New feature"],
  sections: [
    { head: "What and why", text: "Zweite Zeile <b>kein HTML</b>" },
    { head: "When this will happen", text: "Targeted Release: January 2027" },
  ],
  schedule_previous: "General Availability: December 2026",
  schedule_changed_at: "2026-11-20T10:00:00Z",
  affected: "Nutzer",
  default_state: "an",
  controllable: true,
  controllable_how: "Besprechungsrichtlinie",
  phases: [{ name: "Targeted Release", start: "2027-01", end: "2027-02" }],
  phases_previous: [{ name: "Allgemein verfügbar", start: "2026-12", end: "2026-12" }],
  suggested: ["affected", "phases"],
  ai_suggested: ["phases"],
  ai_pending: false,
  ai_available: true,
  summary: null,
  staff_change: null,
  training: null,
  codetermination: null,
  codetermination_reason: null,
  setting: null,
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
      changes: [],
    },
  ],
};

function summary(over: Partial<EntrySummary>): EntrySummary {
  return { ...entry, ...over };
}

const listed = [
  summary({ id: 7, number: "EV-2026-007", title: "Ohne Frist neu", action_required_by: null }),
  summary({
    id: 8,
    number: "EV-2026-008",
    title: "In Arbeit",
    status: "bearbeitet",
    action_required_by: null,
  }),
  summary({}),
];

const list = { entries: listed, total: 3, open: 3, new: 2, due: 1, done: 4, can_edit: true };

const routes = {
  "GET /api/evergreen/entries": list,
  "GET /api/evergreen/entries/5": entry,
  "POST /api/evergreen/entries/5/notes": worked,
  "POST /api/evergreen/entries/5/close": { ...worked, status: "abgeschlossen" },
  "PUT /api/evergreen/entries/5/assessment": {
    ...entry,
    status: "bearbeitet",
    summary: "Kurz und klar",
    suggested: [],
  },
  "POST /api/evergreen/entries/5/ai-suggestion": {
    ...entry,
    default_state: "aus",
    suggested: ["affected", "phases", "default_state"],
    ai_suggested: ["phases", "default_state"],
  },
  "GET /api/evergreen/settings": {
    settings: [{ id: 3, path: "teams/Besprechung/Copilot", value: "true" }],
    more: false,
  },
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

  it("gruppiert offene Einträge: mit Frist, neu, in Bearbeitung", () => {
    const later = summary({ id: 11, action_required_by: "2027-03-01T00:00:00Z" });
    const groups = groupEntries([...listed, later]);
    expect(groups.map((group) => [group.label, group.entries.map((e) => e.id)])).toEqual([
      ["Mit Frist", [5, 11]],
      ["Neu", [7]],
      ["In Bearbeitung", [8]],
    ]);
    expect(groupEntries([listed[0] as EntrySummary]).map((group) => group.label)).toEqual(["Neu"]);
  });
});

describe("EntriesPage", () => {
  it("zeigt die Liste in Gruppen und öffnet einen Eintrag per Verweis", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={8} roles={["Evergreen.Reader"]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Microsoft 365" })).toBeVisible();
    const nav = await screen.findByRole("navigation", { name: "Einträge Microsoft 365" });
    expect(screen.getByText("3 offen, davon 2 neu")).toBeVisible();
    const status = screen.getByRole("combobox", { name: "Status" });
    expect(screen.getByRole("option", { name: "Mit Frist · 1" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Abgeschlossen · 4" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Neuer Eintrag" })).toBeNull();
    const heads = nav.querySelectorAll("h2");
    expect([...heads].map((head) => head.textContent)).toEqual([
      "Mit Frist1",
      "Neu1",
      "In Bearbeitung1",
    ]);
    expect(screen.getByText("bis 01.12.2026")).toBeVisible();
    const current = screen.getByRole("link", { name: /In Arbeit/ });
    expect(current).toHaveAttribute("aria-current", "true");
    const first = calls.find((call) => call.url.includes("state="));
    expect(first?.url).toContain("state=offen");
    expect(first?.url).toContain("hide_info=true");

    fireEvent.click(screen.getByRole("link", { name: /Ohne Frist neu/ }));
    expect(navigate).toHaveBeenCalledWith("/evergreen/m365/7");

    fireEvent.change(status, { target: { value: "abgeschlossen" } });
    await waitFor(() => expect(calls.at(-1)?.url).toContain("state=abgeschlossen"));
    await waitFor(() => expect(nav.querySelectorAll("h2")).toHaveLength(0));
  });

  it("merkt sich den Schalter für Info-Meldungen im Browser", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={null} roles={["Evergreen.Reader"]} />);
    const toggle = await screen.findByRole("checkbox", { name: "Reine Info-Meldungen ausblenden" });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/Wähle links einen Eintrag/)).toBeVisible();
    fireEvent.click(toggle);
    await waitFor(() => expect(calls.at(-1)?.url).toContain("hide_info=false"));
    expect(window.localStorage.getItem("werkbank-evergreen-info")).toBe("aus");
  });

  it("zeigt Lesern Steckbrief, Rollout und Reiter ohne Formular", async () => {
    stubFetch({ ...routes, "GET /api/evergreen/entries/5": { ...entry, can_edit: false } });
    render(<EntriesPage software="m365" entryId={5} roles={["Evergreen.Reader"]} />);
    expect(await screen.findByRole("heading", { name: "Neue Funktion in Teams" })).toBeVisible();
    expect(screen.getByText("MC100001")).toBeVisible();
    const badges = screen.getByRole("list", { name: "Kennzeichen" });
    for (const badge of ["Microsoft Teams", "Neue Funktion", "Betrifft Nutzer", "Handlung nötig"]) {
      expect(badges).toHaveTextContent(badge);
    }
    expect(screen.getByText("Eingeschaltet").closest(".ev-fact")).toHaveClass("ev-fact-warn");
    expect(screen.getAllByText("Vorschlag, ungeprüft")).toHaveLength(1);
    expect(screen.getByText("KI-Vorschlag, ungeprüft")).toHaveClass("pill-ki");
    expect(screen.queryByRole("button", { name: "KI-Vorschlag holen" })).toBeNull();
    expect(screen.getByText("Zeitplan geändert am 20.11.2026")).toBeVisible();
    const phases = screen.getByRole("list", { name: "Rollout-Phasen" });
    expect(phases).toHaveTextContent("Targeted Release: Jan 2027 bis Feb 2027");
    expect(phases).toHaveTextContent("Allgemein verfügbar: Dez 2026 (vorher geplant)");

    expect(screen.getByRole("tab", { name: "Unsere Bewertung" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Bewertung speichern" })).toBeNull();
    expect(screen.getAllByText("Noch nicht bewertet.").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Text von Microsoft" }));
    const text = screen.getByText(/Zweite Zeile <b>kein HTML<\/b>/);
    expect(text).toBeVisible();
    expect(text).toHaveAttribute("lang", "en");
    expect(screen.getByText("What and why")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Notizen und Verlauf" }));
    expect(screen.getByText("Noch keine Notizen.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Notiz anfügen" })).toBeNull();
  });

  it("wechselt die Reiter mit den Pfeiltasten", async () => {
    stubFetch(routes);
    render(<EntriesPage software="m365" entryId={5} roles={["Evergreen.Editor"]} />);
    const first = await screen.findByRole("tab", { name: "Unsere Bewertung" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Text von Microsoft" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Text von Microsoft" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Text von Microsoft" }), { key: "End" });
    expect(screen.getByRole("tabpanel", { name: "Notizen und Verlauf" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Notizen und Verlauf" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("tab", { name: "Unsere Bewertung" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("speichert als Bearbeiter die Bewertung mit Phasen und Einstellung", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={5} roles={["Evergreen.Editor"]} />);
    fireEvent.change(await screen.findByLabelText("Kurzfassung"), {
      target: { value: " Kurz und klar " },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Noch prüfen" }));
    fireEvent.change(screen.getByLabelText("Standard nach dem Rollout"), {
      target: { value: "aus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Phase hinzufügen" }));
    fireEvent.click(screen.getByRole("button", { name: "Bewertung speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Jede Rollout-Phase braucht");
    fireEvent.click(screen.getByRole("button", { name: "Phase 2 entfernen" }));

    const picker = screen.getByRole("combobox", { name: "Einstellung aus der M365-Konfiguration" });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "copilot" } });
    fireEvent.click(await screen.findByRole("option", { name: /teams\/Besprechung\/Copilot/ }));
    expect(screen.getByText("teams/Besprechung/Copilot")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Bewertung speichern" }));
    expect(await screen.findByText("Gespeichert.")).toBeVisible();
    const saved = calls.find((call) => call.method === "PUT");
    expect(saved?.body).toEqual({
      summary: "Kurz und klar",
      staff_change: null,
      training: null,
      codetermination: "pruefen",
      codetermination_reason: null,
      setting_id: 3,
      affected: "Nutzer",
      default_state: "aus",
      controllable: true,
      controllable_how: "Besprechungsrichtlinie",
      phases: [{ name: "Targeted Release", start: "2027-01", end: "2027-02" }],
    });
  });

  it("holt als Bearbeiter einen KI-Vorschlag und setzt die Maske neu auf", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={5} roles={["Evergreen.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "KI-Vorschlag holen" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Standard nach dem Rollout")).toHaveValue("aus"),
    );
    expect(calls.some((call) => call.url.endsWith("/ai-suggestion"))).toBe(true);
    expect(screen.getAllByText("KI-Vorschlag, ungeprüft").length).toBeGreaterThan(1);
  });

  it("fügt als Bearbeiter eine Notiz an und schließt ab", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={5} roles={["Evergreen.Editor"]} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Notizen und Verlauf" }));

    fireEvent.click(screen.getByRole("button", { name: "Notiz anfügen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte gib eine Notiz ein.");

    fireEvent.change(screen.getByLabelText("Notiz"), {
      target: { value: "  Mit Fachabteilung klären " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Notiz anfügen" }));
    expect(await screen.findByText("Mit Fachabteilung klären")).toBeVisible();
    const note = calls.find((call) => call.url.endsWith("/notes"));
    expect(note?.body).toEqual({ text: "Mit Fachabteilung klären" });

    fireEvent.click(screen.getByRole("button", { name: "Abschließen" }));
    await confirmDialog("Abschließen");
    expect(await screen.findByRole("button", { name: "Wieder öffnen" })).toBeVisible();
    const close = calls.find((call) => call.url.endsWith("/close"));
    expect(close?.body).toEqual({ text: null });
  });

  it("legt als Bearbeiter einen Eintrag von Hand an", async () => {
    const calls = stubFetch(routes);
    render(<EntriesPage software="m365" entryId={null} roles={["Evergreen.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Neuer Eintrag" }));
    fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte gib einen Titel ein.");
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
