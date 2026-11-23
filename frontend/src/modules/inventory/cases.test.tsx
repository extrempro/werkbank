import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NinjaSettings } from "../../pages/NinjaSettings";
import { casePath, ninjaFactRows, parseCasePath, parseHardwarePath, type Case } from "./api";
import { CasesPage } from "./CasesPage";

vi.mock("../../router", () => ({ navigate: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

const newCase: Case = {
  id: 3,
  number: "V-003",
  kind: "neu",
  kind_label: "Neu in NinjaOne",
  status: "neu",
  title: "Neues Gerät in NinjaOne: Notebook NB-0163",
  created_at: "2026-11-20T10:00:00Z",
  assignee: null,
  facts: {
    ninja_id: 42,
    hostname: "NB-0163",
    serial: "5CG4012QWE",
    kind: "Notebook",
    maker: "Hersteller A",
    model: "Notebook 14 G10",
    os: "Windows 11 Pro",
    ip: ["192.0.2.41"],
    ram_gb: 16,
  },
  decision: "",
  decision_label: "",
  closed_at: null,
  hardware: null,
  hint: { id: 7, name: "Altes Notebook", hostname: "NB-0163", serial: "ALT", status: "aktiv" },
  events: [
    {
      occurred_at: "2026-11-20T10:00:00Z",
      who: "Werkbank (Abgleich)",
      text: "Beim Abgleich gefunden",
    },
  ],
};

const routes = {
  "GET /api/inventory/cases": { cases: [newCase], open: 1, total: 1 },
  "GET /api/inventory/cases/3": newCase,
  "GET /api/inventory/ninjaone/status": {
    enabled: true,
    interval_minutes: 30,
    last_run: {
      started_at: "2026-11-20T10:00:00Z",
      finished_at: "2026-11-20T10:00:05Z",
      status: "ok",
      devices: 12,
      updated: 1,
      new_cases: 1,
      missing_cases: 0,
      error: "",
    },
    next_run_at: null,
  },
  "GET /api/inventory/assignees": {
    positions: [{ id: 4, number: "ST-004", name: "Einkauf", person_name: "Alex Beispiel" }],
    workplaces: [],
  },
  "GET /api/inventory/locations": { cities: [] },
  "GET /api/inventory/hardware": { items: [], total: 0, kinds: [] },
  "GET /api/inventory/lookup": {
    items: [{ id: 4, label: "ST-004 Einkauf", detail: "Alex Beispiel" }],
    total: 1,
  },
};

describe("Vorgänge: Hilfsfunktionen", () => {
  it("baut und liest Pfade", () => {
    expect(casePath(3)).toBe("/bestand/vorgaenge/3");
    expect(parseCasePath("/bestand/vorgaenge")).toEqual({ id: null });
    expect(parseCasePath("/bestand/vorgaenge/3")).toEqual({ id: 3 });
    expect(parseCasePath("/bestand/vorgaenge/x")).toBeNull();
    expect(parseHardwarePath("/bestand/hardware/7/technik")).toEqual({ id: 7, tab: "technik" });
  });

  it("zeigt nur gefüllte Kenndaten", () => {
    const rows = ninjaFactRows({ hostname: "NB-1", ip: [], ram_gb: null, maker: "A", model: "" });
    expect(rows).toEqual([
      { label: "Hostname", value: "NB-1", mono: true },
      { label: "Hersteller und Modell", value: "A", mono: false },
    ]);
  });
});

describe("Vorgänge: Seite", () => {
  it("zeigt Liste, Hinweis und Kenndaten für Lesende ohne Entscheidung", async () => {
    stubFetch(routes);
    render(<CasesPage caseId={3} roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("heading", { name: newCase.title })).toBeTruthy();
    expect(screen.getByText("Möglicherweise dasselbe Gerät.")).toBeTruthy();
    expect(screen.getByText("192.0.2.41")).toBeTruthy();
    expect(await screen.findByText(/12 Geräte, 1 neu, 0 fehlen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ich übernehme" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Übernehmen und abschließen/ })).toBeNull();
  });

  it("ordnet ein neues Gerät einer Stelle zu", async () => {
    const calls = stubFetch({
      ...routes,
      "POST /api/inventory/cases/3/decide": {
        ...newCase,
        status: "fertig",
        decision: "stelle",
        decision_label: "Einer Stelle zugeordnet",
      },
    });
    render(<CasesPage caseId={3} roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Einer Stelle zuordnen/ }));
    expect(screen.getByText(/Das Gerät gehört dann zur Stelle/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Erklärung zu „Ins Lager“" }));
    expect(screen.getByRole("button", { name: "Erklärung zu „Ins Lager“" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(/Nicht zugeordnet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und abschließen" }));
    expect(await screen.findByText("Bitte eine Stelle wählen.")).toBeTruthy();
    // Die Stelle wird gesucht: Der Server liefert die Treffer.
    fireEvent.change(await screen.findByRole("combobox", { name: /^Stelle/ }), {
      target: { value: "einkauf" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /ST-004 Einkauf/ }));
    expect(screen.getByRole("button", { name: "Stelle ändern: ST-004 Einkauf" })).toBeTruthy();
    expect(calls.some((call) => call.url.includes("/lookup?kind=position"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und abschließen" }));
    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith("/decide"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/decide"))?.body).toEqual({
      decision: "stelle",
      position_id: 4,
    });
    expect(await screen.findByText("Einer Stelle zugeordnet")).toBeTruthy();
  });
});

describe("Vorgänge: Liste", () => {
  it("grenzt nach Art ein und zeigt schmal erst die Liste", async () => {
    const calls = stubFetch(routes);
    const { container } = render(<CasesPage caseId={null} roles={["Bestand.Reader"]} />);
    expect(container.querySelector(".case-layout-detail")).toBeNull();
    fireEvent.change(await screen.findByRole("combobox", { name: "Art" }), {
      target: { value: "rueckgabe" },
    });
    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.includes("kind=rueckgabe"))).toBe(true),
    );
  });

  it("zeigt gewählt die Ansicht mit dem Weg zurück zur Liste", async () => {
    stubFetch(routes);
    const { container } = render(<CasesPage caseId={3} roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("heading", { name: newCase.title })).toBeTruthy();
    expect(container.querySelector(".case-layout-detail")).not.toBeNull();
    expect(screen.getByRole("link", { name: "‹ Zur Liste" })).toHaveAttribute(
      "href",
      "/bestand/vorgaenge",
    );
  });

  it("zeigt die Vorgänge als Tabelle und öffnet einen Vorgang per Klick auf die Zeile", async () => {
    stubFetch(routes);
    const { navigate } = await import("../../router");
    render(<CasesPage caseId={null} roles={["Bestand.Reader"]} />);
    const table = await screen.findByRole("table", { name: "Vorgänge" });
    expect(screen.getByRole("columnheader", { name: "Bearbeitet von" })).toBeTruthy();
    const link = screen.getByRole("link", { name: newCase.title });
    expect(link).toHaveAttribute("href", "/bestand/vorgaenge/3");
    fireEvent.click(table.querySelector("tbody td") as HTMLElement);
    expect(navigate).toHaveBeenCalledWith("/bestand/vorgaenge/3");
  });

  it("stellt die Breite von Tabelle und Ansicht mit den Pfeiltasten ein und merkt sie", async () => {
    stubFetch(routes);
    window.localStorage.setItem("werkbank-vorgaenge-breite", "60");
    render(<CasesPage caseId={3} roles={["Bestand.Reader"]} />);
    const handle = await screen.findByRole("separator", {
      name: "Breite von Tabelle und Ansicht",
    });
    expect(handle).toHaveAttribute("aria-valuenow", "60");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "58");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle).toHaveAttribute("aria-valuenow", "75");
    expect(window.localStorage.getItem("werkbank-vorgaenge-breite")).toBe("75");
    window.localStorage.removeItem("werkbank-vorgaenge-breite");
  });

  it("schließt die Ansicht über das Kreuz", async () => {
    stubFetch(routes);
    const { navigate } = await import("../../router");
    render(<CasesPage caseId={3} roles={["Bestand.Reader"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ansicht schließen" }));
    expect(navigate).toHaveBeenCalledWith("/bestand/vorgaenge");
    expect(screen.getByRole("link", { name: newCase.title })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("Vorgänge: neuer Monitor", () => {
  it("schlägt den Arbeitsplatz vor", async () => {
    const monitorCase: Case = {
      ...newCase,
      id: 5,
      number: "V-005",
      kind: "monitor",
      kind_label: "Neuer Monitor",
      title: "Neuer Monitor an NB-0142",
      hint: null,
      facts: {
        maker: "Lenovo",
        model: "T24D-4t",
        serial: "V5A00000",
        connector: "DisplayPort",
        built: "2024-KW12",
        host: "NB-0142",
        host_id: 7,
        suggest_workplace_id: 2,
      },
    };
    const calls = stubFetch({
      ...routes,
      "GET /api/inventory/cases/5": monitorCase,
      "GET /api/inventory/assignees": {
        positions: [],
        workplaces: [{ id: 2, number: "AP-002", name: "Fenster", shared: false, place: null }],
      },
      "POST /api/inventory/cases/5/decide": { ...monitorCase, status: "fertig" },
    });
    render(<CasesPage caseId={5} roles={["Bestand.Editor"]} />);
    expect(await screen.findByText("Monitor laut Custom Field")).toBeTruthy();
    expect(screen.getByText("DisplayPort")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Am Arbeitsplatz anlegen/ }));
    // Der Vorschlag ist schon gewählt; „Ändern“ öffnet die Suche.
    expect(await screen.findByText("Arbeitsplatz von NB-0142")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und abschließen" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.url.endsWith("/decide"))?.body).toEqual({
        decision: "arbeitsplatz",
        workplace_id: 2,
      }),
    );
  });
});

describe("Verwaltung: NinjaOne", () => {
  it("speichert Region, Client-ID und Secret", async () => {
    const stored = {
      enabled: false,
      region: "eu",
      client_id: "",
      secret_set: false,
      secret_storage_available: true,
      regions: [
        { id: "eu", name: "Europa", host: "eu.ninjarmm.com" },
        { id: "app", name: "USA", host: "app.ninjarmm.com" },
      ],
      organization_ids: [],
      role_ids: [],
      monitor_field: "",
      psref_enabled: false,
    };
    const calls = stubFetch({
      "GET /api/admin/settings/ninjaone": stored,
      "PUT /api/admin/settings/ninjaone": {
        ...stored,
        enabled: true,
        client_id: "app-id",
        secret_set: true,
      },
    });
    render(<NinjaSettings />);
    fireEvent.change(await screen.findByLabelText("Client-ID"), { target: { value: "app-id" } });
    fireEvent.change(screen.getByLabelText("Client-Secret"), { target: { value: "geheim" } });
    fireEvent.click(screen.getByLabelText("Abgleich mit NinjaOne einschalten"));
    fireEvent.click(screen.getByRole("button", { name: "NinjaOne speichern" }));
    expect(await screen.findByText("Die Anbindung an NinjaOne ist gespeichert.")).toBeTruthy();
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      enabled: true,
      region: "eu",
      client_id: "app-id",
      organization_ids: [],
      role_ids: [],
      monitor_field: "",
      psref_enabled: false,
      client_secret: "geheim",
    });
  });
});

describe("Vorgänge: Person nicht mehr aktiv", () => {
  const personCase: Case = {
    ...newCase,
    id: 9,
    number: "V-009",
    kind: "person_inaktiv",
    kind_label: "Person nicht mehr aktiv",
    title: "Person nicht mehr aktiv: Pia Beispiel (Stelle ST-004)",
    hint: null,
    facts: {
      person_oid: "aaaaaaaa-2222-3333-4444-555555555555",
      person: "Pia Beispiel",
      upn: "pia@example.com",
      reason: "deaktiviert",
      position_id: 4,
      position_number: "ST-004",
      position_name: "Sachbearbeitung",
    },
  };

  it("bietet bei einer Stelle die Nachfolge mit Person aus Entra an", async () => {
    const next = "bbbbbbbb-2222-3333-4444-555555555555";
    const calls = stubFetch({
      ...routes,
      "GET /api/inventory/cases/9": personCase,
      "GET /api/inventory/people": [{ oid: next, name: "Nils Nachfolge", upn: "nils@example.com" }],
      "POST /api/inventory/cases/9/decide": { ...personCase, status: "fertig" },
    });
    render(<CasesPage caseId={9} roles={["Bestand.Editor"]} />);
    expect(await screen.findByText("deaktiviert")).toBeTruthy();
    expect(screen.getByRole("link", { name: /ST-004 Sachbearbeitung/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Geklärt/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Neue Person eintragen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und abschließen" }));
    expect((await screen.findByRole("alert")).textContent).toContain("neue Person");
    fireEvent.change(screen.getByLabelText(/Neue Person \(aus Entra\)/), {
      target: { value: "nils" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Nils Nachfolge/ }));
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und abschließen" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.url.endsWith("/decide"))?.body).toEqual({
        decision: "nachfolge",
        person_oid: next,
      }),
    );
  });

  it("bietet beim Verleih nur „Geklärt“ an", async () => {
    const loanCase: Case = {
      ...personCase,
      facts: { ...personCase.facts, position_id: undefined, loan_id: 3, loan_number: "L-003" },
    };
    stubFetch({ ...routes, "GET /api/inventory/cases/9": loanCase });
    render(<CasesPage caseId={9} roles={["Bestand.Editor"]} />);
    expect(await screen.findByRole("button", { name: /^Geklärt/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Stelle frei machen/ })).toBeNull();
    expect(screen.getByRole("link", { name: "L-003" })).toBeTruthy();
  });
});
