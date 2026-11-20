import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterHardware,
  formatDay,
  hardwarePath,
  modelLabel,
  parseHardwarePath,
  today,
  type Hardware,
  type HardwareSummary,
  type MasterData,
} from "./api";
import { HardwareDetailPage } from "./HardwareDetailPage";
import { HardwarePage } from "./HardwarePage";
import { MasterDataPage } from "./MasterDataPage";

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

const master: MasterData = {
  kinds: [
    { id: 1, name: "Notebook", has_storage: true, used: 1 },
    { id: 2, name: "Monitor", has_storage: false, used: 1 },
  ],
  makers: [{ id: 5, name: "Hersteller A", models: [{ id: 9, name: "Notebook 14 G10", used: 1 }] }],
  reasons: [{ id: 3, name: "defekt", used: 0 }],
};

const notebook: HardwareSummary = {
  id: 7,
  name: "Notebook 14 Zoll",
  kind_id: 1,
  kind: "Notebook",
  maker: "Hersteller A",
  model: "Notebook 14 G10",
  serial: "5CG3291XYZ",
  inventory_no: "INV-24-0412",
  hostname: "NB-0142",
  source: "manuell",
  status: "aktiv",
  place: null,
};

const monitor: HardwareSummary = {
  ...notebook,
  id: 8,
  name: "Monitor 27 Zoll",
  kind_id: 2,
  kind: "Monitor",
  maker: null,
  model: null,
  serial: "CN0F3KDJ7781",
  inventory_no: null,
  hostname: "",
};

const detail: Hardware = {
  ...notebook,
  location: null,
  model_id: 9,
  maker_id: 5,
  note: "",
  has_storage: true,
  created_at: "2026-11-20T08:00:00Z",
  retire: null,
  events: [{ occurred_at: "2026-11-20T08:00:00Z", who: "Alex Beispiel", text: "Von Hand erfasst" }],
};

describe("Hilfsfunktionen", () => {
  it("baut und liest die Pfade eines Geräts", () => {
    expect(hardwarePath(7)).toBe("/bestand/hardware/7");
    expect(hardwarePath(7, "verlauf")).toBe("/bestand/hardware/7/verlauf");
    expect(parseHardwarePath("/bestand/hardware/7")).toEqual({ id: 7, tab: "uebersicht" });
    expect(parseHardwarePath("/bestand/hardware/7/verlauf")).toEqual({ id: 7, tab: "verlauf" });
    expect(parseHardwarePath("/bestand/hardware/x")).toBeNull();
    expect(parseHardwarePath("/bestand/hardware/7/technik")).toBeNull();
  });

  it("sucht in allen Kennungen und filtert nach Art", () => {
    const list = [notebook, monitor];
    expect(filterHardware(list, "inv-24", null)).toEqual([notebook]);
    expect(filterHardware(list, "cn0f3", null)).toEqual([monitor]);
    expect(filterHardware(list, "nb-0142", null)).toEqual([notebook]);
    expect(filterHardware(list, "hersteller a", null)).toEqual([notebook]);
    expect(filterHardware(list, "", 2)).toEqual([monitor]);
    expect(filterHardware(list, "notebook", 2)).toEqual([]);
  });

  it("formatiert Modell und Datum", () => {
    expect(modelLabel(notebook)).toBe("Hersteller A Notebook 14 G10");
    expect(modelLabel(monitor)).toBe("–");
    expect(formatDay("2026-11-20")).toBe("20.11.2026");
    expect(formatDay(null)).toBe("–");
    expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("Hardware-Liste", () => {
  it("zeigt Geräte, filtert und blendet Anlegen für Leser aus", async () => {
    stubFetch({
      "GET /api/inventory/hardware": [notebook, monitor],
      "GET /api/inventory/master-data": master,
    });
    render(<HardwarePage roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("link", { name: "Notebook 14 Zoll" })).toBeTruthy();
    expect(screen.getByText("2 von 2 Geräten")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gerät erfassen" })).toBeNull();
    // Jede Zelle trägt ihren Spaltennamen für die Kartenansicht.
    const cell = screen.getByText("5CG3291XYZ");
    expect(cell.getAttribute("data-label")).toBe("Seriennummer");

    fireEvent.change(screen.getByLabelText("Geräte durchsuchen"), {
      target: { value: "cn0f3" },
    });
    expect(screen.getByText("1 von 2 Geräten")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Notebook 14 Zoll" })).toBeNull();
  });

  it("fragt vor dem Anlegen mit Inventurnummer nach", async () => {
    const calls = stubFetch({
      "GET /api/inventory/hardware": [],
      "GET /api/inventory/master-data": master,
      "POST /api/inventory/hardware": { ...detail, id: 11 },
    });
    render(<HardwarePage roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerät erfassen" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerät anlegen" }));
    expect(await screen.findByText("Bitte eine Bezeichnung eintragen.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Bezeichnung"), {
      target: { value: "Notebook 14 Zoll" },
    });
    fireEvent.change(screen.getByLabelText("Art"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Inventurnummer (freiwillig)"), {
      target: { value: " INV-24-0500 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gerät anlegen" }));
    expect(screen.getByText("INV-24-0500")).toBeTruthy();
    expect(calls.some((call) => call.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Ja, Gerät anlegen" }));
    await vi.waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({
      kind_id: 1,
      name: "Notebook 14 Zoll",
      inventory_no: "INV-24-0500",
      model_id: null,
    });
  });
});

describe("Gerät", () => {
  it("zeigt die Übersicht und den Verlauf", async () => {
    stubFetch({
      "GET /api/inventory/hardware/7": detail,
      "GET /api/inventory/master-data": master,
    });
    const { unmount } = render(
      <HardwareDetailPage hardwareId={7} tab="uebersicht" roles={["Bestand.Reader"]} />,
    );
    expect(await screen.findByRole("heading", { name: "Notebook 14 Zoll" })).toBeTruthy();
    expect(screen.getByText("INV-24-0412")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ausmustern" })).toBeNull();
    unmount();

    render(<HardwareDetailPage hardwareId={7} tab="verlauf" roles={["Bestand.Reader"]} />);
    expect(await screen.findByText("Von Hand erfasst")).toBeTruthy();
    expect(screen.getByText("Alex Beispiel")).toBeTruthy();
  });

  it("ändert die Inventurnummer erst nach der Rückfrage", async () => {
    const calls = stubFetch({
      "GET /api/inventory/hardware/7": detail,
      "GET /api/inventory/master-data": master,
      "PUT /api/inventory/hardware/7/inventory-no": { ...detail, inventory_no: "INV-24-0999" },
    });
    render(<HardwareDetailPage hardwareId={7} tab="uebersicht" roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inventurnummer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Inventurnummer" }), {
      target: { value: "INV-24-0999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByText(/von INV-24-0412 auf INV-24-0999 ändern/)).toBeTruthy();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ja, übernehmen" }));
    expect(await screen.findByText("INV-24-0999")).toBeTruthy();
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      inventory_no: "INV-24-0999",
    });
  });

  it("verlangt beim Ausmustern die Bestätigung für den Datenträger", async () => {
    const calls = stubFetch({
      "GET /api/inventory/hardware/7": detail,
      "GET /api/inventory/master-data": master,
      "POST /api/inventory/hardware/7/retire": {
        ...detail,
        status: "ausgemustert",
        retire: {
          retired_on: "2026-11-20",
          reason: "defekt",
          whereabouts: "entsorgt",
          wiped: true,
          note: "",
        },
      },
    });
    render(<HardwareDetailPage hardwareId={7} tab="uebersicht" roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ausmustern" }));
    fireEvent.change(screen.getByLabelText("Grund"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Verbleib"), { target: { value: "entsorgt" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByRole("alert").textContent).toContain("Datenträger");

    fireEvent.click(screen.getByLabelText("Der Datenträger ist gelöscht oder vernichtet."));
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, ausmustern" }));
    const section = await screen.findByRole("region", { name: "Ausgemustert" });
    expect(within(section).getByText("entsorgt")).toBeTruthy();
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      reason_id: 3,
      whereabouts: "entsorgt",
      wiped: true,
    });
  });
});

describe("Stammdaten", () => {
  it("legt Einträge an und sperrt das Löschen verwendeter", async () => {
    const calls = stubFetch({
      "GET /api/inventory/master-data": master,
      "POST /api/inventory/reasons": {
        ...master,
        reasons: [...master.reasons, { id: 4, name: "veraltet", used: 0 }],
      },
    });
    render(<MasterDataPage roles={["Bestand.Editor"]} />);
    expect(await screen.findByText("Notebook")).toBeTruthy();
    const deletes = screen.getAllByRole("button", { name: "Löschen" });
    expect(deletes.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Gründe fürs Ausmustern" }));
    fireEvent.change(screen.getByLabelText("Neuer Grund"), { target: { value: "veraltet" } });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(await screen.findByText("veraltet")).toBeTruthy();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "veraltet" });
  });

  it("zeigt Lesern keine Bearbeitung", async () => {
    stubFetch({ "GET /api/inventory/master-data": master });
    render(<MasterDataPage roles={["Bestand.Reader"]} />);
    expect(await screen.findByText("Notebook")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Löschen" })).toBeNull();
    expect(screen.queryByLabelText("Neue Art")).toBeNull();
  });
});
