import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { formatScore, levelLabel } from "./api";
import { RecommendationsPage } from "./RecommendationsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function me(roles: string[]): Me {
  return { display_name: "Rita", email: null, roles, authenticated_at: "2026-11-14T08:00:00Z" };
}

const open = {
  id: 2,
  control_id: "UserRiskPolicy",
  title: "Enable user risk policy",
  category: "Identity",
  service: "AzureAD",
  user_impact: "Moderate",
  implementation_cost: "Low",
  rank: 2,
  score: 0,
  max_score: 7.5,
  fulfilled: false,
  status_text: "17 of 17 users without policy.",
  deprecated: false,
  active: true,
  linked_settings: 1,
};

const list = {
  enabled: true,
  fetched_at: "2026-11-15T06:00:00Z",
  score: 10,
  max_score: 17.5,
  open_count: 1,
  fulfilled_count: 1,
  entries: [open],
};

const linked = {
  id: 7,
  path: "entra/conditionalaccesspolicy/p1/State",
  workload: "entra",
  object_name: "MFA für alle",
  property: "State",
  active: true,
};

const detail = {
  recommendation: open,
  remediation: "Turn on the policy.",
  action_url: "https://entra.microsoft.com/",
  action_type: "Config",
  fetched_at: "2026-11-15T06:00:00Z",
  settings: [linked],
};

const hit = { ...linked, id: 9, object_name: "Gäste", area: "conditionalaccesspolicy" };

function stubFetch(listBody: unknown = list) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      let body: unknown = listBody;
      if (url.includes("/settings?")) {
        body = { entries: [linked, hit], has_more: false };
      } else if (/\/recommendations\/\d+/.test(url)) {
        body = init?.method === "DELETE" ? { ...detail, settings: [] } : detail;
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

describe("Hilfen", () => {
  it("zeigt Punkte und Stufen verständlich", () => {
    expect(formatScore(7.5, 10)).toBe("7,5 von 10");
    expect(formatScore(null, 5)).toBe("– von 5");
    expect(levelLabel("Moderate")).toBe("mittel");
    expect(levelLabel(null)).toBe("–");
  });
});

describe("RecommendationsPage", () => {
  it("zeigt die offenen Empfehlungen mit Stand und wechselt die Ansicht", async () => {
    const calls = stubFetch();
    render(<RecommendationsPage me={me(["Config.Reader"])} />);
    expect(await screen.findByText("Enable user risk policy")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Empfehlungen" })).toBeVisible();
    expect(screen.getByText(/Erreicht: 10 von 17,5 Punkten/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Offen · 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Empfehlung in der Liste wählen/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Erfüllt · 1" }));
    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.includes("view=erfuellt"))).toBe(true),
    );
  });

  it("erklärt, wenn der Abruf nicht eingeschaltet ist", async () => {
    stubFetch({ ...list, enabled: false, open_count: 0, fulfilled_count: 0, entries: [] });
    render(<RecommendationsPage me={me(["Config.Reader"])} />);
    expect(await screen.findByText(/ist in dieser Installation nicht eingeschaltet/)).toBeVisible();
  });

  it("zeigt Details; Lesende können nichts zuordnen", async () => {
    stubFetch();
    render(<RecommendationsPage me={me(["Config.Reader"])} selectedId={2} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Enable user risk policy" }),
    ).toBeVisible();
    expect(screen.getByText("Turn on the policy.")).toBeVisible();
    expect(screen.getByText("17 of 17 users without policy.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Bei Microsoft öffnen/ })).toHaveAttribute(
      "href",
      "https://entra.microsoft.com/",
    );
    expect(screen.getByRole("link", { name: "MFA für alle – State" })).toHaveAttribute(
      "href",
      "/m365/einstellungen/7",
    );
    expect(screen.queryByRole("button", { name: /Lösen/ })).toBeNull();
    expect(screen.queryByLabelText(/Einstellung suchen/)).toBeNull();
  });

  it("lässt Reviewer Einstellungen suchen, zuordnen und lösen", async () => {
    const calls = stubFetch();
    render(<RecommendationsPage me={me(["Config.Reviewer"])} selectedId={2} />);
    fireEvent.change(await screen.findByLabelText(/Einstellung suchen/), {
      target: { value: "Gäste" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }));
    const results = await screen.findByRole("list", { name: "Suchergebnis" });
    expect(within(results).getByText("zugeordnet")).toBeVisible();
    fireEvent.click(within(results).getByRole("button", { name: /Zuordnen – Gäste – State/ }));
    await vi.waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
    const post = calls.find((call) => call.init?.method === "POST");
    expect(post?.url).toBe("/api/m365-config/recommendations/2/links");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ setting_id: 9 });

    // Während die Zuordnung gespeichert wird, sind die Knöpfe gesperrt.
    const release = screen.getByRole("button", { name: /Lösen – MFA für alle – State/ });
    await vi.waitFor(() => expect(release).toBeEnabled());
    fireEvent.click(release);
    expect(await screen.findByText("Noch keine Einstellung zugeordnet.")).toBeVisible();
    expect(calls.some((call) => call.url.endsWith("/recommendations/2/links/7"))).toBe(true);
  });
});
