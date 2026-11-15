import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { SettingsPage } from "./SettingsPage";

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

function setting(id: number, workload: string, name: string, extra: object = {}) {
  return {
    id,
    path: `${workload}/bereich/${id}/State`,
    workload,
    area: "bereich",
    object_id: String(id),
    object_name: name,
    property: "State",
    source: "utcm",
    active: true,
    value: "enabled",
    valid_from: "2026-11-01T08:00:00Z",
    criticality: null,
    deviates: false,
    open_changes: 0,
    from_evergreen: false,
    ...extra,
  };
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("/overview")
        ? { workloads: ["entra", "teams"] }
        : {
            entries: [
              setting(1, "teams", "Besprechungsrichtlinie", { from_evergreen: true }),
              setting(2, "entra", "MFA für alle", { open_changes: 2, deviates: true }),
            ],
            has_more: false,
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

describe("SettingsPage", () => {
  it("zeigt die Einstellungen als Baum nach Workload mit Kennzeichen", async () => {
    stubFetch();
    render(<SettingsPage me={me} />);
    const mfa = await screen.findByRole("link", { name: /MFA für alle/ });
    expect(mfa).toHaveAttribute("href", "/m365/einstellungen/2");
    expect(mfa).toHaveTextContent("offen");
    expect(mfa).toHaveTextContent("weicht ab");
    expect(screen.getByRole("link", { name: /Besprechungsrichtlinie/ })).toHaveTextContent("BR");

    const groups = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(groups).toEqual(["Entra", "Teams"]);
    expect(within(screen.getByRole("list", { name: "Entra" })).getAllByRole("link")).toHaveLength(
      1,
    );
    expect(screen.getByText("2 Treffer")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    expect(screen.getByText(/Einstellung in der Liste wählen/)).toBeInTheDocument();
  });
});
