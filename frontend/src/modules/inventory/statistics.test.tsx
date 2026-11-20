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

const stats: InventoryStatistics = {
  makers: [
    { id: 1, name: "Hersteller A", count: 3 },
    { id: 0, name: "Ohne Hersteller", count: 1 },
  ],
  maker_id: null,
  total: 4,
  charts: [
    {
      key: "art",
      title: "Geräte je Art",
      ordered: false,
      items: [
        { label: "Notebook", count: 3 },
        { label: "Headset", count: 1 },
      ],
    },
  ],
  loans: { open: 2, overdue: 1, months: [{ label: "2026-11", count: 2 }] },
  retired: [{ year: 2025, count: 1, reasons: [{ label: "Defekt", count: 1 }] }],
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
  it("zeigt Balken, schaltet auf Kreis und filtert nach Hersteller", async () => {
    const calls = stubFetch({
      "/api/inventory/statistics": stats,
      "/api/inventory/statistics?maker=1": { ...stats, maker_id: 1, total: 3 },
    });
    render(<InventoryStatisticsPage />);
    expect(await screen.findByText("4 aktive Geräte")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Geräte je Art" })).toBeTruthy();
    expect(screen.getAllByText("Notebook").length).toBeGreaterThan(0);
    expect(screen.getByText("Gerade verliehen")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Defekt" })).toBeTruthy();

    const switches = screen.getAllByRole("button", { name: "Kreis" });
    fireEvent.click(switches[0]!);
    expect(switches[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Geräte je Art: 4 Geräte" })).toBeTruthy();
    expect(screen.getByText("3 · 75 %")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Hersteller"), { target: { value: "1" } });
    expect(await screen.findByText("3 aktive Geräte")).toBeTruthy();
    expect(calls).toContain("/api/inventory/statistics?maker=1");
  });
});
