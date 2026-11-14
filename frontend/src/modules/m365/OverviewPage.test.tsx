import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { OverviewPage } from "./OverviewPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const me: Me = {
  display_name: "Lea",
  email: null,
  roles: ["Config.Reader"],
  authenticated_at: "2026-11-14T08:00:00Z",
};

const overview = {
  collector_configured: true,
  collect_pending: false,
  last_snapshot: null,
  settings_total: 120,
  described_total: 45,
  open_changes: 3,
  open_critical: 1,
  changes_last_7_days: 5,
  changes_last_30_days: 9,
  changes_per_day: [
    { day: "2026-11-13", count: 0 },
    { day: "2026-11-14", count: 3 },
  ],
  deviations: 2,
  resources_this_month: 40,
  monthly_limit: 20000,
  workloads: ["entra"],
};

const change = {
  id: 7,
  setting_id: 3,
  path: "entra/conditionalaccesspolicy/p1/State",
  workload: "entra",
  object_name: "MFA für alle",
  property: "State",
  criticality: null,
  description: null,
  kind: "geaendert",
  status: "ungewollt",
  detected_at: "2026-11-14T08:00:00Z",
  old_value: "enabled",
  new_value: "disabled",
  changed_by: null,
  reviewed_by: null,
  reviewed_at: null,
  comment: null,
};

function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const body = url.includes("/overview")
        ? overview
        : {
            entries: [change],
            has_more: false,
            counts: { alle: 1, offen: 0, gewollt: 0, ungewollt: 1 },
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return urls;
}

describe("OverviewPage", () => {
  it("zeigt Kennzahlen, Diagramm und letzte Änderungen", async () => {
    const urls = stubFetch();
    render(<OverviewPage me={me} />);
    expect(await screen.findByText("davon kritisch: 1")).toBeVisible();
    expect(screen.getByText("davon beschrieben: 45")).toBeVisible();
    expect(urls.find((url) => url.includes("/overview"))).toMatch(/tz=/);

    const chart = screen.getByRole("table", { name: "Erkannte Änderungen je Tag" });
    expect(within(chart).getAllByRole("row")).toHaveLength(3);

    const recent = screen.getByRole("region", { name: "Letzte Änderungen" });
    expect(
      await within(recent).findByRole("link", { name: "MFA für alle – State" }),
    ).toHaveAttribute("href", "/m365/einstellungen/3");
    expect(within(recent).getByText("Ungewollt")).toBeVisible();
  });
});
