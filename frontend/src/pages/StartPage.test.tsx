import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api";
import { resetNavPrefs } from "../navPrefs";
import { StartPage } from "./StartPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetNavPrefs();
});

function mockApi(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(routes).find((route) => url.startsWith(route));
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response("{}", { status: 404 });
    }),
  );
}

const me: Me = {
  display_name: "Rita Reviewer",
  email: null,
  roles: ["Config.Reviewer"],
  authenticated_at: "2026-11-14T08:00:00Z",
};

describe("StartPage", () => {
  it("zeigt angeheftete und zuletzt besuchte Seiten, nur mit Recht", () => {
    mockApi({});
    resetNavPrefs({
      pinned: ["/m365/aenderungen", "/budget"],
      recent: ["/m365/snapshots", "/verwaltung"],
    });
    render(<StartPage me={me} tasks={[]} />);
    const pinned = screen.getByRole("region", { name: "Angeheftet" });
    expect(within(pinned).getByRole("link", { name: "Änderungen M365" })).toHaveAttribute(
      "href",
      "/m365/aenderungen",
    );
    expect(within(pinned).queryByRole("link", { name: /Übersicht/ })).toBeNull();
    expect(within(pinned).getByRole("button", { name: "Änderungen anheften" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const recent = screen.getByRole("region", { name: "Zuletzt besucht" });
    expect(
      within(recent)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/m365/snapshots"]);
  });

  it("erklärt das Anheften, solange nichts angeheftet ist", () => {
    mockApi({});
    render(<StartPage me={me} tasks={[]} />);
    expect(
      within(screen.getByRole("region", { name: "Angeheftet" })).getByText(
        /Noch nichts angeheftet/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Zuletzt besucht" })).toBeNull();
  });

  it("zeigt Aufgaben mit Anzahl und Ziel", () => {
    const tasks = [
      {
        module: "M365-Konfiguration",
        title: "Änderungen bewerten",
        subtitle: "Erkannte Änderungen einordnen",
        link: "/m365/aenderungen",
        count: 3,
      },
      {
        module: "M365-Konfiguration",
        title: "Abruf aus dem Tenant ist fehlgeschlagen",
        subtitle: null,
        link: "/m365/snapshots",
        count: 1,
      },
    ];
    render(<StartPage me={me} tasks={tasks} />);
    expect(screen.getByRole("link", { name: "Änderungen bewerten (3)" })).toHaveAttribute(
      "href",
      "/m365/aenderungen",
    );
    expect(
      screen.getByRole("link", { name: "Abruf aus dem Tenant ist fehlgeschlagen" }),
    ).toBeVisible();
    expect(screen.queryByText("Keine offenen Aufgaben.")).toBeNull();
  });

  it("zeigt die letzten Aktivitäten aus der Glocke", async () => {
    mockApi({
      "/api/notifications": {
        unread: 1,
        entries: [
          {
            id: 5,
            kind: "m365.aenderung",
            module: "Microsoft 365",
            title: "3 neue Änderungen",
            link: "/m365/aenderungen",
            created_at: "2026-11-14T08:00:00Z",
            read: false,
          },
          {
            id: 4,
            kind: "budget.rechnung",
            module: "IT-Budget",
            title: "Rechnung fällig",
            link: "https://example.com/fremd",
            created_at: "2026-11-13T08:00:00Z",
            read: true,
          },
        ],
      },
    });
    render(<StartPage me={me} tasks={[]} />);
    const panel = await screen.findByRole("region", { name: "Letzte Aktivitäten" });
    const first = await within(panel).findByRole("link", { name: /3 neue Änderungen/ });
    expect(first).toHaveAttribute("href", "/m365/aenderungen");
    expect(first).toHaveTextContent("Ungelesen:");
    // Fremde Ziele führen nie aus der Werkbank heraus.
    expect(within(panel).getByRole("link", { name: /Rechnung fällig/ })).toHaveAttribute(
      "href",
      "/benachrichtigungen",
    );
    expect(within(panel).getByRole("link", { name: "Alle Benachrichtigungen" })).toBeVisible();
  });

  it("sagt, wenn es noch keine Aktivitäten gibt", async () => {
    mockApi({ "/api/notifications": { unread: 0, entries: [] } });
    render(<StartPage me={me} tasks={[]} />);
    expect(await screen.findByText("Noch nichts Neues aus deinen Bereichen.")).toBeVisible();
  });

  it("zeigt den leeren Zustand und den Ladezustand", () => {
    const { rerender } = render(<StartPage me={me} tasks={[]} />);
    expect(screen.getByText("Keine offenen Aufgaben.")).toBeVisible();
    rerender(<StartPage me={me} tasks={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Wird geladen");
  });

  it("begrüßt nach Tageszeit und nennt Datum und Zahl der Aufgaben", () => {
    mockApi({});
    const tasks = [
      { module: "Evergreen", title: "A", subtitle: null, link: "/evergreen/m365", count: 2 },
      { module: "Evergreen", title: "B", subtitle: null, link: "/evergreen/m365", count: 1 },
    ];
    render(<StartPage me={me} tasks={tasks} now={new Date(2026, 10, 14, 8, 30)} />);
    expect(screen.getByRole("heading", { name: "Guten Morgen, Rita Reviewer" })).toBeVisible();
    expect(screen.getByText("Samstag, 14. November 2026 · 3 offene Aufgaben")).toBeVisible();
  });

  it("zeigt Kacheln nur für Module, die die Person sehen darf", async () => {
    mockApi({
      "/api/m365-config/overview": {
        collector_configured: true,
        collect_pending: false,
        last_snapshot: null,
        settings_total: 42,
        open_changes: 3,
        deviations: 1,
        resources_this_month: 0,
        monthly_limit: 20000,
        workloads: [],
      },
    });
    render(<StartPage me={me} tasks={[]} />);
    const tile = await screen.findByRole("region", { name: "M365-Konfiguration" });
    expect(tile).toHaveTextContent("3 offen");
    expect(tile).toHaveTextContent("Überwachte Einstellungen42");
    expect(screen.getByRole("link", { name: "M365-Konfiguration" })).toHaveAttribute(
      "href",
      "/m365",
    );
    expect(screen.queryByRole("region", { name: "Evergreen" })).toBeNull();
  });

  it("zählt in der Evergreen-Kachel neue und offene Einträge", async () => {
    mockApi({
      "/api/evergreen/entries": { entries: [], total: 5, open: 5, new: 3, can_edit: false },
    });
    render(<StartPage me={{ ...me, roles: ["Evergreen.Reader"] }} tasks={[]} />);
    const tile = await screen.findByRole("region", { name: "Evergreen" });
    expect(tile).toHaveTextContent("3 neu");
    expect(tile).toHaveTextContent("Microsoft 365: offen5");
    expect(tile).toHaveTextContent("davon neu3");
  });
});
