import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  credentialKind,
  daysUntil,
  licenseNotes,
  remainingText,
  type Credential,
  type License,
} from "./api";
import { CredentialsPage } from "./CredentialsPage";
import { HealthPage } from "./HealthPage";
import { hexLayout, nameLines, shortRemaining } from "./honeycomb";
import { LicensesPage } from "./LicensesPage";
import { UsersPage } from "./UsersPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = Date.parse("2026-11-15T12:00:00Z");

function license(overrides: Partial<License> = {}): License {
  return {
    id: 1,
    sku_id: "05e9a617-0261-4cee-bb44-138d3ef5d965",
    part_number: "SPE_E3",
    name: "Microsoft 365 E3",
    applies_to: "User",
    capability_status: "Enabled",
    total: 50,
    consumed: 48,
    free: 2,
    warning: 0,
    suspended: 0,
    locked_out: 0,
    next_lifecycle: "2027-03-01T00:00:00Z",
    trial: false,
    active: true,
    ...overrides,
  };
}

function stubFetch(routes: Record<string, unknown>) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const key = Object.keys(routes).find((route) => url.startsWith(route));
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response("{}", { status: 404 });
    }),
  );
  return urls;
}

describe("Hinweise zu einer Lizenz", () => {
  it("meldet nichts, wenn alles in Ordnung ist", () => {
    expect(licenseNotes(license(), NOW)).toEqual([]);
  });

  it("meldet aufgebraucht, überbucht, Kulanzfrist, Sperre, Stichtag und Testabo", () => {
    const texts = (overrides: Partial<License>) =>
      licenseNotes(license(overrides), NOW).map((note) => note.text);
    expect(texts({ free: 0 })).toEqual(["aufgebraucht"]);
    expect(texts({ free: -5 })).toEqual(["5 mehr zugewiesen als gekauft"]);
    expect(texts({ warning: 3, suspended: 1, locked_out: 1 })).toEqual([
      "3 in Kulanzfrist",
      "2 gesperrt",
    ]);
    expect(texts({ next_lifecycle: "2026-11-25T00:00:00Z" })).toEqual(["Stichtag in 10 Tagen"]);
    expect(texts({ next_lifecycle: "2026-11-01T00:00:00Z" })).toEqual(["Stichtag überschritten"]);
    expect(texts({ trial: true })).toEqual(["Testabo"]);
    expect(daysUntil("2026-11-16T12:00:00Z", NOW)).toBe(1);
  });
});

describe("LicensesPage", () => {
  it("zeigt die Lizenzen mit Summen und Hinweisen", async () => {
    stubFetch({
      "/api/tenant/licenses": {
        enabled: true,
        fetched_at: "2026-11-15T06:00:00Z",
        total: 70,
        consumed: 73,
        entries: [
          license(),
          license({ id: 2, part_number: "SPE_F1", name: "Microsoft 365 F3", free: -5 }),
          license({ id: 3, part_number: "SONDER_X", name: "SONDER_X" }),
        ],
      },
    });
    render(<LicensesPage />);
    const table = within(await screen.findByRole("region", { name: "Lizenzen" }));
    expect(table.getByRole("link", { name: "Microsoft 365 E3" })).toHaveAttribute(
      "href",
      "/m365/lizenzen/1",
    );
    expect(table.getByRole("row", { name: /^Microsoft 365 E3/ })).toHaveTextContent("in Ordnung");
    expect(table.getByRole("row", { name: /^Microsoft 365 F3/ })).toHaveTextContent(
      "5 mehr zugewiesen als gekauft",
    );
    // Der technische Name steht nur dabei, wenn es einen lesbaren Namen gibt.
    expect(table.getAllByText("SONDER_X")).toHaveLength(1);
    expect(screen.getByText("Gekauft", { selector: "dt" }).nextSibling).toHaveTextContent("70");
  });

  it("erklärt, wenn der Abruf nicht eingeschaltet ist, und meldet Fehler", async () => {
    stubFetch({
      "/api/tenant/licenses": {
        enabled: false,
        fetched_at: null,
        total: 0,
        consumed: 0,
        entries: [],
      },
    });
    const { unmount } = render(<LicensesPage />);
    expect(await screen.findByText(/ist in dieser Installation nicht eingeschaltet/)).toBeVisible();
    unmount();
    stubFetch({});
    render(<LicensesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("konnten nicht geladen werden");
  });

  it("zeigt den Verlauf einer Lizenz und lädt einen anderen Zeitraum", async () => {
    const urls = stubFetch({
      "/api/tenant/licenses/2": {
        license: license({ id: 2, free: 0 }),
        fetched_at: "2026-11-15T06:00:00Z",
        samples: [
          { day: "2026-11-14", total: 50, consumed: 47 },
          { day: "2026-11-15", total: 50, consumed: 50 },
        ],
      },
    });
    render(<LicensesPage selectedId={2} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Microsoft 365 E3" }),
    ).toBeVisible();
    expect(screen.getByText("aufgebraucht")).toBeVisible();
    expect(screen.getByRole("img", { name: /^Verlauf Microsoft 365 E3/ })).toBeVisible();
    expect(urls[0]).toBe("/api/tenant/licenses/2?days=90");
    fireEvent.click(screen.getByRole("button", { name: "1 Jahr" }));
    await vi.waitFor(() => expect(urls).toContain("/api/tenant/licenses/2?days=365"));
    expect(screen.getByRole("link", { name: "Zurück zu den Lizenzen" })).toHaveAttribute(
      "href",
      "/m365/lizenzen",
    );
  });

  it("sagt, wenn es die Lizenz nicht gibt", async () => {
    stubFetch({});
    render(<LicensesPage selectedId={99} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Lizenz nicht gefunden" }),
    ).toBeVisible();
  });
});

describe("UsersPage", () => {
  it("zeigt die Zahlen und den Verlauf, ohne Namen", async () => {
    const sample = {
      day: "2026-11-15",
      total: 120,
      members: 100,
      guests: 20,
      enabled: 108,
      disabled: 12,
      guests_disabled: 2,
      licensed: null,
    };
    stubFetch({
      "/api/tenant/users": {
        enabled: true,
        fetched_at: "2026-11-15T06:00:00Z",
        current: sample,
        samples: [{ ...sample, day: "2026-11-14", total: 119, members: 99 }, sample],
      },
    });
    render(<UsersPage />);
    expect(await screen.findByText("Konten gesamt")).toBeVisible();
    expect(screen.getByText("Konten gesamt").nextSibling).toHaveTextContent("120");
    expect(screen.getByText("Gäste", { selector: "dt" }).parentElement).toHaveTextContent(
      "2 deaktiviert",
    );
    // Fehlt die Zahl der Konten mit Lizenz, steht ein Strich da.
    expect(screen.getByText("Mit Lizenz", { selector: "dt" }).nextSibling).toHaveTextContent("–");
    expect(screen.getByRole("img", { name: /^Verlauf der Benutzerzahlen/ })).toBeVisible();
  });

  it("erklärt den leeren Zustand", async () => {
    stubFetch({
      "/api/tenant/users": { enabled: true, fetched_at: null, current: null, samples: [] },
    });
    render(<UsersPage />);
    expect(await screen.findByText(/noch keine Benutzerzahlen gelesen/)).toBeVisible();
  });
});

function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 1,
    owner_kind: "app",
    owner_name: "Zeiterfassung",
    app_id: "11111111-1111-1111-1111-111111111111",
    kind: "secret",
    name: "Schnittstelle",
    starts_at: null,
    expires_at: "2026-11-20T10:00:00Z",
    days_left: 5,
    level: "dringend",
    ...overrides,
  };
}

describe("Zertifikate und Secrets", () => {
  it("beschreibt Art und Restlaufzeit in Worten", () => {
    expect(credentialKind(credential())).toBe("Secret");
    expect(credentialKind(credential({ kind: "zertifikat" }))).toBe("Zertifikat");
    expect(credentialKind(credential({ kind: "zertifikat", owner_kind: "sso" }))).toBe(
      "Signaturzertifikat (SAML)",
    );
    expect(remainingText(null)).toBe("ohne Ablaufdatum");
    expect(remainingText(-1)).toBe("seit 1 Tag abgelaufen");
    expect(remainingText(-12)).toBe("seit 12 Tagen abgelaufen");
    expect(remainingText(0)).toBe("läuft heute ab");
    expect(remainingText(1)).toBe("noch 1 Tag");
    expect(remainingText(45)).toBe("noch 45 Tage");
  });

  it("zeigt zuerst den Handlungsbedarf und auf Wunsch alles", async () => {
    stubFetch({
      "/api/tenant/credentials": {
        enabled: true,
        fetched_at: "2026-11-15T06:00:00Z",
        warn_days: [60, 30, 7],
        total: 3,
        attention: 2,
        entries: [
          credential({ id: 1, days_left: -3, level: "abgelaufen", name: null }),
          credential({ id: 2 }),
          credential({
            id: 3,
            owner_name: "Reiseportal",
            owner_kind: "sso",
            kind: "zertifikat",
            days_left: 200,
            level: "ok",
          }),
        ],
      },
    });
    render(<CredentialsPage />);
    const table = within(await screen.findByRole("region", { name: "Zertifikate und Secrets" }));
    expect(table.getAllByRole("row")).toHaveLength(3);
    expect(table.getByText("seit 3 Tagen abgelaufen")).toBeVisible();
    expect(table.getByText("dringend")).toBeVisible();
    expect(table.queryByText("Reiseportal")).toBeNull();
    expect(screen.getByText(/Hinweis ab 60 Tagen, Warnung ab 30/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Alle (3)" }));
    expect(table.getByRole("row", { name: /^Reiseportal/ })).toHaveTextContent(
      "Signaturzertifikat (SAML)",
    );
  });

  it("sagt, wenn nichts ansteht, und erklärt den leeren Zustand", async () => {
    stubFetch({
      "/api/tenant/credentials": {
        enabled: true,
        fetched_at: "2026-11-15T06:00:00Z",
        warn_days: [60, 30, 7],
        total: 1,
        attention: 0,
        entries: [credential({ days_left: 200, level: "ok" })],
      },
    });
    const { unmount } = render(<CredentialsPage />);
    expect(await screen.findByText(/Kein Handlungsbedarf/)).toBeVisible();
    unmount();
    stubFetch({
      "/api/tenant/credentials": {
        enabled: false,
        fetched_at: null,
        warn_days: [60, 30, 7],
        total: 0,
        attention: 0,
        entries: [],
      },
    });
    render(<CredentialsPage />);
    expect(await screen.findByText(/ist in dieser Installation nicht eingeschaltet/)).toBeVisible();
  });
});

describe("Wabenansicht", () => {
  it("bricht lange Namen um und kürzt, was nicht passt", () => {
    expect(nameLines("Wiki")).toEqual(["Wiki"]);
    expect(nameLines("Zeiterfassung Schnittstelle")).toEqual(["Zeiterfassung", "Schnittstelle"]);
    expect(nameLines("Lohn- und Gehaltsabrechnung")).toEqual(["Lohn- und", "Gehaltsabrec…"]);
    expect(nameLines("Supercalifragilisticexpialidocious")).toEqual([
      "Supercalifrag",
      "ilisticexpia…",
    ]);
    for (const line of nameLines("Reiseportal-Anbindung Produktion Nord")) {
      expect(line.length).toBeLessThanOrEqual(13);
    }
  });

  it("ordnet die Waben nach der Breite an und versetzt jede zweite Zeile", () => {
    const wide = hexLayout(17, 680);
    expect(wide.columns).toBe(5);
    expect(wide.width).toBeLessThanOrEqual(680);
    expect(wide.centers[5]?.x).toBeGreaterThan(wide.centers[0]?.x ?? 0);
    expect(wide.centers[5]?.y).toBeGreaterThan(wide.centers[0]?.y ?? 0);
    expect(hexLayout(17, 320).columns).toBe(2);
    expect(hexLayout(17, 100).columns).toBe(1);
    expect(hexLayout(0, 680).height).toBe(0);
  });

  it("nennt die Restlaufzeit kurz", () => {
    expect(shortRemaining(null)).toBe("ohne Ablauf");
    expect(shortRemaining(-4)).toBe("abgelaufen");
    expect(shortRemaining(0)).toBe("heute");
    expect(shortRemaining(1)).toBe("1 Tag");
    expect(shortRemaining(45)).toBe("45 Tage");
  });

  it("zeigt alle Einträge als Waben und die Einzelheiten nach der Auswahl", async () => {
    stubFetch({
      "/api/tenant/credentials": {
        enabled: true,
        fetched_at: "2026-11-15T06:00:00Z",
        warn_days: [60, 30, 7],
        total: 2,
        attention: 1,
        entries: [
          credential({ id: 1, owner_name: "Zeiterfassung Schnittstelle Produktion" }),
          credential({
            id: 2,
            owner_name: "Reiseportal",
            owner_kind: "sso",
            kind: "zertifikat",
            name: null,
            days_left: 200,
            level: "ok",
          }),
        ],
      },
    });
    render(<CredentialsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Waben" }));
    expect(screen.queryByRole("region", { name: "Zertifikate und Secrets" })).toBeNull();
    const comb = within(screen.getByRole("group", { name: /als Waben/ }));
    // Auch der Eintrag ohne Handlungsbedarf ist dabei.
    expect(comb.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Eine Wabe auswählen, um die Einzelheiten zu sehen.")).toBeVisible();

    const first = comb.getByRole("button", {
      name: /^Zeiterfassung Schnittstelle Produktion, Secret/,
    });
    expect(first).toHaveTextContent("Zeiterfassung");
    expect(first).toHaveTextContent("5 Tage");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: "Zeiterfassung Schnittstelle Produktion" }),
    ).toBeVisible();
    expect(screen.getByText("11111111-1111-1111-1111-111111111111")).toBeVisible();

    fireEvent.keyDown(comb.getByRole("button", { name: /^Reiseportal/ }), { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Reiseportal" })).toBeVisible();
    expect(screen.getByText("Signaturzertifikat (SAML)")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.getByRole("region", { name: "Zertifikate und Secrets" })).toBeVisible();
  });
});

describe("Dienststatus", () => {
  const exchangeIssue = {
    issue_id: "EX1001",
    service_id: "Exchange",
    service_name: "Exchange Online",
    title: "Verzögerte Zustellung",
    classification: "incident",
    status: "serviceDegradation",
    feature_group: "E-Mail und Kalender",
    feature: "Zustellung",
    impact: "Nachrichten kommen verzögert an.",
    resolved: false,
    start_at: "2026-11-16T09:00:00Z",
    end_at: null,
    modified_at: "2026-11-16T11:00:00Z",
  };

  it("zeigt Ampel, Störungen mit Mitteilungen und die Auswertung", async () => {
    const urls = stubFetch({
      "/api/tenant/health/issues/EX1001": {
        ...exchangeIssue,
        posts: [{ at: "2026-11-16T10:00:00Z", type: "regular", text: "Wir prüfen das." }],
      },
      "/api/tenant/health": {
        enabled: true,
        fetched_at: "2026-11-16T11:15:00Z",
        services: [
          {
            service_id: "Exchange",
            name: "Exchange Online",
            status: "serviceDegradation",
            open_incidents: 1,
            open_advisories: 0,
          },
          {
            service_id: "microsoftteams",
            name: "Microsoft Teams",
            status: "serviceOperational",
            open_incidents: 0,
            open_advisories: 0,
          },
        ],
        open: [exchangeIssue],
        recent: [],
        stats: [
          {
            year: 2026,
            service_id: "Exchange",
            service_name: "Exchange Online",
            incidents: 2,
            advisories: 1,
            incident_hours: 5.5,
          },
        ],
      },
    });
    render(<HealthPage />);
    expect(await screen.findByText("Eingeschränkt")).toBeVisible();
    expect(screen.getAllByText("In Ordnung")).toHaveLength(2);
    expect(screen.getByText(/Verzögerte Zustellung/)).toBeInTheDocument();
    expect(screen.getByText(/2 Störungen, 5,5 Std\. · 1 Hinweise/)).toBeInTheDocument();
    // Die Mitteilungen lädt erst das Aufklappen.
    expect(urls.some((url) => url.includes("/issues/"))).toBe(false);
    const details = screen.getByText(/Verzögerte Zustellung/).closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("Wir prüfen das.")).toBeInTheDocument();
  });

  it("erklärt, wenn der Abruf aus ist", async () => {
    stubFetch({
      "/api/tenant/health": {
        enabled: false,
        fetched_at: null,
        services: [],
        open: [],
        recent: [],
        stats: [],
      },
    });
    render(<HealthPage />);
    expect(await screen.findByText(/nicht eingeschaltet/)).toBeVisible();
  });
});
