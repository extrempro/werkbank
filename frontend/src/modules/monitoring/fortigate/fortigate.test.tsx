import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FgAdminSettings,
  FgFindings,
  FgObjects,
  FgOverview,
  FgPolicies,
  FgPolicy,
  FgRules,
} from "./api";
import { FortigateAdminPage } from "./FortigateAdminPage";
import { FortigateFindingsPage } from "./FortigateFindingsPage";
import { FortigateUnusedPage } from "./FortigateUnusedPage";
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
  sync: [
    {
      device: "fw-edge",
      role: "Quelle",
      synchronisiert: 5,
      lokal: 2,
      abweichend: 1,
      kandidaten: 0,
    },
  ],
  reachable: 1,
  policies: 4,
  disabled: 0,
  changes_24h: 2,
  findings: { hoch: 1, mittel: 2, hinweis: 3, excepted: 1 },
};

const policy: FgPolicy = {
  findings: [
    { code: "wan_any_internal", rule: "Aus dem Internet von überall nach innen", severity: "hoch" },
  ],
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
      findings: [],
    },
  ],
  total: 9,
  devices: ["fw-edge", "fw-standort-b"],
  pairs: ["wan1 → lan"],
  query: "",
};

const objects: FgObjects = {
  kind: "address_groups",
  sync_bar: overview.sync,
  unused: 4,
  rows: [
    {
      name: "Grp-Server",
      sync: { state: "abweichend", label: "Sync abweichend", candidate: false },
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

const rules: FgRules = {
  rules: [
    {
      code: "any_any_all",
      severity: "hoch",
      title: "Alles erlaubt (any/any/ALL)",
      description: "Erlaubt Quelle „all“, Ziel „all“ und alle Dienste.",
      active: true,
    },
    {
      code: "no_hits",
      severity: "hinweis",
      title: "Keine Treffer im Zeitraum",
      description: "Die Policy hatte im eingestellten Zeitraum keinen Treffer.",
      active: true,
    },
  ],
  sensitive: ["dmz-server"],
  unused_days: 90,
  unused_days_options: [30, 60, 90, 180, 365],
};

const findings: FgFindings = {
  rows: [
    {
      key: "fw-edge|wan_any_internal|policy:7",
      code: "wan_any_internal",
      rule: "Aus dem Internet von überall nach innen",
      severity: "hoch",
      device: "fw-edge",
      label: "Policy 7 „Fernwartung Altsystem“",
      detail: "Von wan1 mit Quelle „all“ nach lan.",
      policy_id: 7,
      since: "2026-11-28T10:00:00Z",
      link: "/monitoring/fortigate/policies?geraet=fw-edge&q=%237&auswahl=fw-edge%3A7",
      exception: null,
    },
    {
      key: "|name_differs|addresses:srv-app",
      code: "name_differs",
      rule: "Gleicher Name, anderer Inhalt",
      severity: "mittel",
      device: "",
      label: "srv-app",
      detail: "fw-core: 10.20.31.10/32; fw-edge: 10.20.31.11/32",
      policy_id: null,
      since: null,
      link: "/monitoring/fortigate/objekte?art=addresses&q=srv-app&auswahl=srv-app",
      exception: null,
    },
  ],
  counts: { hoch: 1, mittel: 1, hinweis: 0 },
  excepted: 0,
  devices: ["fw-edge", "fw-core"],
  rules: rules.rules,
  can_except: true,
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
    expect(within(table).getByText("Sync abweichend")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nur unbenutzte anzeigen (4)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Objekt-Synchronisierung" })).toHaveTextContent(
      "1 abweichend",
    );
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
      "GET /api/admin/settings/fortigate/rules": rules,
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

  it("listet unbenutzte Objekte, filtert mit Schaltern und lädt die Aufräumliste", async () => {
    const unused = {
      rows: [
        {
          kind: "addresses",
          name: "Netz-Gast-alt",
          value: "10.99.0.0/24",
          devices: ["fw-edge", "fw-core"],
          reasons: ["keine Verwendung"],
          since: "2026-11-01T10:00:00Z",
          fabric: true,
        },
        {
          kind: "addresses",
          name: "test-host-1",
          value: "10.20.40.9/32",
          devices: ["fw-core"],
          reasons: ["nur in deaktivierten Einträgen: #52"],
          since: null,
          fabric: false,
        },
      ],
      counts: {
        addresses: 2,
        address_groups: 0,
        services: 0,
        service_groups: 0,
        vips: 0,
        ippools: 0,
      },
      devices: ["fw-edge", "fw-core"],
    };
    const calls = stub({
      "GET /api/monitoring/fortigate/unused": unused,
      "POST /api/monitoring/fortigate/unused/cleanup.csv": "Art;Name",
    });
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    render(<FortigateUnusedPage />);
    const table = await screen.findByRole("table", { name: "Unbenutzte Objekte" });
    expect(within(table).getByRole("row", { name: /Netz-Gast-alt/ })).toHaveTextContent(
      "Fabric-Objekt",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Nur in deaktivierten Policies/ }));
    await waitFor(() => expect(calls.some((call) => call.includes("disabled=false"))).toBe(true));
    const exportButton = await screen.findByRole("button", {
      name: "Auswahl als Aufräumliste (0)",
    });
    expect(exportButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Netz-Gast-alt für die Aufräumliste wählen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Auswahl als Aufräumliste (1)" }));
    expect(
      await screen.findByText(/Aufräumliste mit 1 Objekten ist heruntergeladen/),
    ).toBeInTheDocument();
    expect(
      calls.some((call) => call.startsWith("POST /api/monitoring/fortigate/unused/cleanup.csv")),
    ).toBe(true);
  });

  it("zeigt Befunde, nimmt einen als Ausnahme mit Begründung hin und prüft die Eingabe", async () => {
    const calls = stub({
      "GET /api/monitoring/fortigate/findings": findings,
      "POST /api/monitoring/fortigate/exceptions": { id: 3, expires_at: null },
    });
    render(<FortigateFindingsPage />);
    const table = await screen.findByRole("table", { name: "Befunde" });
    const row = within(table).getByRole("row", { name: /Fernwartung Altsystem/ });
    expect(row).toHaveTextContent("Hoch");
    expect(within(table).getByRole("row", { name: /srv-app/ })).toHaveTextContent("alle Geräte");
    fireEvent.click(within(row).getByRole("button", { name: /Aus dem Internet/ }));
    const detail = await screen.findByRole("complementary", { name: "Detail des Befunds" });
    expect(within(detail).getByRole("link", { name: "Policy ansehen" })).toHaveAttribute(
      "href",
      findings.rows[0]!.link,
    );
    fireEvent.click(within(detail).getByRole("button", { name: "Als Ausnahme hinnehmen" }));
    expect(within(detail).getByText(/Bitte gib eine Begründung an/)).toBeInTheDocument();
    fireEvent.change(within(detail).getByRole("textbox", { name: /Begründung/ }), {
      target: { value: "Fernwartung bewusst offen" },
    });
    fireEvent.click(within(detail).getByRole("radio", { name: /unbegrenzt/ }));
    fireEvent.click(within(detail).getByRole("button", { name: "Als Ausnahme hinnehmen" }));
    const dialog = await screen.findByRole("alertdialog", { name: /als Ausnahme hinnehmen/ });
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Hinnehmen" }));
    await waitFor(() => expect(calls.some((call) => call.startsWith("POST"))).toBe(true));
    expect(await screen.findByText("Der Befund ist als Ausnahme hingenommen.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Ausnahmen zeigen/ }));
    await waitFor(() => expect(calls.some((call) => call.includes("excepted=true"))).toBe(true));
  });

  it("zeigt Befunde in der Übersicht und an der Policy", async () => {
    stub({
      "GET /api/monitoring/fortigate/overview": overview,
      "GET /api/monitoring/fortigate/policies": policies,
    });
    render(<FortigatePoliciesPage roles={["FortiGate.Reader"]} />);
    const table = await screen.findByRole("table", { name: "Policies" });
    const row = within(table).getByRole("row", { name: /Fernwartung Altsystem/ });
    expect(row).toHaveTextContent("1 Befund");
    fireEvent.click(within(row).getByRole("button", { name: /fw-edge/ }));
    const detail = await screen.findByRole("complementary", { name: "Detail der Policy" });
    expect(within(detail).getByRole("link", { name: /Aus dem Internet/ })).toHaveAttribute(
      "href",
      "/monitoring/fortigate/befunde?geraet=fw-edge&auswahl=fw-edge%7Cwan_any_internal%7Cpolicy%3A7",
    );
    cleanup();
    stub({ "GET /api/monitoring/fortigate/overview": overview });
    render(<FortigateOverviewPage roles={["FortiGate.Reader"]} />);
    expect(await screen.findByRole("link", { name: "1 hoch" })).toHaveAttribute(
      "href",
      "/monitoring/fortigate/befunde?stufe=hoch",
    );
  });

  it("speichert Prüfregeln und fragt vor dem Abschalten", async () => {
    const settings: FgAdminSettings = {
      interval_minutes: 60,
      intervals: [60],
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
      "GET /api/admin/settings/fortigate/rules": rules,
      "PUT /api/admin/settings/fortigate/rules": rules,
      "GET /api/admin/settings/fortigate": settings,
    });
    render(<FortigateAdminPage />);
    const box = await screen.findByRole("checkbox", { name: /Keine Treffer im Zeitraum/ });
    expect(screen.getByRole("textbox", { name: /Schützenswerte Zonen/ })).toHaveValue("dmz-server");
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Prüfregeln speichern" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Prüfregel abschalten?" });
    expect(dialog).toHaveTextContent("Keine Treffer im Zeitraum");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abschalten" }));
    await waitFor(() =>
      expect(calls.some((call) => call.startsWith("PUT /api/admin/settings/fortigate/rules"))).toBe(
        true,
      ),
    );
    expect(await screen.findByText("Die Prüfregeln sind gespeichert.")).toBeInTheDocument();
  });
});
