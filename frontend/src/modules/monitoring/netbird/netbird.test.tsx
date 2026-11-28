import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NbAdminSettings,
  NbEvent,
  NbNetworks,
  NbOverview,
  NbPeerDetail,
  NbPeers,
  NbPolicies,
} from "./api";
import { NetbirdAdminPage } from "./NetbirdAdminPage";
import { NetbirdNetworksPage } from "./NetbirdNetworksPage";
import { NetbirdOverviewPage, NetbirdPeersPage } from "./NetbirdPages";
import { NetbirdPoliciesPage } from "./NetbirdPoliciesPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const base = {
  configured: true,
  data_at: "2026-11-28T10:00:00Z",
  last_run_at: "2026-11-28T10:00:00Z",
  last_ok: true,
  error: null,
  notes: [],
  dashboard_url: "https://netbird.example.com",
};

const hint = {
  key: "anmeldung|peer:p-07",
  level: "warnung" as const,
  code: "anmeldung",
  title: "Anmeldung von nb-peer-07 läuft am 03.12.2026 ab",
  text: "Danach muss sich die Person am Gerät neu anmelden.",
  link: "/monitoring/netbird/peers?auswahl=p-07",
};

const event: NbEvent = {
  id: "1005",
  at: "2026-11-28T09:00:00Z",
  category: "policy",
  label: "Richtlinie geändert",
  object: "pol-beispiel-admin",
  initiator: "Ina Beispiel",
  change: "–",
};

const overview: NbOverview = {
  ...base,
  can_refresh: false,
  networks_total: 3,
  networks_ok: 2,
  networks_single: 2,
  services_total: 4,
  services_ok: 2,
  services_checked: 3,
  peers: 6,
  connected: 3,
  routers: 2,
  routers_offline: 1,
  hint_counts: { kritisch: 0, warnung: 3, info: 1 },
  hints: [
    hint,
    ...Array.from({ length: 7 }, (_, index) => ({
      ...hint,
      key: `info-${index}`,
      level: "info" as const,
      title: `Peer nb-peer-${index} seit über 90 Tagen nicht gesehen`,
    })),
  ],
  events_available: true,
  events: [event],
  latest_version: "0.60.2",
  versions: { neuestes: 4, eins: 0, zwei: 2, unbekannt: 0 },
  systems: [
    { name: "Linux", total: 3, online: 2 },
    { name: "Windows", total: 2, online: 1 },
  ],
  chart_days: 14,
  chart: Array.from({ length: 14 }, (_, index) => ({
    day: `2026-11-${String(15 + index).padStart(2, "0")}`,
    weekend: index % 7 >= 5,
    max_connected: index === 0 ? null : 3,
    total: index === 0 ? null : 6,
  })),
};

const row = {
  id: "p-07",
  name: "nb-peer-07",
  person: "Ina Beispiel",
  status: "verbunden" as const,
  status_label: "verbunden",
  last_seen: "2026-11-28T10:00:00Z",
  ip: "100.64.0.37",
  os: "Windows 11",
  os_family: "Windows",
  version: "0.60.2",
  behind: 0,
  router: false,
  groups: ["g-it"],
  hints: [hint],
};

const peers: NbPeers = {
  ...base,
  rows: [
    row,
    {
      ...row,
      id: "p-19",
      name: "nb-peer-19",
      person: "Max Muster",
      status: "abgelaufen",
      status_label: "Anmeldung abgelaufen",
      version: "0.58.1",
      behind: 2,
      hints: [],
    },
  ],
  total: 6,
  counts: { verbunden: 3, offline: 1, freigabe: 0, abgelaufen: 2 },
  groups: [{ id: "g-it", name: "grp-beispiel-it" }],
  families: ["Linux", "Windows"],
  approval_known: false,
  can_export: false,
};

const detail: NbPeerDetail = {
  ...row,
  hostname: "nb-peer-07",
  dns_label: "nb-peer-07.netbird.example.com",
  kernel: "",
  login_expires: "2026-12-03T10:00:00Z",
  login_expired: false,
  country: "DE",
  group_names: ["All", "grp-beispiel-it"],
  history: Array.from({ length: 7 }, (_, index) => ({
    day: `2026-11-${22 + index}`,
    connected: index > 1,
    known: index > 0,
  })),
  latest_version: "0.60.2",
  asset: { id: 41, name: "Notebook Beispiel", inventory_no: "IT-0041" },
  policies_available: true,
  targets: [{ target: "Büronetz", ports: "TCP 22, 443", policy: "pol-beispiel-it" }],
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

describe("NetBird", () => {
  it("zeigt Kacheln, Hinweise mit „weitere anzeigen“ und den Verlauf als Tabelle", async () => {
    const calls = stub({ "GET /api/monitoring/netbird/overview": overview });
    render(<NetbirdOverviewPage />);
    expect(await screen.findByText("3 / 6")).toBeInTheDocument();
    expect(screen.getByText("davon 1 Routing-Peer offline")).toBeInTheDocument();
    const hints = screen.getByRole("region", { name: "Hinweise" });
    expect(within(hints).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(within(hints).getByRole("button", { name: "2 weitere anzeigen" }));
    expect(within(hints).getAllByRole("listitem")).toHaveLength(8);
    fireEvent.change(within(hints).getByRole("combobox", { name: "Stufe" }), {
      target: { value: "warnung" },
    });
    expect(within(hints).getAllByRole("listitem")).toHaveLength(1);
    expect(within(hints).getByRole("link", { name: "Ansehen" })).toHaveAttribute("href", hint.link);
    expect(screen.queryByRole("button", { name: "Jetzt abrufen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "als Tabelle zeigen" }));
    const table = screen.getByRole("table", { name: "Verbundene Peers je Tag" });
    expect(within(table).getAllByRole("row")).toHaveLength(15);
    const recent = screen.getByRole("table", { name: "Letzte Ereignisse" });
    expect(within(recent).getByRole("row", { name: /Richtlinie geändert/ })).toHaveTextContent(
      "Ina Beispiel",
    );
    fireEvent.click(screen.getByRole("button", { name: "30 Tage" }));
    await waitFor(() => expect(calls.some((call) => call.includes("days=30"))).toBe(true));
  });

  it("filtert Peers und zeigt das Detail mit Hinweis zum IT-Bestand", async () => {
    window.history.replaceState(null, "", "/monitoring/netbird/peers");
    const calls = stub({
      "GET /api/monitoring/netbird/peers/p-07": detail,
      "GET /api/monitoring/netbird/peers": peers,
    });
    render(<NetbirdPeersPage />);
    const table = await screen.findByRole("table", { name: "Peers" });
    const peer = within(table).getByRole("row", { name: /nb-peer-07/ });
    expect(peer).toHaveTextContent("Ina Beispiel");
    expect(within(table).getByRole("row", { name: /nb-peer-19/ })).toHaveTextContent(
      "Anmeldung abgelaufen",
    );
    expect(screen.queryByRole("link", { name: "CSV exportieren" })).not.toBeInTheDocument();
    fireEvent.click(within(peer).getByRole("button", { name: "nb-peer-07" }));
    const aside = await screen.findByRole("complementary", { name: "Detail des Peers" });
    expect(await within(aside).findByText("nb-peer-07.netbird.example.com")).toBeInTheDocument();
    expect(within(aside).getByRole("link", { name: /Notebook Beispiel/ })).toHaveAttribute(
      "href",
      "/bestand/hardware/41",
    );
    expect(
      within(aside).getByRole("img", { name: "An 5 von 7 Tagen verbunden" }),
    ).toBeInTheDocument();
    expect(within(aside).getByRole("link", { name: "In NetBird öffnen" })).toHaveAttribute(
      "href",
      "https://netbird.example.com/peer?id=p-07",
    );
    expect(within(aside).getByText("Büronetz")).toBeInTheDocument();
    expect(window.location.search).toContain("auswahl=p-07");
    fireEvent.change(screen.getByRole("searchbox", { name: "Suchen" }), {
      target: { value: "Ina" },
    });
    await waitFor(() => expect(calls.some((call) => call.includes("q=Ina"))).toBe(true));
  });

  it("prüft die Adresse und speichert den Zugang ohne das Token anzuzeigen", async () => {
    const settings: NbAdminSettings = {
      url: "",
      token_set: false,
      ping: false,
      signal: "",
      relay: "",
      server_groups: "",
      token_storage_available: true,
      last_run_at: null,
      last_ok: null,
      last_error: null,
    };
    const crowdsec = {
      url: "",
      key_set: false,
      exempt: "",
      token_storage_available: true,
    };
    const calls = stub({
      "GET /api/admin/settings/netbird/crowdsec": crowdsec,
      "PUT /api/admin/settings/netbird/crowdsec": {
        ...crowdsec,
        url: "http://crowdsec.example.com:8080",
        key_set: true,
      },
      "POST /api/admin/settings/netbird/crowdsec/test": { total: 14, own: 4 },
      "GET /api/admin/settings/netbird": settings,
      "PUT /api/admin/settings/netbird": {
        ...settings,
        url: "https://netbird.example.com",
        token_set: true,
      },
      "POST /api/admin/settings/netbird/test": { peers: 6, groups: 5, policies: 3 },
    });
    render(<NetbirdAdminPage />);
    const url = await screen.findByRole("textbox", { name: /Management-URL/ });
    const access = screen.getByRole("region", { name: "Zugang zur Management-API" });
    fireEvent.change(url, { target: { value: "http://netbird.example.com/api" } });
    fireEvent.click(within(access).getByRole("button", { name: "Speichern" }));
    expect(screen.getByText(/https-Adresse ohne Pfad/)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
    fireEvent.change(url, { target: { value: "https://netbird.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Signal/ }), {
      target: { value: "signal.example.com" },
    });
    fireEvent.click(within(access).getByRole("button", { name: "Speichern" }));
    expect(screen.getByText(/als Host:Port eintragen/)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /Signal/ }), {
      target: { value: "signal.example.com:443" },
    });
    fireEvent.change(screen.getByLabelText("API-Token", { selector: "input" }), {
      target: { value: "geheim" },
    });
    fireEvent.click(within(access).getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText("Die Einstellungen für NetBird sind gespeichert."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("region", { name: "Zugang zur Management-API" })).getByRole(
        "button",
        { name: "Verbindung prüfen" },
      ),
    );
    expect(await screen.findByText(/6 Peers, 5 Gruppen, 3 Richtlinien/)).toBeInTheDocument();

    const section = await screen.findByRole("region", { name: /CrowdSec/ });
    const lapi = within(section).getByRole("textbox", { name: /URL der Local API/ });
    fireEvent.change(lapi, { target: { value: "crowdsec.example.com" } });
    fireEvent.click(within(section).getByRole("button", { name: "Speichern" }));
    expect(within(section).getByText(/ohne Pfad eintragen/)).toBeInTheDocument();
    fireEvent.change(lapi, { target: { value: "http://crowdsec.example.com:8080" } });
    fireEvent.change(within(section).getByLabelText("Bouncer-Schlüssel", { selector: "input" }), {
      target: { value: "bouncer" },
    });
    fireEvent.click(within(section).getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText("Die Einstellungen für CrowdSec sind gespeichert."),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("PUT /api/admin/settings/netbird/crowdsec"))).toBe(
      true,
    );
    fireEvent.click(
      within(screen.getByRole("region", { name: /CrowdSec/ })).getByRole("button", {
        name: "Verbindung prüfen",
      }),
    );
    expect(await screen.findByText(/14 aktive Sperren, davon 4 eigene/)).toBeInTheDocument();
  });

  it("zeigt Komponenten, Netze mit Ausfallweg und Dienste mit Zertifikat", async () => {
    const networks: NbNetworks = {
      ...base,
      components: {
        management: { ok: true, ms: 84 },
        signal: { target: "signal.example.com:443", ok: true, ms: 12, error: "" },
        relay: null,
        proxy: { services: 4, errors: 1, online: true, crowdsec: true },
        crowdsec: {
          configured: true,
          ok: true,
          total: 14,
          own: 4,
          error: "",
          blocked_24h: 3,
          observed_24h: 2,
        },
      },
      ping_enabled: false,
      proxy_log_available: true,
      networks: [
        {
          id: "n-b",
          name: "net-beispiel-b",
          kind: "network",
          ranges: ["10.0.20.0/24"],
          routers: [{ id: "p-router-02", name: "nb-router-02", connected: false }],
          connected: 0,
          total: 1,
          state: "nicht_erreichbar",
          state_label: "nicht erreichbar",
          target: "",
          ping: null,
        },
      ],
      services: [
        {
          id: "s-wiki",
          domain: "wiki.example.com",
          target: "10.0.30.21:3000",
          access: "SSO",
          private: false,
          status_code: 502,
          answered: false,
          error: "",
          ms: 120,
          availability: 98.9,
          cert_expires: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
          crowdsec_mode: "enforce",
          blocked_24h: 3,
          observed_24h: 0,
          crowdsec_exempt: false,
        },
        {
          id: "s-files",
          domain: "files.example.com",
          target: "10.0.30.27:443",
          access: "Passwort",
          private: false,
          status_code: 200,
          answered: true,
          error: "",
          ms: 80,
          availability: 100,
          cert_expires: null,
          crowdsec_mode: "off",
          blocked_24h: 0,
          observed_24h: 0,
          crowdsec_exempt: true,
        },
      ],
    };
    stub({ "GET /api/monitoring/netbird/networks": networks });
    render(<NetbirdNetworksPage />);
    expect(await screen.findByText("API in 84 ms")).toBeInTheDocument();
    expect(screen.getByText("nicht eingetragen")).toBeInTheDocument();
    expect(screen.getByText("1 mit Fehler")).toBeInTheDocument();
    const nets = screen.getByRole("table", { name: "Netze" });
    expect(within(nets).getByRole("row", { name: /net-beispiel-b/ })).toHaveTextContent("0 von 1");
    expect(within(nets).queryByRole("columnheader", { name: /Testziel/ })).not.toBeInTheDocument();
    const services = screen.getByRole("table", { name: "Dienste am Reverse Proxy" });
    const wiki = within(services)
      .getByRole("rowheader", { name: "wiki.example.com" })
      .closest("tr");
    expect(wiki).toHaveTextContent("502");
    expect(wiki).toHaveTextContent("98,9 %");
    expect(wiki).toHaveTextContent(/in 2[01] Tagen/);
    expect(wiki).toHaveTextContent("sperren");
    const files = within(services)
      .getByRole("rowheader", { name: "files.example.com" })
      .closest("tr");
    expect(files).toHaveTextContent("bewusst ohne");
    expect(screen.getByText("14 aktive Sperren")).toBeInTheDocument();
    expect(screen.getByText(/davon 4 eigene · 3 abgewiesen in 24 h · 2 wären/)).toBeInTheDocument();
  });

  it("zeigt Prüfung, Setup-Keys, Richtlinien und filtert das Ereignisprotokoll", async () => {
    const policies: NbPolicies = {
      ...base,
      policies_available: true,
      setup_keys_available: true,
      events_available: true,
      server_groups: [],
      findings: [
        {
          key: "richtlinie_all|policy:pol-admin",
          level: "kritisch",
          code: "richtlinie_all",
          title: "Richtlinie pol-beispiel-admin: Quelle und Ziel „All“, alle Ports",
          text: "Jeder Peer erreicht damit jeden anderen auf allen Ports.",
        },
      ],
      policies: [
        {
          id: "pol-test",
          name: "pol-beispiel-test",
          sources: ["grp-beispiel-it"],
          destinations: ["nb-peer-44"],
          ports: "ICMP",
          posture_checks: [],
          enabled: false,
          disabled_days: 124,
          changed_at: null,
        },
      ],
      setup_keys: [
        {
          id: "k-1",
          name: "key-beispiel-server",
          type: "reusable",
          groups: ["grp-beispiel-server"],
          expires: "2026-12-04T10:00:00Z",
          days_left: 6,
          state: "valid",
          active: true,
          used_times: 7,
          usage_limit: 0,
          ephemeral: false,
        },
      ],
      categories: [
        { value: "peer", label: "Peers" },
        { value: "policy", label: "Richtlinien" },
      ],
    };
    const calls = stub({
      "GET /api/monitoring/netbird/policies": policies,
      "GET /api/monitoring/netbird/events": { total: 1, days: 7, items: [event] },
    });
    render(<NetbirdPoliciesPage />);
    const check = await screen.findByRole("region", { name: /Prüfung der Richtlinien/ });
    expect(within(check).getByText(/Quelle und Ziel „All“/)).toBeInTheDocument();
    expect(within(check).getByRole("link", { name: "NetBird" })).toHaveAttribute(
      "href",
      "/verwaltung/netbird",
    );
    const keys = screen.getByRole("table", { name: "Setup-Keys" });
    expect(within(keys).getByRole("row", { name: /key-beispiel-server/ })).toHaveTextContent(
      "in 6 Tagen",
    );
    const rules = screen.getByRole("table", { name: "Richtlinien" });
    expect(within(rules).getByRole("row", { name: /pol-beispiel-test/ })).toHaveTextContent(
      "deaktiviert seit 124 Tagen",
    );
    const log = await screen.findByRole("table", { name: "Ereignisse" });
    expect(within(log).getByRole("row", { name: /Richtlinie geändert/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Art" }), {
      target: { value: "peer" },
    });
    await waitFor(() => expect(calls.some((call) => call.includes("kind=peer"))).toBe(true));
  });

  it("zeigt Prüfung, Setup-Keys, Richtlinien und filtert das Ereignisprotokoll", async () => {
    const policies: NbPolicies = {
      ...base,
      policies_available: true,
      setup_keys_available: true,
      events_available: true,
      server_groups: [],
      findings: [
        {
          key: "richtlinie_all|policy:pol-admin",
          level: "kritisch",
          code: "richtlinie_all",
          title: "Richtlinie pol-beispiel-admin: Quelle und Ziel „All“, alle Ports",
          text: "Jeder Peer erreicht damit jeden anderen auf allen Ports.",
        },
      ],
      policies: [
        {
          id: "pol-test",
          name: "pol-beispiel-test",
          sources: ["grp-beispiel-it"],
          destinations: ["nb-peer-44"],
          ports: "ICMP",
          posture_checks: [],
          enabled: false,
          disabled_days: 124,
          changed_at: null,
        },
      ],
      setup_keys: [
        {
          id: "k-1",
          name: "key-beispiel-server",
          type: "reusable",
          groups: ["grp-beispiel-server"],
          expires: "2026-12-04T10:00:00Z",
          days_left: 6,
          state: "valid",
          active: true,
          used_times: 7,
          usage_limit: 0,
          ephemeral: false,
        },
      ],
      categories: [
        { value: "peer", label: "Peers" },
        { value: "policy", label: "Richtlinien" },
      ],
    };
    const calls = stub({
      "GET /api/monitoring/netbird/policies": policies,
      "GET /api/monitoring/netbird/events": { total: 1, days: 7, items: [event] },
    });
    render(<NetbirdPoliciesPage />);
    const check = await screen.findByRole("region", { name: /Prüfung der Richtlinien/ });
    expect(within(check).getByText(/Quelle und Ziel „All“/)).toBeInTheDocument();
    expect(within(check).getByRole("link", { name: "NetBird" })).toHaveAttribute(
      "href",
      "/verwaltung/netbird",
    );
    const keys = screen.getByRole("table", { name: "Setup-Keys" });
    expect(within(keys).getByRole("row", { name: /key-beispiel-server/ })).toHaveTextContent(
      "in 6 Tagen",
    );
    const rules = screen.getByRole("table", { name: "Richtlinien" });
    expect(within(rules).getByRole("row", { name: /pol-beispiel-test/ })).toHaveTextContent(
      "deaktiviert seit 124 Tagen",
    );
    const log = await screen.findByRole("table", { name: "Ereignisse" });
    expect(within(log).getByRole("row", { name: /Richtlinie geändert/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Art" }), {
      target: { value: "peer" },
    });
    await waitFor(() => expect(calls.some((call) => call.includes("kind=peer"))).toBe(true));
  });
});
