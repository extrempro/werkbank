import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  equipmentLabel,
  filterPositions,
  filterWorkplaces,
  holderValue,
  kitProblem,
  parseHolder,
  parsePositionPath,
  parseWorkplacePath,
  positionPath,
  spotInRoom,
  workplaceName,
  workplacePath,
  type Position,
  type PositionSummary,
  type Workplace,
  type WorkplaceSummary,
} from "./api";
import { PositionDetailPage, PositionsPage } from "./PositionsPage";
import { WorkplaceDetailPage, WorkplacesPage } from "./WorkplacesPage";

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

const summary: PositionSummary = {
  id: 4,
  number: "ST-004",
  name: "Sachbearbeitung Einkauf",
  department_id: 2,
  department: "Einkauf",
  person: {
    oid: "11111111-2222-3333-4444-555555555555",
    name: "Alex Beispiel",
    upn: "alex@example.com",
  },
  workplaces: 1,
  hardware: 1,
  sites: "Haus Nord",
};

const position: Position = {
  ...summary,
  note: "",
  created_at: "2026-11-20T08:00:00Z",
  workplace_list: [
    { id: 2, number: "AP-002", name: "Fenster", shared: false, place: "0.12 · Haus Nord, EG" },
  ],
  hardware_list: [],
  events: [{ occurred_at: "2026-11-20T08:00:00Z", who: "Bernd Bestand", text: "Stelle angelegt" }],
};

const workplaceSummary: WorkplaceSummary = {
  id: 2,
  number: "AP-002",
  name: "Fenster",
  shared: false,
  room_id: 9,
  place: "0.12 · Haus Nord, EG",
  positions: [
    { id: 4, number: "ST-004", name: "Sachbearbeitung Einkauf", person_name: "Alex Beispiel" },
  ],
  kit_id: 1,
  kit: "Büro Standard",
  complete: false,
  missing: 1,
};

const workplace: Workplace = {
  ...workplaceSummary,
  note: "",
  location: null,
  spot_x: null,
  spot_y: null,
  created_at: "2026-11-20T08:00:00Z",
  hardware_list: [],
  equipment: {
    kit: "Büro Standard",
    complete: false,
    missing: 1,
    rows: [
      { label: "Rechner", need: 1, have: 1, kinds: ["Notebook"], devices: ["Notebook A"] },
      { label: "Monitor", need: 2, have: 1, kinds: ["Monitor"], devices: ["Monitor 1"] },
    ],
  },
  events: [],
};

describe("Stellen und Arbeitsplätze: Hilfsfunktionen", () => {
  it("baut und liest die Pfade", () => {
    expect(positionPath(4)).toBe("/bestand/stellen/4");
    expect(positionPath(4, "verlauf")).toBe("/bestand/stellen/4/verlauf");
    expect(parsePositionPath("/bestand/stellen/4/hardware")).toEqual({ id: 4, tab: "hardware" });
    expect(parsePositionPath("/bestand/stellen/4/uebersicht")).toBeNull();
    expect(parsePositionPath("/bestand/stellen/4/unbekannt")).toBeNull();
    expect(parsePositionPath("/bestand/stellen")).toBeNull();
    expect(workplacePath(2, "ausstattung")).toBe("/bestand/arbeitsplaetze/2/ausstattung");
    expect(parseWorkplacePath("/bestand/arbeitsplaetze/2")).toEqual({ id: 2, tab: "uebersicht" });
  });

  it("filtert und beschriftet", () => {
    expect(filterPositions([summary], "alex")).toHaveLength(1);
    expect(filterPositions([summary], "nord")).toHaveLength(1);
    expect(filterPositions([summary], "lager")).toHaveLength(0);
    const free = { ...workplaceSummary, id: 3, positions: [], shared: true, complete: null };
    expect(filterWorkplaces([workplaceSummary, free], "frei")).toEqual([free]);
    expect(filterWorkplaces([workplaceSummary, free], "unvollstaendig")).toEqual([
      workplaceSummary,
    ]);
    expect(filterWorkplaces([workplaceSummary, free], "geteilt")).toEqual([free]);
    expect(equipmentLabel({ complete: null, missing: 0 })).toBe("keine Vorlage");
    expect(equipmentLabel({ complete: true, missing: 0 })).toBe("vollständig");
    expect(equipmentLabel({ complete: false, missing: 2 })).toBe("2 fehlen");
    expect(workplaceName({ number: "AP-003" })).toBe("AP-003");
  });

  it("liest die Zuordnung eines Geräts", () => {
    expect(holderValue(4, null)).toBe("s:4");
    expect(holderValue(null, 2)).toBe("w:2");
    expect(holderValue(null, null)).toBe("");
    expect(parseHolder("s:4")).toEqual({ position_id: 4, workplace_id: null });
    expect(parseHolder("w:2")).toEqual({ position_id: null, workplace_id: 2 });
    expect(parseHolder("x:1")).toEqual({ position_id: null, workplace_id: null });
  });

  it("prüft Vorlagen", () => {
    expect(kitProblem(" ", [])).toMatch(/Namen/);
    expect(kitProblem("Büro", [])).toMatch(/mindestens eine Zeile/);
    expect(kitProblem("Büro", [{ label: "Monitor", count: "2", kindIds: [] }])).toMatch(/Art/);
    expect(kitProblem("Büro", [{ label: "Monitor", count: "12", kindIds: [1] }])).toMatch(
      /1 und 9/,
    );
    expect(kitProblem("Büro", [{ label: " Monitor ", count: "2", kindIds: [1] }])).toEqual([
      { label: "Monitor", count: 2, kind_ids: [1] },
    ]);
  });
});

describe("Stellen: Seiten", () => {
  it("zeigt die Liste ohne Anlegen für Lesende", async () => {
    stubFetch({ "GET /api/inventory/positions": [summary] });
    render(<PositionsPage roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("link", { name: "Sachbearbeitung Einkauf" })).toBeTruthy();
    expect(screen.getByText("Alex Beispiel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stelle anlegen" })).toBeNull();
  });

  it("sucht eine Person in Entra und legt die Stelle an", async () => {
    const calls = stubFetch({
      "GET /api/inventory/positions": [],
      "GET /api/inventory/master-data": {
        kinds: [],
        makers: [],
        reasons: [],
        departments: [{ id: 2, name: "Einkauf", used: 0 }],
        kits: [],
      },
      "GET /api/inventory/people": [
        {
          oid: "11111111-2222-3333-4444-555555555555",
          name: "Alex Beispiel",
          upn: "alex@example.com",
        },
      ],
      "POST /api/inventory/positions": position,
    });
    render(<PositionsPage roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Stelle anlegen" }));
    fireEvent.change(screen.getByLabelText("Bezeichnung"), {
      target: { value: "Sachbearbeitung Einkauf" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /^Abteilung/ }), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/Wer besetzt die Stelle/), {
      target: { value: "alex" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Alex Beispiel/ }));
    expect(screen.getByRole("button", { name: "Andere Person wählen" })).toBeTruthy();
    expect(calls.some((call) => call.url === "/api/inventory/people?q=alex")).toBe(true);

    const form = screen.getByRole("button", { name: "Stelle anlegen", hidden: false });
    fireEvent.click(form);
    await vi.waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Sachbearbeitung Einkauf",
      department_id: 2,
      person: {
        oid: "11111111-2222-3333-4444-555555555555",
        name: "Alex Beispiel",
        upn: "alex@example.com",
      },
      note: "",
    });
  });

  it("zeigt Übersicht, Arbeitsplätze und Verlauf einer Stelle", async () => {
    stubFetch({ "GET /api/inventory/positions/4": position });
    const { unmount } = render(
      <PositionDetailPage positionId={4} tab="arbeitsplaetze" roles={["Bestand.Reader"]} />,
    );
    expect(await screen.findByRole("link", { name: "AP-002" })).toBeTruthy();
    unmount();
    render(<PositionDetailPage positionId={4} tab="verlauf" roles={["Bestand.Reader"]} />);
    expect(await screen.findByText("Stelle angelegt")).toBeTruthy();
  });
});

describe("Arbeitsplätze: Ausstattung", () => {
  it("zeigt, was laut Vorlage fehlt", async () => {
    stubFetch({ "GET /api/inventory/workplaces/2": workplace });
    render(<WorkplaceDetailPage workplaceId={2} tab="ausstattung" roles={["Bestand.Reader"]} />);
    expect(await screen.findByText("Es fehlt noch etwas: 1 fehlt.")).toBeTruthy();
    expect(screen.getByText("1 von 2")).toBeTruthy();
    expect(screen.getAllByText("1 von 1")).toHaveLength(1);
  });
});

describe("Arbeitsplätze: Platz im Raum", () => {
  const location = {
    room_id: 9,
    room: "0.12",
    floor_id: 4,
    floor: "Erdgeschoss",
    section: "Bauteil A",
    site: "Haus Nord",
    city: "Musterstadt",
  };
  const floor = {
    id: 4,
    name: "Erdgeschoss",
    position: 0,
    section_id: 3,
    section: "Bauteil A",
    site_id: 2,
    site: "Haus Nord",
    city_id: 1,
    city: "Musterstadt",
    plan: null,
    rooms: [{ id: 9, name: "0.12", x: 10, y: 20, w: 40, h: 20, hardware: 0 }],
    workplaces: [],
  };

  it("rechnet einen Punkt der Etage in den Raum um", () => {
    expect(spotInRoom({ x: 20, y: 30 }, { x: 10, y: 20, w: 40, h: 20 })).toEqual({ x: 25, y: 50 });
    expect(spotInRoom({ x: 60, y: 30 }, { x: 10, y: 20, w: 40, h: 20 })).toBeNull();
  });

  it("setzt den Platz mit Zahlen und zeigt die Ortszeile", async () => {
    const placed = { ...workplace, location, spot_x: 25, spot_y: 50 };
    const calls = stubFetch({
      "GET /api/inventory/workplaces/2": { ...workplace, location },
      "GET /api/inventory/whereabouts/arbeitsplatz/2": {
        via: null,
        floors: [{ floor_id: 4, rooms: [location], workplace_ids: [2] }],
      },
      "GET /api/inventory/floors/4": floor,
      "PUT /api/inventory/workplaces/2/spot": placed,
    });
    render(<WorkplaceDetailPage workplaceId={2} tab="standort" roles={["Bestand.Editor"]} />);
    expect(
      await screen.findByRole("link", { name: /Raum 0\.12 · Erdgeschoss · Bauteil A/ }),
    ).toBeTruthy();
    expect(await screen.findByText("Der Platz im Raum ist noch nicht gesetzt.")).toBeTruthy();
    expect(screen.queryByLabelText("Bezeichnung")).toBeNull();
    fireEvent.click(screen.getByText("Platz mit Zahlen eingeben"));
    fireEvent.change(screen.getByLabelText("Von links im Raum (%)"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Von oben im Raum (%)"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ x: 25, y: 50 }),
    );
  });
});

describe("Arbeitsplätze: anlegen", () => {
  const floor = {
    id: 4,
    name: "Erdgeschoss",
    position: 0,
    section_id: 3,
    section: "Bauteil A",
    site_id: 2,
    site: "Haus Nord",
    city_id: 1,
    city: "Musterstadt",
    plan: { url: "/api/inventory/floors/4/plan?v=1", width: 1600, height: 1000 },
    rooms: [{ id: 9, name: "0.12", x: 10, y: 20, w: 40, h: 20, hardware: 0 }],
    workplaces: [],
  };

  it("verlangt einen Raum, zeigt den Grundriss und sucht Stellen", async () => {
    const calls = stubFetch({
      "GET /api/inventory/workplaces": [],
      "GET /api/inventory/assignees": { positions: [], workplaces: [] },
      "GET /api/inventory/locations": { cities: [] },
      "GET /api/inventory/master-data": {
        kinds: [],
        makers: [],
        reasons: [],
        departments: [],
        kits: [],
      },
      // Eine Antwort für beide Suchen: Raum und Stelle
      "GET /api/inventory/lookup": {
        items: [
          { id: 9, label: "Raum 0.12", detail: "Musterstadt / Haus Nord", floor_id: 4 },
          { id: 4, label: "ST-004 Einkauf", detail: "Alex Beispiel" },
        ],
        total: 2,
      },
      "GET /api/inventory/floors/4": floor,
      "POST /api/inventory/workplaces": { id: 12 },
    });
    render(<WorkplacesPage roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Arbeitsplatz anlegen" }));
    const form = await screen.findByRole("region", { name: "Arbeitsplatz anlegen" });
    fireEvent.click(within(form).getByRole("button", { name: "Arbeitsplatz anlegen" }));
    expect(await within(form).findByText("Bitte wähle einen Raum.")).toBeTruthy();
    expect(calls.some((call) => call.method === "POST")).toBe(false);

    const room = within(form).getByRole("combobox", { name: "Raum (Pflicht)" });
    fireEvent.focus(room);
    fireEvent.change(room, { target: { value: "0.12" } });
    fireEvent.click(await within(form).findByRole("option", { name: /Raum 0\.12/ }));
    // Gleich darunter der Grundriss der Etage, der Platz ist freiwillig
    expect(await within(form).findByText(/Freiwillig: Klick im Grundriss/)).toBeTruthy();

    const position = within(form).getByRole("combobox", { name: "Stelle hinzufügen" });
    fireEvent.focus(position);
    fireEvent.change(position, { target: { value: "einkauf" } });
    fireEvent.click(await within(form).findByRole("option", { name: /ST-004 Einkauf/ }));
    expect(within(form).getByText("ST-004 Einkauf")).toBeTruthy();

    fireEvent.click(within(form).getByRole("button", { name: "Arbeitsplatz anlegen" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        room_id: 9,
        shared: false,
        kit_id: null,
        position_ids: [4],
        note: "",
      }),
    );
  });
});
