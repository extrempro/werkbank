import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotsPage } from "./SnapshotsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function snapshot(id: number, started: string, status = "ok") {
  return {
    id,
    started_at: started,
    finished_at: status === "laeuft" ? null : started,
    status,
    source_status: { "utcm:microsoft.entra.conditionalaccesspolicy": status !== "fehler" },
    change_count: 1,
    resource_count: 2,
  };
}

const snapshots = [
  snapshot(3, "2026-11-17T08:00:00Z"),
  snapshot(2, "2026-11-16T08:00:00Z", "fehler"),
  snapshot(1, "2026-11-15T08:00:00Z"),
];

const comparison = {
  from_id: 1,
  to_id: 3,
  from_at: "2026-11-15T08:00:00Z",
  to_at: "2026-11-17T08:00:00Z",
  total: 2,
  counts: { neu: 1, geaendert: 1, entfernt: 0 },
  truncated: false,
  differences: [
    {
      path: "entra/conditionalAccessPolicy/p1/state",
      workload: "entra",
      area: "conditionalAccessPolicy",
      object_name: "Beispielrichtlinie",
      property: "state",
      kind: "geaendert",
      old_value: "enabled",
      new_value: "disabled",
    },
    {
      path: "entra/conditionalAccessPolicy/p3/state",
      workload: "entra",
      area: "conditionalAccessPolicy",
      object_name: "Neue Richtlinie",
      property: "state",
      kind: "neu",
      old_value: null,
      new_value: "on",
    },
  ],
};

function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const body = url.includes("/compare") ? comparison : snapshots;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return urls;
}

describe("SnapshotsPage", () => {
  it("bietet Export nur für Abrufe mit eigenem Stand", async () => {
    stubFetch();
    render(<SnapshotsPage />);
    const table = await screen.findByRole("region", { name: "Abrufe" });
    const links = within(table).getAllByRole("link", { name: /als (JSON|CSV)$/ });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/api/m365-config/snapshots/3/export.json",
      "/api/m365-config/snapshots/3/export.csv",
      "/api/m365-config/snapshots/1/export.json",
      "/api/m365-config/snapshots/1/export.csv",
    ]);
  });

  it("vergleicht den vorletzten mit dem neuesten verwertbaren Abruf", async () => {
    const urls = stubFetch();
    render(<SnapshotsPage />);
    const form = await screen.findByRole("form", { name: "Abrufe vergleichen" });
    // Der fehlgeschlagene Abruf steht nicht zur Auswahl
    expect(within(form).getAllByRole("option")).toHaveLength(4);
    fireEvent.click(within(form).getByRole("button", { name: "Vergleichen" }));
    const result = await screen.findByRole("region", {
      name: "Unterschiede zwischen den Abrufen",
    });
    expect(urls).toContain("/api/m365-config/snapshots/compare?from=1&to=3");
    expect(screen.getByText(/1 neu, 1 geändert, 0 entfernt/)).toBeTruthy();
    const rows = within(result).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Geändert")).toBeTruthy();
    expect(within(rows[1]).getByText("enabled")).toBeTruthy();
    expect(within(rows[1]).getByText("disabled")).toBeTruthy();
    expect(within(rows[2]).getByText("Neu")).toBeTruthy();
  });
});
