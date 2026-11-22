import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { monthLabel, percentText, pieSlices, type InventoryStatistics } from "./api";
import { InventoryStatisticsPage } from "./StatisticsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = routes[url];
      return body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

const chart = (
  key: string,
  title: string,
  items: { label: string; count: number; value?: number | null; warn?: boolean }[],
  filter: "kind" | "maker" | "site" | null = null,
) => ({ key, title, items, filter, note: "", unit: "Geräte" });

const stats: InventoryStatistics = {
  makers: [
    { id: 1, name: "Hersteller A", count: 3 },
    { id: 0, name: "Ohne Hersteller", count: 1 },
  ],
  kinds: [
    { id: 5, name: "Notebook", count: 3 },
    { id: 6, name: "Headset", count: 1 },
  ],
  sites: [{ id: 0, name: "Ohne Standort", count: 4 }],
  departments: [{ id: 0, name: "Ohne Abteilung", count: 4 }],
  maker_id: null,
  kind_id: null,
  site_id: null,
  department_id: null,
  year_label: "Geschäftsjahr",
  kpis: {
    total: 4,
    new_this_month: 1,
    free: 2,
    loans_open: 2,
    loans_overdue: 1,
    renewal_due: null,
    workplaces_gap: 0,
    missing: 3,
  },
  sections: [
    {
      key: "ueberblick",
      title: "Überblick",
      intro: "Was es gibt und wo es ist.",
      charts: [
        chart(
          "art",
          "Geräte je Art",
          [
            { label: "Notebook", count: 3, value: 5 },
            { label: "Headset", count: 1, value: 6 },
          ],
          "kind",
        ),
        chart("os", "Betriebssystem (NinjaOne)", [
          { label: "Windows 11 Pro", count: 3 },
          { label: "Windows 10 Pro", count: 1, warn: true },
        ]),
      ],
    },
    {
      key: "verleih",
      title: "Verleih",
      intro: "Wie viel verliehen wurde.",
      charts: [chart("rueckgabe", "Rückgabe", [{ label: "Pünktlich", count: 4 }])],
    },
  ],
};

describe("Statistik: Hilfsfunktionen", () => {
  it("rechnet Anteile, Monate und Stücke", () => {
    expect(percentText(1, 3)).toBe("33 %");
    expect(percentText(1, 300)).toBe("<1 %");
    expect(percentText(0, 0)).toBe("0 %");
    expect(monthLabel("2026-03")).toBe("03/26");
    const many = Array.from({ length: 10 }, (_, index) => ({
      label: `M${index}`,
      count: 10 - index,
    }));
    const slices = pieSlices(many);
    expect(slices).toHaveLength(8);
    expect(slices[7]).toEqual({ label: "Andere", count: 3 + 2 + 1 });
  });
});

describe("Statistik: Seite", () => {
  it("zeigt Kennzahlen, wechselt Bereiche und Darstellung", async () => {
    stubFetch({ "/api/inventory/statistics": stats });
    render(<InventoryStatisticsPage />);
    expect(await screen.findByRole("heading", { name: "Geräte je Art" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Aktive Geräte:\s*4/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Erneuerung fällig:\s*–,\s*Nutzungsdauer fehlt/ }),
    ).toBeTruthy();
    expect(screen.getByText("(hervorgehoben)")).toBeTruthy();

    // Kennzahl öffnet den Bereich
    fireEvent.click(screen.getByRole("button", { name: /^Verliehen:\s*2,\s*1 überfällig/ }));
    expect(screen.getByRole("heading", { name: "Rückgabe" })).toBeTruthy();
    expect(window.location.search).toContain("bereich=verleih");
    fireEvent.click(screen.getByRole("button", { name: "Überblick" }));

    // Tabelle statt Balken, mit Hinweis „beachten“
    const tables = screen.getAllByRole("button", { name: "Tabelle" });
    fireEvent.click(tables[1]!);
    expect(tables[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("beachten")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "75 %" })).toBeTruthy();
    window.history.replaceState(null, "", "/");
  });

  it("filtert über die Auswahl und per Klick auf einen Balken", async () => {
    const calls = stubFetch({
      "/api/inventory/statistics": stats,
      "/api/inventory/statistics?maker=1": {
        ...stats,
        maker_id: 1,
        kpis: { ...stats.kpis, total: 3 },
      },
      "/api/inventory/statistics?maker=1&kind=5": {
        ...stats,
        maker_id: 1,
        kind_id: 5,
        kpis: { ...stats.kpis, total: 2 },
      },
    });
    render(<InventoryStatisticsPage />);
    fireEvent.change(await screen.findByLabelText("Hersteller"), { target: { value: "1" } });
    expect(await screen.findByRole("button", { name: /^Aktive Geräte:\s*3/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Notebook/ }));
    expect(await screen.findByRole("button", { name: /^Aktive Geräte:\s*2/ })).toBeTruthy();
    expect(calls).toContain("/api/inventory/statistics?maker=1&kind=5");
    expect((screen.getByLabelText("Art") as HTMLSelectElement).value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));
    expect(await screen.findByRole("button", { name: /^Aktive Geräte:\s*4/ })).toBeTruthy();
  });
});
