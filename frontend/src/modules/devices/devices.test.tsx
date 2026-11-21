import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  intuneUrl,
  looksLikeDeviceLink,
  type Device,
  type DeviceList,
  type ScanResult,
} from "./api";
import { DeviceAssociationPage } from "./DeviceAssociationPage";

// Kamera und WASM gibt es in jsdom nicht: Der Scanner liefert per Knopf einen Code.
const QR = "devicelink:/1/?sn=TEST-0001&data=abc";
vi.mock("./Scanner", () => ({
  Scanner: ({ onCode }: { onCode: (text: string) => void }) => (
    <button type="button" onClick={() => onCode(QR)}>
      Code erkannt
    </button>
  ),
}));

type Route = unknown | ((body: unknown) => unknown);
let calls: { url: string; method: string; body: unknown }[] = [];

function stubFetch(routes: Record<string, Route>) {
  calls = [];
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
      if (!key) {
        return new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
      }
      const value = routes[key];
      return new Response(
        JSON.stringify(
          typeof value === "function" ? (value as (b: unknown) => unknown)(body) : value,
        ),
        { status: 200 },
      );
    }),
  );
}

const base: Device = {
  id: 1,
  serial_number: "TEST-0001",
  manufacturer: "Beispiel AG",
  model: "Notebook 14",
  status: "freigabe",
  association_state: null,
  policy_name: null,
  scanned_by: "Erika Muster",
  scanned_at: "2026-11-21T08:00:00Z",
  approved_by: null,
  approved_admin: null,
  approved_at: null,
  associated_at: null,
  enrolled_at: null,
  link_expires_at: "2026-11-22T08:00:00Z",
  request_id: null,
  last_error: null,
  device_name: null,
  compliance: null,
  user_principal_name: null,
  managed_device_id: null,
  last_checked_at: null,
};

const enrolled: Device = {
  ...base,
  id: 2,
  serial_number: "TEST-0002",
  status: "registriert",
  approved_by: "Max Beispiel",
  approved_admin: "admin@example.com",
  approved_at: "2026-11-20T08:00:00Z",
  associated_at: "2026-11-20T08:10:00Z",
  enrolled_at: "2026-11-20T08:30:00Z",
  device_name: "PC-0002",
  managed_device_id: "11111111-2222-3333-4444-555555555555",
  link_expires_at: null,
};

function list(entries: Device[]): DeviceList {
  return {
    entries,
    counts: { freigabe: 1, vorab: 0, zugeordnet: 0, registriert: 1, nicht_abgeschlossen: 0 },
    last_run: "2026-11-21T08:55:00Z",
    monitor: true,
  };
}

const scan: ScanResult = {
  serial_number: "TEST-0001",
  manufacturer: "Beispiel AG",
  model: "Notebook 14",
  link_id: "00000000-0000-0000-0000-000000000001",
  generated_at: "2026-11-21T08:00:00Z",
  admin_connected: true,
  admin_upn: "admin@example.com",
  tenant_name: "Beispiel-Tenant",
  policies: [{ id: "p1", name: "Testrichtlinie Büro" }],
  duplicate: null,
  problem: null,
};

const ADMIN_ON = { connected: true, upn: "admin@example.com", name: "Admin", expires_at: null };
const ADMIN_OFF = { connected: false, upn: null, name: null, expires_at: null };

beforeEach(() => {
  window.history.replaceState(null, "", "/m365/geraete/zuordnung");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Hilfsfunktionen", () => {
  it("erkennt nur QR-Codes aus der Windows-Einrichtung", () => {
    expect(looksLikeDeviceLink(QR)).toBe(true);
    expect(looksLikeDeviceLink("  DEVICELINK:/1/?a=b")).toBe(true);
    expect(looksLikeDeviceLink("https://example.com")).toBe(false);
  });

  it("baut den Intune-Link nur mit gültiger Kennung", () => {
    expect(intuneUrl(enrolled)).toContain("11111111-2222-3333-4444-555555555555");
    expect(intuneUrl({ ...enrolled, managed_device_id: "x/../y" })).toBeNull();
    expect(intuneUrl(base)).toBeNull();
  });
});

describe("Gerätezuordnung", () => {
  it("zeigt ohne Admin-Konto die Anmeldung, Hinweis auf wartende Geräte und die Liste", async () => {
    stubFetch({
      "GET /api/devices/admin": ADMIN_OFF,
      "GET /api/devices/entries": list([base, enrolled]),
    });
    render(<DeviceAssociationPage />);
    const login = await screen.findByRole("link", { name: "Mit Admin-Konto anmelden" });
    expect(login).toHaveAttribute("href", "/api/devices/admin/login");
    expect(await screen.findByText(/Geräte? wurden? gescannt/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Geräte" });
    expect(within(table).getByText("TEST-0001")).toBeInTheDocument();
    expect(within(table).getAllByText("In Intune registriert").length).toBeGreaterThan(0);
  });

  it("meldet die Rückkehr von der Anmeldung und räumt die Adresse auf", async () => {
    window.history.replaceState(null, "", "/m365/geraete/zuordnung?admin=fehler");
    stubFetch({
      "GET /api/devices/admin": ADMIN_OFF,
      "GET /api/devices/entries": list([]),
    });
    render(<DeviceAssociationPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("hat nicht geklappt");
    expect(window.location.search).toBe("");
  });

  it("sendet ohne Admin-Konto zur Freigabe", async () => {
    stubFetch({
      "GET /api/devices/admin": ADMIN_OFF,
      "GET /api/devices/entries": list([]),
      "POST /api/devices/scan": {
        ...scan,
        admin_connected: false,
        policies: [],
        tenant_name: null,
      },
      "POST /api/devices/entries/pending": base,
    });
    render(<DeviceAssociationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /QR-Code scannen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Code erkannt" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zur Freigabe senden" }));
    expect(await screen.findByText(/Zur Freigabe gesendet/)).toBeInTheDocument();
    expect(calls.find((call) => call.url === "/api/devices/entries/pending")?.body).toEqual({
      qr: QR,
      policy_id: null,
    });
  });

  it("gibt mit Admin-Konto erst nach Bestätigung des Tenants frei", async () => {
    stubFetch({
      "GET /api/devices/admin": ADMIN_ON,
      "GET /api/devices/entries": list([]),
      "POST /api/devices/scan": scan,
      "POST /api/devices/entries/import": {
        ok: true,
        entry: { ...base, status: "vorab" },
        duplicate: null,
        error: null,
      },
    });
    render(<DeviceAssociationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /QR-Code scannen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Code erkannt" }));
    const go = await screen.findByRole("button", { name: "Jetzt freigeben" });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Device-Preparation-Richtlinie"), {
      target: { value: "p1" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Beispiel-Tenant/ }));
    fireEvent.click(go);
    expect(await screen.findByText(/Jetzt am Gerät auf „Weiter“ klicken/)).toBeInTheDocument();
    expect(calls.find((call) => call.url === "/api/devices/entries/import")?.body).toEqual({
      qr: QR,
      policy_id: "p1",
    });
  });

  it("zeigt bei 5xx die Voraussetzungen und die Request-ID", async () => {
    stubFetch({
      "GET /api/devices/admin": ADMIN_ON,
      "GET /api/devices/entries": list([]),
      "POST /api/devices/scan": scan,
      "POST /api/devices/entries/import": {
        ok: false,
        entry: null,
        duplicate: null,
        error: {
          kind: "nicht_zuordenbar",
          title: "Microsoft konnte das Gerät nicht zuordnen",
          detail: "Meist erfüllt das Gerät die Voraussetzungen nicht.",
          requirements: ["Secure Boot ist eingeschaltet"],
          request_id: "00000000-test-0500",
        },
      },
    });
    render(<DeviceAssociationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /QR-Code scannen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Code erkannt" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Beispiel-Tenant/ }));
    fireEvent.click(screen.getByRole("button", { name: "Jetzt freigeben" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Secure Boot ist eingeschaltet");
    expect(alert).toHaveTextContent("00000000-test-0500");
  });

  it("sperrt Duplikate und bietet den vorhandenen Eintrag an", async () => {
    stubFetch({
      "GET /api/devices/admin": ADMIN_ON,
      "GET /api/devices/entries": list([]),
      "POST /api/devices/scan": {
        ...scan,
        duplicate: { graph_id: "g1", association_state: "associated", entry_id: 2 },
      },
      "GET /api/devices/entries/2": enrolled,
    });
    render(<DeviceAssociationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /QR-Code scannen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Code erkannt" }));
    expect(await screen.findByText(/Ein zweiter Import ist gesperrt/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jetzt freigeben" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Eintrag öffnen" }));
    const drawer = await screen.findByRole("dialog", { name: "Notebook 14" });
    expect(within(drawer).getByText("PC-0002", { selector: "dd" })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: /In Intune öffnen/ })).toBeInTheDocument();
  });

  it("gibt ein wartendes Gerät frei (auch eine andere Person)", async () => {
    stubFetch({
      "GET /api/devices/admin": ADMIN_ON,
      "GET /api/devices/entries": list([base]),
      "GET /api/devices/policies": {
        tenant_name: "Beispiel-Tenant",
        policies: scan.policies,
        problem: null,
      },
      "POST /api/devices/entries/1/approve": {
        ok: true,
        entry: { ...base, status: "vorab", approved_by: "Max Beispiel" },
        duplicate: null,
        error: null,
      },
    });
    render(<DeviceAssociationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "TEST-0001" }));
    const drawer = await screen.findByRole("dialog", { name: "Notebook 14" });
    expect(within(drawer).getByText(/verschlüsselt/)).toBeInTheDocument();
    await within(drawer).findByLabelText("Device-Preparation-Richtlinie");
    fireEvent.click(within(drawer).getByRole("button", { name: "Jetzt freigeben" }));
    expect(await screen.findByText(/Vorab zugeordnet\. Jetzt am Gerät/)).toBeInTheDocument();
  });

  it("verwirft nach Rückfrage", async () => {
    stubFetch({
      "GET /api/devices/admin": ADMIN_OFF,
      "GET /api/devices/entries": list([base]),
      "DELETE /api/devices/entries/1": { ok: true },
    });
    render(<DeviceAssociationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "TEST-0001" }));
    const drawer = await screen.findByRole("dialog", { name: "Notebook 14" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Verwerfen" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    fireEvent.click(within(drawer).getByRole("button", { name: /Verwerfen/ }));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(await screen.findByText(/Gerätedaten gelöscht/)).toBeInTheDocument();
  });
});
