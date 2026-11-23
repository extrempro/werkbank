import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZabbixSettings } from "../../../pages/ZabbixSettings";
import type {
  DataState,
  ZbxConnection,
  ZbxHostDetail,
  ZbxHostRow,
  ZbxOverview,
  ZbxUnmonitored,
} from "./api";
import { cellLabel, overviewHeadline, severityClass, severityLabel } from "./api";
import {
  age,
  ZabbixConnectionPage,
  ZabbixHostsPage,
  ZabbixMaintenancesPage,
  ZabbixOverviewPage,
} from "./ZabbixPages";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const state: DataState = {
  configured: true,
  data_at: "2026-11-22T08:00:00Z",
  stale: false,
  error: null,
  failures: 0,
  next_at: "2026-11-22T08:01:00Z",
  zabbix_url: "https://zabbix.example.com/",
};

const problem = {
  eventid: "5001",
  name: "Switch B ist nicht erreichbar <b>fett</b>",
  severity: 4,
  since: "2026-11-01T08:00:00Z",
  acknowledged: false,
  suppressed: false,
  tags: ["scope: availability"],
  hostid: "10102",
  host: "Switch B",
  site: "Gebäude A (Beispielstadt)",
  link: "https://zabbix.example.com/tr_events.php?triggerid=9001&eventid=5001",
};

const overview: ZbxOverview = {
  state,
  kpis: { problems: 2, by_severity: { "4": 1, "2": 1 }, hosts: 3, unreachable: 1, maintenance: 1 },
  problems: [
    problem,
    { ...problem, eventid: "5002", name: "Zertifikat läuft ab", severity: 2, site: null },
  ],
  unreachable: [{ hostid: "10102", name: "Switch B", site: null, since: null, link: null }],
  maintenances: [
    {
      maintenanceid: "301",
      name: "Firmware Strom",
      state: "laeuft",
      with_data: true,
      active_since: "2026-11-01T00:00:00Z",
      active_till: "2027-11-01T00:00:00Z",
      windows: [["2026-11-22T07:00:00Z", "2026-11-22T09:00:00Z"]],
      recurring: [],
      hosts: 1,
      host_names: ["USV C"],
      groups: [],
    },
  ],
  todo: {
    long_open: 1,
    unmonitored: 2,
    no_inventory: 0,
    no_serial: 1,
    certificates: [],
    certificate_tag: null,
  },
  sites: ["Gebäude A (Beispielstadt)"],
  site_health: [
    {
      name: "Gebäude A (Beispielstadt)",
      hosts: 2,
      unreachable: 0,
      maintenance: 1,
      problems: 1,
      worst: 4,
      cells: [
        { hostid: "10101", name: "Server A", state: "4" },
        { hostid: "10103", name: "USV C", state: "wartung" },
      ],
    },
    {
      name: null,
      hosts: 1,
      unreachable: 1,
      maintenance: 0,
      problems: 1,
      worst: 2,
      cells: [{ hostid: "10102", name: "Switch B", state: "down" }],
    },
  ],
  history: Array.from({ length: 24 }, (_, index) => ({
    hour: new Date(Date.UTC(2026, 10, 21, 9 + index)).toISOString(),
    open: index < 20 ? null : index,
    high: index < 20 ? null : 1,
  })),
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = handler(String(input), init);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Hilfen", () => {
  it("benennt Schweregrade und Alter", () => {
    expect(severityLabel(5)).toBe("Katastrophe");
    expect(severityLabel(0)).toBe("Nicht klassifiziert");
    expect(severityClass(0)).toBe("zbx-sev zbx-sev-1");
    const now = new Date("2026-11-22T10:00:00Z").getTime();
    expect(age("2026-11-22T09:58:00Z", now)).toBe("2 Min.");
    expect(age("2026-11-22T07:00:00Z", now)).toBe("3 Std.");
    expect(age("2026-11-12T10:00:00Z", now)).toBe("10 Tagen");
    expect(age(null, now)).toBe("–");
  });

  it("fasst den Stand zusammen und beschriftet Kästchen", () => {
    expect(overviewHeadline(overview).tone).toBe("bad");
    const calm = {
      kpis: { problems: 1, by_severity: { "2": 1 }, hosts: 3, unreachable: 0, maintenance: 0 },
      site_health: [],
    };
    expect(overviewHeadline(calm)).toMatchObject({
      tone: "warn",
      title: "1 Problem offen, nichts Schweres",
    });
    expect(
      overviewHeadline({
        kpis: { problems: 0, by_severity: {}, hosts: 3, unreachable: 0, maintenance: 0 },
        site_health: [],
      }),
    ).toMatchObject({ tone: "ok", title: "Alles in Ordnung" });
    expect(cellLabel({ hostid: "1", name: "Server A", state: "4" })).toBe("Server A: Hoch");
    expect(cellLabel({ hostid: "1", name: "USV C", state: "wartung" })).toBe("USV C: in Wartung");
  });
});

describe("ZabbixOverviewPage", () => {
  it("zeigt Kennzahlen, Probleme als Text und filtert nach Schweregrad und Standort", async () => {
    stubFetch(() => overview);
    render(<ZabbixOverviewPage />);
    expect(await screen.findByText("Switch B ist nicht erreichbar <b>fett</b>")).toBeVisible();
    // Problem-Name bleibt Text, kein HTML
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByText("Zertifikat läuft ab")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /In Zabbix öffnen/ })[0]).toHaveAttribute(
      "target",
      "_blank",
    );
    // Gesamtstand oben
    expect(screen.getByRole("heading", { name: "1 schweres Problem offen" })).toBeVisible();
    expect(screen.getByText(/am meisten betroffen: Gebäude A/)).toBeVisible();
    // Schweregrad filtert die Liste
    fireEvent.click(screen.getByRole("button", { name: "Hoch: 1 Problem" }));
    expect(screen.queryByText("Zertifikat läuft ab")).toBeNull();
    expect(screen.getByText(/nur Hoch · 1 Problem/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    // Standort-Kachel filtert, die Kästchen tragen den Zustand im Tooltip
    const tile = screen.getByRole("button", { name: /^Ohne Standort/ });
    expect(tile.querySelector('[title="Switch B: nicht erreichbar"]')).not.toBeNull();
    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Zertifikat läuft ab")).toBeVisible();
    expect(screen.queryByText("Switch B ist nicht erreichbar <b>fett</b>")).toBeNull();
    // Verlauf als Bild mit Beschreibung
    expect(screen.getByRole("img", { name: /zuletzt 23, höchstens 23/ })).toBeVisible();
    expect(screen.getByText("Firmware Strom")).toBeVisible();
    expect(screen.getByText(/^Stand /)).toBeVisible();
  });

  it("meldet einen Ausfall und den nicht eingerichteten Zustand", async () => {
    stubFetch(() => ({
      ...overview,
      state: { ...state, error: "Zabbix antwortet nicht rechtzeitig.", stale: true },
    }));
    render(<ZabbixOverviewPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Zabbix antwortet nicht rechtzeitig. Angezeigt wird der letzte Stand.",
    );
    cleanup();
    stubFetch(() => ({ ...overview, state: { ...state, configured: false } }));
    render(<ZabbixOverviewPage />);
    expect(await screen.findByText(/noch nicht eingerichtet/)).toBeVisible();
  });
});

const rows: ZbxHostRow[] = [
  {
    hostid: "10101",
    name: "Server A",
    host: "srv-a",
    monitored: true,
    reachable: true,
    in_maintenance: false,
    site: "Gebäude A (Beispielstadt)",
    groups: ["Server"],
    problems: 0,
    worst: null,
    serial: "SN-1001",
    device: { id: 7, name: "Server A", inventory_no: "IT-0007", serial: "SN-1001", kind: "Server" },
    match: "seriennummer",
    gap: null,
  },
  {
    hostid: "10102",
    name: "Switch B",
    host: "sw-b",
    monitored: true,
    reachable: false,
    in_maintenance: false,
    site: null,
    groups: ["Netzwerk"],
    problems: 1,
    worst: 4,
    serial: "",
    device: null,
    match: null,
    gap: "seriennummer_fehlt",
  },
];

const detail: ZbxHostDetail = {
  hostid: "10102",
  name: "Switch B",
  host: "sw-b",
  monitored: true,
  reachable: false,
  in_maintenance: false,
  maintenance: null,
  site: null,
  groups: ["Netzwerk"],
  templates: [],
  interfaces: [
    { type: "snmp", address: "sw-b.example.com", port: "161", main: true, available: false },
  ],
  serial: "",
  model: "",
  kind: "",
  last_seen_at: null,
  updated_at: "2026-11-22T08:00:00Z",
  problems: [problem],
  link: "https://zabbix.example.com/zabbix.php?action=problem.view",
  device: null,
  match: null,
  gap: "seriennummer_fehlt",
  can_link: true,
};

const unmonitored: ZbxUnmonitored = {
  missing: [
    {
      id: 9,
      name: "USV Keller",
      inventory_no: "IT-0009",
      serial: "UPS-9",
      kind: "USV",
      reason: null,
    },
  ],
  excluded: [
    {
      id: 10,
      name: "Ersatz-Switch",
      inventory_no: null,
      serial: "SW-10",
      kind: "Switch",
      reason: "liegt im Lager",
    },
  ],
  kinds_set: true,
};

const READER = ["Monitoring.Reader"];
const LINKER = ["Monitoring.Reader", "Bestand.Editor"];

function hostsHandler(url: string) {
  if (url.endsWith("/hosts")) return rows;
  if (url.endsWith("/unmonitored")) return unmonitored;
  return detail;
}

describe("ZabbixHostsPage", () => {
  it("filtert Hosts und zeigt die Ansicht eines Hosts", async () => {
    stubFetch(hostsHandler);
    render(<ZabbixHostsPage hostId={null} roles={READER} />);
    expect(await screen.findByRole("link", { name: "Server A" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Nicht erreichbar · 1" }));
    expect(screen.queryByRole("link", { name: "Server A" })).toBeNull();
    expect(screen.getByRole("link", { name: "Switch B" })).toBeVisible();
    cleanup();
    render(<ZabbixHostsPage hostId="10102" roles={READER} />);
    expect(await screen.findByRole("heading", { name: "Switch B" })).toBeVisible();
    expect(screen.getByText("fehlt im Inventar")).toBeVisible();
    expect(screen.getByText("SNMP sw-b.example.com:161")).toBeVisible();
    // ohne Bestand.Editor kein Zuordnen
    expect(screen.queryByRole("button", { name: "Zuordnen" })).toBeNull();
  });

  it("filtert nach Lücken im IT-Bestand", async () => {
    stubFetch(hostsHandler);
    render(<ZabbixHostsPage hostId={null} roles={READER} />);
    expect(await screen.findByRole("link", { name: "Server A" })).toBeVisible();
    expect(screen.getByText("IT-0007 Server A")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Seriennummer fehlt · 1" }));
    expect(screen.queryByRole("link", { name: "Server A" })).toBeNull();
    expect(screen.getByRole("link", { name: "Switch B" })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Nicht überwacht · 1" }));
    expect(screen.getByRole("link", { name: "IT-0009 USV Keller" })).toBeVisible();
    expect(screen.getByText(/liegt im Lager/)).toBeVisible();
    // nur lesen: keine Aktionen
    expect(screen.queryByRole("button", { name: "Nicht überwachen" })).toBeNull();
  });

  it("markiert ein Gerät erst mit Begründung und Bestätigung", async () => {
    const fetchMock = stubFetch((url, init) =>
      init?.method === "PUT" ? { ...unmonitored, missing: [] } : hostsHandler(url),
    );
    window.history.replaceState(null, "", "/monitoring/zabbix/hosts?filter=nicht-ueberwacht");
    render(<ZabbixHostsPage hostId={null} roles={LINKER} />);
    const button = await screen.findByRole("button", { name: "Nicht überwachen" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Begründung für IT-0009 USV Keller"), {
      target: { value: "Ersatzgerät" },
    });
    fireEvent.click(button);
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Nicht überwachen",
      }),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(String(put[0])).toContain("/devices/9/unmonitored");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ reason: "Ersatzgerät" });
    expect(await screen.findByText("Kein Gerät fehlt in Zabbix.")).toBeVisible();
  });

  it("bietet das Zuordnen nur mit Bestand.Editor an", async () => {
    stubFetch(hostsHandler);
    render(<ZabbixHostsPage hostId="10102" roles={LINKER} />);
    expect(await screen.findByRole("heading", { name: "Im IT-Bestand" })).toBeVisible();
    expect(screen.getByText(/fehlt die Seriennummer/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Zuordnen" })).toBeDisabled();
  });
});

describe("ZabbixMaintenancesPage", () => {
  it("ordnet Wartungen nach Zustand", async () => {
    stubFetch(() => overview.maintenances);
    render(<ZabbixMaintenancesPage />);
    expect(await screen.findByText("Firmware Strom")).toBeVisible();
    expect(screen.getByText("läuft")).toBeVisible();
  });
});

const connection: ZbxConnection = {
  state,
  enabled: true,
  url: "https://zabbix.example.com",
  version: "8.0.0",
  checked_at: "2026-11-22T08:00:00Z",
  role: "Werkbank lesen",
  methods: ["*"],
  needed: ["problem.get"],
  findings: ["Die Rolle erlaubt Methoden mit Platzhalter („*“)."],
  token_expires_at: "2026-12-01T00:00:00Z",
  token_never_expires: false,
  token_warning: true,
  tasks: [
    {
      task: "schnell",
      label: "Probleme und Zustand",
      methods: ["problem.get"],
      interval_minutes: 1,
      last_at: "2026-11-22T08:00:00Z",
      duration_ms: 600,
      ok: false,
      error: "Zabbix antwortet nicht rechtzeitig.",
      counts: {},
    },
  ],
  groups: [{ groupid: "21", name: "Standort A/Server", hosts: 2, site_id: null, position: null }],
  sites: [{ id: 3, name: "Gebäude A (Beispielstadt)" }],
  certificate_tag: "",
  certificate_value: "",
  kinds: [
    { id: 1, name: "Server" },
    { id: 2, name: "USV" },
  ],
  kind_ids: [1],
  target: 99.5,
};

describe("ZabbixConnectionPage", () => {
  it("warnt vor Rolle und Token und speichert die Zuordnung", async () => {
    const fetchMock = stubFetch(() => connection);
    render(<ZabbixConnectionPage />);
    expect(await screen.findByText(/Platzhalter/)).toBeVisible();
    expect(screen.getByText(/weniger als 30 Tagen ab/)).toBeVisible();
    expect(screen.getAllByText("Zabbix antwortet nicht rechtzeitig.").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Standort für Standort A/Server"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "component" } });
    fireEvent.click(screen.getByLabelText("USV"));
    fireEvent.change(screen.getByLabelText("Zielwert in %"), { target: { value: "101" } });
    expect(screen.getByText(/zwischen 90 und 100 ein/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Zielwert in %"), { target: { value: "99,9" } });
    fireEvent.click(screen.getByRole("button", { name: "Zuordnung speichern" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      mapping: [{ groupid: "21", group_name: "Standort A/Server", site_id: 3 }],
      certificate_tag: "component",
      certificate_value: "",
      kind_ids: [1, 2],
      target: 99.9,
    });
  });
});

describe("ZabbixSettings (Verwaltung)", () => {
  it("speichert Adresse und Token, ohne das Token zu zeigen", async () => {
    const fetchMock = stubFetch((_url, init) =>
      init?.method === "PUT"
        ? {
            enabled: true,
            url: "https://zabbix.example.com",
            link_url: "",
            token_set: true,
            token_storage_available: true,
            ca_set: false,
          }
        : {
            enabled: false,
            url: "",
            link_url: "",
            token_set: false,
            token_storage_available: true,
            ca_set: false,
          },
    );
    render(<ZabbixSettings />);
    fireEvent.change(await screen.findByLabelText("Adresse von Zabbix"), {
      target: { value: "https://zabbix.example.com" },
    });
    fireEvent.change(screen.getByLabelText("API-Token"), { target: { value: "zbx-geheim" } });
    fireEvent.change(screen.getByLabelText("Adresse für „In Zabbix öffnen“ (optional)"), {
      target: { value: "https://monitor.example.com" },
    });
    fireEvent.click(screen.getByLabelText("Abfrage von Zabbix einschalten"));
    fireEvent.click(screen.getByRole("button", { name: "Zabbix speichern" }));
    expect(await screen.findByText("Die Anbindung an Zabbix ist gespeichert.")).toBeVisible();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      enabled: true,
      url: "https://zabbix.example.com",
      link_url: "https://monitor.example.com",
      token: "zbx-geheim",
    });
    expect(screen.getByText("eingeschaltet")).toBeVisible();
  });
});
