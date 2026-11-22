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
    const [, changed, added, ...rest] = within(result).getAllByRole("row");
    expect(rest).toHaveLength(0);
    if (!changed || !added) {
      throw new Error("Zeilen fehlen");
    }
    expect(within(changed).getByText("Geändert")).toBeTruthy();
    expect(within(changed).getByText("enabled")).toBeTruthy();
    expect(within(changed).getByText("disabled")).toBeTruthy();
    expect(within(added).getByText("Neu")).toBeTruthy();
  });

  it("zeigt zuerst 10 Abrufe und lädt weitere nach", async () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      snapshot(
        13 - index,
        `2026-11-${String(22 - Math.min(index, 20)).padStart(2, "0")}T08:00:00Z`,
      ),
    );
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const params = new URL(url, "http://localhost").searchParams;
        const offset = Number(params.get("offset"));
        const limit = Number(params.get("limit"));
        return new Response(JSON.stringify(many.slice(offset, offset + limit)), { status: 200 });
      }),
    );
    render(<SnapshotsPage />);
    const table = await screen.findByRole("region", { name: "Abrufe" });
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Weitere 10 anzeigen" }));
    await vi.waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(14));
    expect(screen.queryByRole("button", { name: "Weitere 10 anzeigen" })).toBeNull();
    expect(urls[0]).toContain("limit=11&offset=0");
    expect(urls.some((url) => url.includes("offset=10"))).toBe(true);
  });

  it("fasst die Quellen zusammen und zeigt fehlende Berechtigungen aufklappbar", async () => {
    const failing = {
      ...snapshot(5, "2026-11-22T08:00:00Z", "teilweise"),
      source_status: { "utcm:microsoft.teams.a": true, "utcm:microsoft.intune.b": false },
      source_errors: {
        "utcm:microsoft.intune.b":
          "Application must have one of the following scopes: DeviceManagementApps.Read.All - x",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([failing]), { status: 200 })),
    );
    render(<SnapshotsPage />);
    expect(await screen.findByText("1 mit Fehler")).toBeTruthy();
    expect(screen.getByText("Fehler und Quellen anzeigen")).toBeTruthy();
    expect(screen.getByText("DeviceManagementApps.Read.All")).toBeTruthy();
  });
});
