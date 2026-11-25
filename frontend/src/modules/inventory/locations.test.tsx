import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampRect,
  firstFloorId,
  levelPath,
  locationPath,
  parseLocationPath,
  pointToPlan,
  pointToView,
  rectFromPoints,
  rectToPlan,
  rectToView,
  searchLocations,
  type Floor,
  type Hardware,
  type Locations,
} from "./api";
import { navigate } from "../../router";
import { HardwareDetailPage } from "./HardwareDetailPage";
import { LocationsPage } from "./LocationsPage";
import { PlanView } from "./PlanView";

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
                  workplaces_free: 3,
                },
                {
                  id: 5,
                  name: "1. Obergeschoss",
                  position: 1,
                  has_plan: false,
                  rooms: [],
                  workplaces_free: 0,
                },
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
  plan: { url: "/api/inventory/floors/4/plan?v=abc", width: 1600, height: 1000, rotation: 0 },
  rooms: [
    {
      id: 9,
      name: "Büro 0.12",
      description: "Büro",
      x: 10,
      y: 10,
      w: 20,
      h: 15,
      hardware: 1,
      workplaces: 1,
      workplaces_free: 0,
      people: ["Ina Beispiel"],
    },
    {
      id: 10,
      name: "Lager",
      description: "",
      x: 50,
      y: 40,
      w: 10,
      h: 10,
      hardware: 0,
      workplaces: 0,
      workplaces_free: 0,
      people: [],
    },
  ],
  workplaces: [
    {
      id: 2,
      number: "AP-002",
      room_id: 9,
      x: 15,
      y: 14,
      shared: false,
      positions: [{ number: "ST-004", name: "Einkauf", person_name: "Alex Beispiel" }],
      hardware: [{ name: "Notebook A", kind: "Notebook" }],
      hardware_more: 2,
    },
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
    expect(parseLocationPath("/bestand/standorte/abschnitt/3")).toEqual({
      floorId: null,
      roomId: null,
      node: { level: "abschnitt", id: 3 },
    });
    expect(parseLocationPath("/bestand/standorte/gebaeude/3")).toBeNull();
    expect(levelPath("stadt", 1)).toBe("/bestand/standorte/stadt/1");
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

  it("dreht Punkte und Rechtecke für die Anzeige und zurück", () => {
    const point = { x: 10, y: 20 };
    expect(pointToView(point, 90)).toEqual({ x: 80, y: 10 });
    expect(pointToView(point, 180)).toEqual({ x: 90, y: 80 });
    expect(pointToView(point, 270)).toEqual({ x: 20, y: 90 });
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(pointToPlan(pointToView(point, rotation), rotation)).toEqual(point);
      const rect = { x: 10, y: 20, w: 30, h: 15 };
      expect(rectToPlan(rectToView(rect, rotation), rotation)).toEqual(rect);
    }
    // Quer wird hoch: Breite und Höhe tauschen
    expect(rectToView({ x: 10, y: 20, w: 30, h: 15 }, 90)).toEqual({ x: 65, y: 10, w: 15, h: 30 });
  });

  it("sucht Räume und Etagen und gruppiert die Raumauswahl", () => {
    const hits = searchLocations(tree, "büro");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "Raum", href: "/bestand/standorte/etage/4/raum/9" });
    expect(searchLocations(tree, "nord")[0]).toMatchObject({
      kind: "Standort",
      href: "/bestand/standorte/standort/2",
    });
    expect(searchLocations(tree, " ")).toEqual([]);
    expect(firstFloorId(tree)).toBe(4);
    expect(firstFloorId({ cities: [] })).toBeNull();
  });
});

describe("Standorte: gedrehter Grundriss", () => {
  it("dreht Bild, Räume und Plätze, speichert aber ungedreht", () => {
    const turned: Floor = { ...floor, plan: { ...floor.plan!, rotation: 90 } };
    const onPlace = vi.fn();
    render(
      <PlanView
        floor={turned}
        selectedId={null}
        spots={[{ id: 2, x: 15, y: 14, label: "AP-002", on: true }]}
        placing
        label="Grundriss"
        onPlace={onPlace}
      />,
    );
    const box = screen.getByRole("group", { name: "Grundriss" });
    // Hochkant: Seitenverhältnis getauscht, Bild gedreht
    expect(box.style.aspectRatio).toBe("1000 / 1600");
    expect(box.querySelector("img")).toHaveClass("plan-image-turn-90");
    const room = screen.getByRole("button", { name: "Büro 0.12" }).parentElement!;
    expect(room.style.left).toBe("75%");
    expect(room.style.top).toBe("10%");
    expect(room.style.width).toBe("15%");
    expect(room.style.height).toBe("20%");
    const spot = box.querySelector<HTMLElement>(".plan-spot")!;
    expect(spot.style.left).toBe("86%");
    expect(spot.style.top).toBe("15%");
    // Klick in der Anzeige oben rechts = oben links im ungedrehten Bild
    box.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 160, right: 100, bottom: 160 }) as DOMRect;
    fireEvent.pointerDown(box, { clientX: 90, clientY: 16 });
    expect(onPlace).toHaveBeenCalledWith({ x: 10, y: 10 });
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
    expect(put?.body).toEqual({ name: "Lager", description: "", x: 90, y: 40, w: 10, h: 10 });
  });
});

describe("Standorte: Aufbau", () => {
  it("zeigt den Raum neben dem Grundriss mit seinen Arbeitsplätzen", async () => {
    stubFetch({
      "GET /api/inventory/locations": tree,
      "GET /api/inventory/floors/4": floor,
    });
    render(<LocationsPage floorId={4} roomId={9} roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("heading", { name: "Raum Büro 0.12" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "AP-002" })).toHaveAttribute(
      "href",
      "/bestand/arbeitsplaetze/2",
    );
    // Pfad zum Anklicken statt Text; die Liste der Räume ist durch den Raum ersetzt
    expect(screen.getByRole("link", { name: "Bauteil A" })).toHaveAttribute(
      "href",
      "/bestand/standorte/abschnitt/3",
    );
    expect(screen.queryByRole("group", { name: "Räume dieser Etage" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "‹ Alle Räume" }));
    expect(vi.mocked(navigate)).toHaveBeenCalledWith("/bestand/standorte/etage/4");
  });

  it("klappt Ebenen im Baum auf und zu und blendet den Baum aus", async () => {
    stubFetch({
      "GET /api/inventory/locations": tree,
      "GET /api/inventory/floors/4": floor,
    });
    const { container } = render(
      <LocationsPage floorId={4} roomId={null} roles={["Bestand.Reader"]} />,
    );
    const toggle = await screen.findByRole("button", { name: "Bauteil A zuklappen" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Erdgeschoss/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Bauteil A aufklappen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("link", { name: /1\. Obergeschoss/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Standortbaum ausblenden" }));
    expect(container.querySelector(".loc-layout-wide")).not.toBeNull();
    expect(window.localStorage.getItem("werkbank-standortbaum")).toBe("aus");
    fireEvent.click(screen.getByRole("button", { name: "Standortbaum einblenden" }));
    expect(container.querySelector(".loc-layout-wide")).toBeNull();
  });

  it("wechselt zwischen kompakter und ausführlicher Ansicht und merkt sie sich", async () => {
    window.localStorage.setItem("werkbank-standortbaum-abstand", "weit");
    stubFetch({ "GET /api/inventory/locations": tree, "GET /api/inventory/floors/4": floor });
    render(<LocationsPage floorId={4} roomId={null} roles={["Bestand.Reader"]} />);
    const nav = await screen.findByRole("navigation", { name: "Standorte" });
    // Vorgabe: ausführlich mit Kennzahlen unter dem Namen
    expect(nav).toHaveAttribute("data-view", "ausfuehrlich");
    expect(screen.getByRole("button", { name: "Ausführlich" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const city = within(nav).getByRole("link", { name: /Musterstadt/ });
    expect(city).toHaveTextContent("1 Standort · 2 Etagen · 2 Räume · 3 freie Plätze");
    const upper = within(nav).getByRole("link", { name: /1\. Obergeschoss/ });
    expect(upper).toHaveTextContent("0 Räume · ohne Grundriss");

    fireEvent.click(screen.getByRole("button", { name: "Kompakt" }));
    expect(nav).toHaveAttribute("data-view", "kompakt");
    expect(window.localStorage.getItem("werkbank-standortbaum-ansicht")).toBe("kompakt");
    expect(window.localStorage.getItem("werkbank-standortbaum-abstand")).toBeNull();
    // Kompakt: ganzer Name und Kennzahlen im Tooltip und für Screenreader
    const compact = within(nav).getByRole("link", { name: /Musterstadt/ });
    expect(compact).toHaveAttribute(
      "title",
      "Musterstadt · 1 Standort · 2 Etagen · 2 Räume · 3 freie Plätze",
    );
    expect(compact).toHaveAccessibleName(/Musterstadt, 1 Standort/);
  });

  it("klappt mit „Alles einklappen“ den ganzen Baum zu", async () => {
    stubFetch({ "GET /api/inventory/locations": tree, "GET /api/inventory/floors/4": floor });
    render(<LocationsPage floorId={4} roomId={null} roles={["Bestand.Reader"]} />);
    const nav = await screen.findByRole("navigation", { name: "Standorte" });
    expect(within(nav).getByRole("link", { name: /Erdgeschoss/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Alles einklappen" }));
    expect(within(nav).queryByRole("link", { name: /Erdgeschoss/ })).toBeNull();
    expect(within(nav).getByRole("button", { name: "Musterstadt aufklappen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("zeigt einen Abschnitt mit seinen Etagen und legt dort eine neue an", async () => {
    const calls = stubFetch({
      "GET /api/inventory/locations": tree,
      "POST /api/inventory/floors": { ...floor, id: 6, name: "Keller", rooms: [], workplaces: [] },
    });
    render(
      <LocationsPage
        floorId={null}
        roomId={null}
        node={{ level: "abschnitt", id: 3 }}
        roles={["Bestand.Editor"]}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Bauteil A" })).toBeTruthy();
    expect(screen.getByText("Gebäudeabschnitt")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "1. Obergeschoss" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Standorte pflegen" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Neue Etage"), { target: { value: "Keller" } });
    fireEvent.click(
      within(screen.getByRole("region", { name: "Bauteil A" })).getByRole("button", {
        name: "Anlegen",
      }),
    );
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        name: "Keller",
        section_id: 3,
        position: 0,
      }),
    );
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
      connected_to: null,
      monitors: [],
      psref: null,
      loan: null,
      purchased_on: null,
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
      "GET /api/inventory/whereabouts/geraet/7": {
        via: null,
        floors: [{ floor_id: 4, rooms: [device.location], workplace_ids: [2] }],
      },
    });
    render(<HardwareDetailPage hardwareId={7} tab="standort" roles={["Bestand.Reader"]} />);
    expect(await screen.findByText("Raum Büro 0.12")).toBeTruthy();
    expect(await screen.findByText("AP-002", { selector: ".plan-spot-label" })).toBeTruthy();
    const spot = screen.getByRole("button", { name: /^AP-002 · Raum Büro 0\.12 · einzeln/ });
    expect(spot.getAttribute("aria-label")).toContain("ST-004 Einkauf – Alex Beispiel");
    expect(spot.getAttribute("aria-label")).toContain(
      "Hardware: Notebook A (Notebook) und 2 weitere",
    );
    fireEvent.pointerEnter(spot, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toContain("Alex Beispiel");
    fireEvent.pointerLeave(spot, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    fireEvent.click(spot);
    expect(vi.mocked(navigate)).toHaveBeenCalledWith("/bestand/arbeitsplaetze/2");
    expect(
      screen.getByRole("link", { name: /Raum Büro 0\.12 · Erdgeschoss · Bauteil A/ }),
    ).toBeTruthy();
    const selected = await screen.findByRole("button", { name: "Büro 0.12", pressed: true });
    expect(selected).toBeTruthy();
  });
});
