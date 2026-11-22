import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZbxReport } from "./api";
import { formatDuration, formatPercent, ZabbixReportsPage } from "./ZabbixReports";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const months = Array.from({ length: 12 }, (_, index) => ({
  month: `2026-${String(index + 1).padStart(2, "0")}`,
  label: `Monat ${index + 1}`,
  availability: index === 10 ? 99.2 : null,
  downtime_s: index === 10 ? 3600 : 0,
}));

const report: ZbxReport = {
  year_label: "Geschäftsjahr",
  years: [
    { year: 2026, name: "2026" },
    { year: 2025, name: "2025" },
  ],
  year: 2026,
  name: "2026",
  first_day: "2026-01-01",
  last_day: "2026-12-31",
  since: "2026-11-01",
  days: 21,
  target: 99.5,
  split: "standort",
  availability: 99.996,
  downtime_s: 3600,
  maintenance_s: 7200,
  hosts: 3,
  months,
  rows: [
    {
      name: "Gebäude A (Beispielstadt)",
      hosts: 2,
      availability: 99.9,
      downtime_s: 600,
      maintenance_s: 0,
      months: months.map(() => null),
    },
    {
      name: "ohne Standort",
      hosts: 1,
      availability: 98.1,
      downtime_s: 3000,
      maintenance_s: 7200,
      months: months.map(() => null),
    },
  ],
  detail: true,
  triggers: [{ name: "Switch B nicht erreichbar", host: "Switch B", count: 4, duration_s: 3000 }],
  outages: [
    {
      host: "Switch B",
      site: null,
      name: "Switch B nicht erreichbar",
      started_at: "2026-11-20T08:00:00Z",
      ended_at: null,
      duration_s: 90000,
    },
  ],
};

function stubFetch(body: (url: string) => unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async (input) => new Response(JSON.stringify(body(String(input))), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Formate", () => {
  it("schneidet Prozent ab statt aufzurunden und schreibt Dauern lesbar", () => {
    expect(formatPercent(99.996)).toBe("99,99 %");
    expect(formatPercent(null)).toBe("–");
    expect(formatDuration(0)).toBe("0 Min.");
    expect(formatDuration(30)).toBe("1 Min.");
    expect(formatDuration(90000)).toBe("1 Tg. 1 Std.");
  });
});

describe("ZabbixReportsPage", () => {
  it("zeigt Verfügbarkeit, Zielwert, Tabellen und lädt bei anderer Aufteilung neu", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("split=gruppe")
        ? { ...report, split: "gruppe", rows: [{ ...report.rows[0]!, name: "Server" }] }
        : report,
    );
    render(<ZabbixReportsPage />);
    expect(await screen.findByText("99,99 %")).toBeVisible();
    expect(screen.getAllByText("Ziel erreicht").length).toBeGreaterThan(0);
    expect(screen.getByText("Gebäude A (Beispielstadt)")).toBeVisible();
    expect(screen.getAllByText("unter Ziel").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Häufigste Auslöser" })).toBeVisible();
    expect(screen.getByText("läuft noch")).toBeVisible();
    expect(screen.getByRole("link", { name: "Als CSV exportieren" })).toHaveAttribute(
      "href",
      "/api/monitoring/zabbix/reports/export.csv?split=standort&year=2026",
    );
    fireEvent.change(screen.getByLabelText("Aufteilen nach"), { target: { value: "gruppe" } });
    expect(await screen.findByText("Server")).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("split=gruppe"))).toBe(true);
  });

  it("zeigt ohne Detailrecht keine Auslöser und druckt erst nach dem Audit", async () => {
    const fetchMock = stubFetch((url) =>
      url.endsWith("/printed")
        ? { ok: true }
        : { ...report, detail: false, triggers: null, outages: null },
    );
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<ZabbixReportsPage />);
    expect(await screen.findByText("99,99 %")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Häufigste Auslöser" })).toBeNull();
    expect(screen.queryByText("Switch B")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Drucken oder als PDF" }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    const posted = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/printed"))!;
    expect(JSON.parse(String(posted[1]!.body))).toEqual({
      year: 2026,
      split: "standort",
    });
  });
});
