import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampRect,
  firstFloorId,
  locationPath,
  parseLocationPath,
  rectFromPoints,
  roomChoices,
  searchLocations,
  type Floor,
  type Hardware,
  type Locations,
} from "./api";
import { HardwareDetailPage } from "./HardwareDetailPage";
import { LocationsPage } from "./LocationsPage";

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

const tree: Locations = {
  cities: [
    {
      id: 1,
      name: "Musterstadt",
      sites: [
        {
          id: 2,
          name: "Haus Nord",
          sections: [
            {
              id: 3,
              name: "Bauteil A",
              floors: [
                {
                  id: 4,
                  name: "Erdgeschoss",
                  position: 0,
                  has_plan: true,
                  rooms: [
                    { id: 9, name: "Büro 0.12" },
                    { id: 10, name: "Lager" },
                  ],
                },
                { id: 5, name: "1. Obergeschoss", position: 1, has_plan: false, rooms: [] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const floor: Floor = {
  id: 4,
  name: "Erdgeschoss",
  position: 0,
  section_id: 3,
  section: "Bauteil A",
  site_id: 2,
  site: "Haus Nord",
  city_id: 1,
  city: "Musterstadt",
  plan: { url: "/api/inventory/floors/4/plan?v=abc", width: 1600, height: 1000 },
  rooms: [
    { id: 9, name: "Büro 0.12", x: 10, y: 10, w: 20, h: 15, hardware: 1 },
    { id: 10, name: "Lager", x: 50, y: 40, w: 10, h: 10, hardware: 0 },
  ],
};

describe("Standorte: Hilfsfunktionen", () => {
  it("baut und liest die Pfade", () => {
    expect(locationPath(4)).toBe("/bestand/standorte/etage/4");
    expect(locationPath(4, 9)).toBe("/bestand/standorte/etage/4/raum/9");
    expect(parseLocationPath("/bestand/standorte")).toEqual({ floorId: null, roomId: null });
    expect(parseLocationPath("/bestand/standorte/etage/4/raum/9")).toEqual({
      floorId: 4,
      roomId: 9,
    });
    expect(parseLocationPath("/bestand/standorte/etage/x")).toBeNull();
  });

  it("begrenzt Rechtecke auf den Grundriss", () => {
    expect(clampRect({ x: -5, y: 95, w: 20, h: 10 })).toEqual({ x: 0, y: 90, w: 20, h: 10 });
    expect(clampRect({ x: 1.234, y: 2, w: 0.2, h: 300 })).toEqual({ x: 1.23, y: 0, w: 1, h: 100 });
    expect(rectFromPoints({ x: 40, y: 30 }, { x: 10, y: 50 })).toEqual({
      x: 10,
      y: 30,
      w: 30,
      h: 20,
    });
  });

  it("sucht Räume und Etagen und gruppiert die Raumauswahl", () => {
    const hits = searchLocations(tree, "büro");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "Raum", floorId: 4, roomId: 9 });
    expect(searchLocations(tree, "nord")[0]).toMatchObject({ kind: "Standort", floorId: 4 });
    expect(searchLocations(tree, " ")).toEqual([]);
    expect(firstFloorId(tree)).toBe(4);
    expect(firstFloorId({ cities: [] })).toBeNull();
    const groups = roomChoices(tree);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toContain("Erdgeschoss");
  });
});

describe("Standorte: Seite", () => {
  it("zeigt Baum, Grundriss und Räume für Leser ohne Bearbeitung", async () => {
    stubFetch({
      "GET /api/inventory/locations": tree,
      "GET /api/inventory/floors/4": floor,
    });
    render(<LocationsPage floorId={4} roomId={9} roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("heading", { name: "Erdgeschoss" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Raum Büro 0.12" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Räume bearbeiten" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Standorte pflegen" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Raum, Etage oder Standort suchen"), {
      target: { value: "lager" },
    });
    expect(screen.getAllByText("Lager").length).toBeGreaterThan(0);
  });

  it("speichert die Lage eines Raums über die Zahlenfelder", async () => {
    const calls = stubFetch({
      "GET /api/inventory/locations": tree,
      "GET /api/inventory/floors/4": floor,
      "PUT /api/inventory/rooms/10": floor,
    });
    render(<LocationsPage floorId={4} roomId={10} roles={["Bestand.Editor"]} />);
    expect(await screen.findByRole("heading", { name: "Raum Lager" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Von links"), { target: { value: "95,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Raum speichern" }));
    await vi.waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.body).toEqual({ name: "Lager", x: 90, y: 40, w: 10, h: 10 });
  });
});

describe("Gerät: Standort", () => {
  it("zeigt den Raum auf dem Grundriss", async () => {
    const device: Hardware = {
      id: 7,
      name: "Notebook 14 Zoll",
      kind_id: 1,
      kind: "Notebook",
      maker: null,
      model: null,
      serial: "",
      inventory_no: null,
      hostname: "",
      source: "manuell",
      status: "aktiv",
      place: "Büro 0.12 · Haus Nord, Erdgeschoss",
      holder: null,
      holder_ref: null,
      position_id: null,
      workplace_id: null,
      ninja: null,
      location: {
        room_id: 9,
        room: "Büro 0.12",
        floor_id: 4,
        floor: "Erdgeschoss",
        section: "Bauteil A",
        site: "Haus Nord",
        city: "Musterstadt",
      },
      model_id: null,
      maker_id: null,
      note: "",
      has_storage: true,
      created_at: "2026-11-20T08:00:00Z",
      retire: null,
      events: [],
    };
    stubFetch({
      "GET /api/inventory/hardware/7": device,
      "GET /api/inventory/floors/4": floor,
    });
    render(<HardwareDetailPage hardwareId={7} tab="standort" roles={["Bestand.Reader"]} />);
    expect(await screen.findByText("Raum Büro 0.12")).toBeTruthy();
    const selected = await screen.findByRole("button", { name: "Büro 0.12", pressed: true });
    expect(selected).toBeTruthy();
  });
});
