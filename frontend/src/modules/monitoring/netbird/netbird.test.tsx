import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NbAdminSettings, NbNetworks, NbOverview, NbPeerDetail, NbPeers } from "./api";
import { NetbirdAdminPage } from "./NetbirdAdminPage";
import { NetbirdNetworksPage } from "./NetbirdNetworksPage";
import { NetbirdOverviewPage, NetbirdPeersPage } from "./NetbirdPages";

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
      token_storage_available: true,
      last_run_at: null,
      last_ok: null,
      last_error: null,
    };
    const calls = stub({
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
    fireEvent.change(url, { target: { value: "http://netbird.example.com/api" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByText(/https-Adresse ohne Pfad/)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
    fireEvent.change(url, { target: { value: "https://netbird.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Signal/ }), {
      target: { value: "signal.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByText(/als Host:Port eintragen/)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /Signal/ }), {
      target: { value: "signal.example.com:443" },
    });
    fireEvent.change(screen.getByLabelText("API-Token", { selector: "input" }), {
      target: { value: "geheim" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText("Die Einstellungen für NetBird sind gespeichert."),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Verbindung prüfen" }));
    expect(await screen.findByText(/6 Peers, 5 Gruppen, 3 Richtlinien/)).toBeInTheDocument();
  });

  it("zeigt Komponenten, Netze mit Ausfallweg und Dienste mit Zertifikat", async () => {
    const networks: NbNetworks = {
      ...base,
      components: {
        management: { ok: true, ms: 84 },
        signal: { target: "signal.example.com:443", ok: true, ms: 12, error: "" },
        relay: null,
        proxy: { services: 4, errors: 1, online: true, crowdsec: true },
      },
      ping_enabled: false,
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
    const wiki = within(services).getByRole("row", { name: /wiki.example.com/ });
    expect(wiki).toHaveTextContent("502");
    expect(wiki).toHaveTextContent("98,9 %");
    expect(wiki).toHaveTextContent(/in 2[01] Tagen/);
  });
});
