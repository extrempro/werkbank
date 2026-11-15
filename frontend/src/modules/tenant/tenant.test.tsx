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
