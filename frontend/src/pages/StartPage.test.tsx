import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api";
import { StartPage } from "./StartPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it("zeigt den leeren Zustand und den Ladezustand", () => {
    const { rerender } = render(<StartPage me={me} tasks={[]} />);
    expect(screen.getByText("Keine offenen Aufgaben.")).toBeVisible();
    rerender(<StartPage me={me} tasks={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Wird geladen");
  });

  it("begrüßt nach Tageszeit und nennt Datum und Zahl der Aufgaben", () => {
    mockApi({});
    const tasks = [
      { module: "Evergreen", title: "A", subtitle: null, link: "/evergreen", count: 2 },
      { module: "Evergreen", title: "B", subtitle: null, link: "/evergreen/eingang", count: 1 },
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

  it("zählt in der Evergreen-Kachel, was auf die Person wartet", async () => {
    const item = (id: number, waiting: boolean, rollout: string | null) => ({
      id,
      number: `EV-2026-00${id}`,
      title: `Vorgang ${id}`,
      service: null,
      source: "manuell",
      major_change: false,
      rollout_date: rollout,
      step: "it_bewertung",
      step_title: "IT-Bewertung",
      finished: false,
      waiting_for_me: waiting,
      created_at: "2026-11-01T08:00:00Z",
    });
    mockApi({
      "/api/evergreen/items": {
        entries: [item(1, true, "2999-12-01"), item(2, false, null)],
        has_more: false,
        can_create: false,
      },
    });
    render(<StartPage me={{ ...me, roles: ["Evergreen.GF"] }} tasks={[]} />);
    const tile = await screen.findByRole("region", { name: "Evergreen" });
    expect(tile).toHaveTextContent("1 für mich");
    expect(tile).toHaveTextContent("Offene Vorgänge2");
    expect(tile).toHaveTextContent("Nächster Rollout01.12.2999");
  });
});
