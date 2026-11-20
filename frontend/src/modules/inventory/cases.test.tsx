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
  "GET /api/inventory/cases": { cases: [newCase], open: 1 },
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
  "GET /api/inventory/hardware": [],
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
    fireEvent.click(await screen.findByRole("button", { name: /Einer Stelle zuordnen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und abschließen" }));
    expect(await screen.findByText("Bitte eine Stelle wählen.")).toBeTruthy();
    fireEvent.change(await screen.findByRole("combobox", { name: /^Stelle/ }), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und abschließen" }));
    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith("/decide"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/decide"))?.body).toEqual({
      decision: "stelle",
      position_id: 4,
    });
    expect(await screen.findByText("Einer Stelle zugeordnet")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: /Am Arbeitsplatz anlegen/ }));
    await screen.findByRole("combobox", { name: /^Arbeitsplatz/ });
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
      client_secret: "geheim",
    });
  });
});
