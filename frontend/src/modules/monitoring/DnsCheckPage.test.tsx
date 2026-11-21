import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DnsOverview, DnsRow } from "./api";
import { DnsCheckPage } from "./DnsCheckPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function row(fqdn: string, status: DnsRow["status"], extra: Partial<DnsRow> = {}): DnsRow {
  return {
    key: `${fqdn}|A`,
    fqdn,
    type: "A",
    zone: "example.com",
    status,
    new: false,
    netbox: ["192.0.2.5"],
    inactive: [],
    public: status === "ok" ? ["192.0.2.5"] : ["192.0.2.6"],
    missing: status === "ok" ? [] : ["192.0.2.5"],
    extra: status === "ok" ? [] : ["192.0.2.6"],
    notes: [],
    netbox_url: null,
    ...extra,
  };
}

const run = {
  id: 2,
  started_at: "2026-11-16T08:00:00Z",
  finished_at: "2026-11-16T08:01:00Z",
  status: "ok" as const,
  error: null,
  zones: 1,
  records: 2,
  queries: 2,
  counts: { ok: 1, abweichend: 1 },
  delegations: ["kunde.example.com"],
  skipped_types: { HINFO: 1 },
};

const overview: DnsOverview = {
  enabled: true,
  interval_hours: 4,
  last_run: run,
  result_run: run,
  next_run_at: "2026-11-16T12:00:00Z",
  rows: [
    row("www.example.com", "ok"),
    row("mail.example.com", "abweichend", {
      new: true,
      netbox_url: "https://netbox.example.com/x/1",
    }),
  ],
  history: [
    { started_at: "2026-11-15T08:00:00Z", status: "ok", counts: { ok: 2 } },
    { started_at: "2026-11-16T08:00:00Z", status: "ok", counts: { ok: 1, abweichend: 1 } },
  ],
};

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

describe("DnsCheckPage", () => {
  it("zeigt Probleme mit Werten, Hinweisen und Link nach NetBox", async () => {
    stubFetch(overview);
    render(<DnsCheckPage isAdmin={false} />);
    expect(await screen.findByText("mail.example.com")).toBeVisible();
    expect(screen.queryByText("www.example.com")).toBeNull();
    expect(screen.getByText("neu")).toBeVisible();
    expect(screen.getByRole("link", { name: /In NetBox öffnen/ })).toHaveAttribute(
      "href",
      "https://netbox.example.com/x/1",
    );
    expect(screen.getByText("kunde.example.com")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Jetzt prüfen" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Alle · 2" }));
    expect(screen.getByText("www.example.com")).toBeVisible();
  });

  it("filtert über die Kacheln und die Filter nach Status", async () => {
    stubFetch(overview);
    render(<DnsCheckPage isAdmin={false} />);
    const ok = await screen.findByRole("button", { name: /^In Ordnung 1$/ });
    fireEvent.click(ok);
    expect(ok).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "In Ordnung · 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("www.example.com")).toBeVisible();
    expect(screen.queryByText("mail.example.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Abweichend · 1" }));
    expect(screen.getByText("mail.example.com")).toBeVisible();
    expect(screen.queryByText("www.example.com")).toBeNull();
    expect(screen.getByRole("button", { name: /^Abweichend 1$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Fehler · 0" }));
    expect(screen.getByText("Keine Einträge für diese Auswahl.")).toBeVisible();
    // Zone als Überschrift über ihrer Tabelle
    fireEvent.click(screen.getByRole("button", { name: /^Geprüft 2/ }));
    expect(screen.getByRole("heading", { level: 3, name: "example.com 2 Einträge" })).toBeVisible();
  });

  it("öffnet aus der Benachrichtigung die neuen Probleme und lässt Admins vorziehen", async () => {
    window.history.replaceState(null, "", "/monitoring/dns?ansicht=neu");
    stubFetch(overview);
    render(<DnsCheckPage isAdmin />);
    expect(await screen.findByRole("button", { name: "Neu · 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Neu seit dem letzten Lauf 1$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Jetzt prüfen" })).toBeVisible();
  });

  it("weist darauf hin, wenn der Abgleich nicht eingerichtet ist", async () => {
    stubFetch({
      ...overview,
      enabled: false,
      last_run: null,
      result_run: null,
      rows: [],
      history: [],
    });
    render(<DnsCheckPage isAdmin={false} />);
    expect(await screen.findByText(/nicht eingerichtet oder ausgeschaltet/)).toBeVisible();
  });
});
