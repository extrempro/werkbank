import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FgAdminSettings, FgObjects, FgOverview, FgPolicies, FgPolicy } from "./api";
import { FortigateAdminPage } from "./FortigateAdminPage";
import {
  FortigateObjectsPage,
  FortigateOverviewPage,
  FortigatePoliciesPage,
} from "./FortigatePages";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const overview: FgOverview = {
  configured: true,
  can_refresh: false,
  devices: [
    {
      id: 1,
      name: "fw-edge",
      hostname: "fw-edge",
      model: "FortiGate 200G",
      version: "v7.6.1",
      ha: "Aktiv-Passiv · 2 Mitglieder",
      fabric: "Root",
      policies: 4,
      last_run_at: "2026-11-28T10:00:00Z",
      last_ok: true,
      error: null,
      data_at: "2026-11-28T10:00:00Z",
      notes: [],
    },
    {
      id: 2,
      name: "fw-standort-b",
      hostname: "fw-standort-b",
      model: "",
      version: "",
      ha: "kein HA",
      fabric: "Mitglied",
      policies: 0,
      last_run_at: "2026-11-28T10:00:00Z",
      last_ok: false,
      error: "Das Gerät ist nicht erreichbar.",
      data_at: null,
      notes: [],
    },
  ],
  reachable: 1,
  policies: 4,
  disabled: 0,
  changes_24h: 2,
};

const policy: FgPolicy = {
  device: "fw-edge",
  id: 7,
  position: 3,
  name: "Fernwartung Altsystem",
  status: true,
  srcintf: ["wan1"],
  dstintf: ["lan"],
  srcaddr: ["all"],
  dstaddr: ["VIP-Fernwartung"],
  srcaddr_negate: false,
  dstaddr_negate: false,
  internet_service: [],
  service: ["ALL"],
  service_negate: false,
  action: "accept",
  nat: "VIP",
  poolname: [],
  schedule: "always",
  log: "disable",
  profiles: {},
  users: [],
  comments: "<b>nicht fett</b>",
  hits: 41,
  last_used: "2026-11-25T10:00:00Z",
  first_used: null,
  bytes: null,
  open: { srcintf: false, dstintf: false, srcaddr: true, dstaddr: false, service: true },
  pair: "wan1 → lan",
  match: "",
};

const policies: FgPolicies = {
  rows: [
    policy,
    {
      ...policy,
      id: 12,
      position: 1,
      name: "LAN ins Internet",
      srcaddr: ["Netz-Buero"],
      open: { ...policy.open, srcaddr: false, service: false },
      service: ["HTTPS"],
    },
  ],
  total: 9,
  devices: ["fw-edge", "fw-standort-b"],
  pairs: ["wan1 → lan"],
  query: "",
};

const objects: FgObjects = {
  kind: "address_groups",
  rows: [
    {
      name: "Grp-Server",
      value: "unterschiedlich je Gerät",
      same_value: false,
      devices: [
        {
          device: "fw-edge",
          value: "3 Mitglieder",
          fabric: true,
          members: ["srv-a", "srv-b"],
          groups: [],
          comment: "",
        },
        {
          device: "fw-standort-b",
          value: "2 Mitglieder",
          fabric: true,
          members: ["srv-a"],
          groups: [],
          comment: "",
        },
      ],
      uses: 2,
      used_in: [
        { device: "fw-edge", id: 31, name: "Büro zu Servern", field: "Ziel", via_group: false },
      ],
      match: "",
      member_table: [
        { member: "srv-a", devices: { "fw-edge": true, "fw-standort-b": true } },
        { member: "srv-b", devices: { "fw-edge": true, "fw-standort-b": false } },
      ],
    },
  ],
  counts: { addresses: 10, address_groups: 1, services: 5, service_groups: 1, vips: 1 },
  devices: ["fw-edge", "fw-standort-b"],
  query: "",
};

function stub(routes: Record<string, unknown>, calls: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const key = Object.keys(routes).find((prefix) => `${method} ${url}`.startsWith(prefix));
      if (!key) {
        return new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
      }
      return new Response(JSON.stringify(routes[key]), { status: 200 });
    }),
  );
  return calls;
}

describe("FortiGate", () => {
  it("zeigt Übersicht mit Geräten und den Fehler eines Geräts", async () => {
    stub({ "GET /api/monitoring/fortigate/overview": overview });
    render(<FortigateOverviewPage roles={["FortiGate.Reader"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Übersicht" })).toBeInTheDocument();
    expect(screen.getByText("1 nicht erreichbar")).toBeInTheDocument();
    expect(screen.getByText(/fw-standort-b: Das Gerät ist nicht erreichbar/)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /fw-edge/ })).toHaveTextContent("Aktiv-Passiv");
    expect(screen.queryByRole("button", { name: "Jetzt abrufen" })).not.toBeInTheDocument();
  });

  it("markiert offene Felder und zeigt die Detailansicht", async () => {
    const calls = stub({
      "GET /api/monitoring/fortigate/overview": overview,
      "GET /api/monitoring/fortigate/policies": policies,
    });
    render(<FortigatePoliciesPage roles={["FortiGate.Reader", "FortiGate.Editor"]} />);
    const table = await screen.findByRole("table", { name: "Policies" });
    const row = within(table).getByRole("row", { name: /Fernwartung Altsystem/ });
    expect(within(row).getAllByText("(offen)")).toHaveLength(2);
    expect(screen.getByText("2 von 9 Policies")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /fw-edge/ }));
    const detail = await screen.findByRole("complementary", { name: "Detail der Policy" });
    expect(
      within(detail).getByRole("heading", { name: "Fernwartung Altsystem" }),
    ).toBeInTheDocument();
    expect(within(detail).getByText("<b>nicht fett</b>")).toBeInTheDocument();
    expect(window.location.search).toContain("auswahl=fw-edge%3A7");
    expect(screen.getByRole("button", { name: "Jetzt abrufen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CSV exportieren" })).toHaveAttribute(
      "href",
      "/api/monitoring/fortigate/policies.csv",
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Suchen" }), {
      target: { value: "10.20.30.15" },
    });
    await waitFor(() =>
      expect(calls.some((call) => call.includes("policies?q=10.20.30.15"))).toBe(true),
    );
  });

  it("zeigt Mitglieder je Gerät und Verweise auf Policies", async () => {
    window.history.replaceState(null, "", "/monitoring/fortigate/objekte?art=address_groups");
    stub({
      "GET /api/monitoring/fortigate/overview": overview,
      "GET /api/monitoring/fortigate/objects": objects,
    });
    render(<FortigateObjectsPage />);
    const table = await screen.findByRole("table", { name: "Adressgruppen" });
    fireEvent.click(within(table).getByRole("button", { name: "Grp-Server" }));
    const detail = await screen.findByRole("complementary", { name: "Detail des Objekts" });
    const members = within(detail).getByRole("row", { name: /srv-b/ });
    expect(members).toHaveTextContent("fehlt");
    expect(within(detail).getByRole("link", { name: /Policy #31/ })).toHaveAttribute(
      "href",
      "/monitoring/fortigate/policies?geraet=fw-edge&q=%2331&auswahl=fw-edge%3A31",
    );
    expect(within(table).getByText("ja (2/2)")).toBeInTheDocument();
  });

  it("prüft das Gerät beim Anlegen und fragt vor dem Verkürzen der Aufbewahrung", async () => {
    const settings: FgAdminSettings = {
      interval_minutes: 60,
      intervals: [15, 30, 60, 120, 240],
      retention_months: 3,
      ca_set: false,
      analyzer_enabled: false,
      analyzer_url: "",
      analyzer_adom: "root",
      analyzer_key_set: false,
      token_storage_available: true,
      devices: [],
    };
    const calls = stub({
      "GET /api/admin/settings/fortigate/retention-preview": { runs: 12, snapshots: 4 },
      "GET /api/admin/settings/fortigate": settings,
      "PUT /api/admin/settings/fortigate": { ...settings, retention_months: 1 },
    });
    render(<FortigateAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerät hinzufügen" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), {
      target: { value: "fw edge" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(screen.getByText(/Nur Buchstaben, Ziffern/)).toBeInTheDocument();
    expect(screen.getByText("Das API-Token fehlt.")).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    fireEvent.change(screen.getByRole("combobox", { name: /Aufbewahrung/ }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Aufbewahrung auf 1 Monat/ });
    expect(dialog).toHaveTextContent("12 Abrufe und 4 Konfigurationsstände");
    expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Verkürzen" }));
    await waitFor(() => expect(calls.some((call) => call.startsWith("PUT"))).toBe(true));
    expect(
      await screen.findByText("Die Einstellungen für FortiGate sind gespeichert."),
    ).toBeInTheDocument();
  });
});
