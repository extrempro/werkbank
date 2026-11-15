import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { SettingDetailPage } from "./SettingDetailPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function detail(description: string | null, state: "ungeprueft" | "geprueft" | null) {
  return {
    setting: {
      id: 3,
      path: "entra/conditionalaccesspolicy/p1/State",
      workload: "entra",
      area: "conditionalaccesspolicy",
      object_id: "p1",
      object_name: "MFA für alle",
      property: "State",
      source: "utcm",
      active: true,
      value: "enabled",
      valid_from: "2026-11-14T08:00:00Z",
      criticality: null,
      deviates: false,
    },
    meta: {
      description,
      reasoning: null,
      criticality: null,
      owner: null,
      learn_url: null,
      target_set: false,
      target_value: null,
      target_source: null,
    },
    ai_text: state
      ? {
          text: "Legt fest, ob die Richtlinie wirkt.",
          state,
          model: "beispiel-modell",
          generated_at: "2026-11-15T08:00:00Z",
        }
      : null,
    meta_history: [],
    versions: [],
    changes: [],
  };
}

function me(roles: string[]): Me {
  return { display_name: "Rita", email: null, roles, authenticated_at: "2026-11-14T08:00:00Z" };
}

function stubFetch(body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

describe("KI-Text in der Einstellung", () => {
  it("zeigt den Text mit Kennzeichen, Lesende können ihn nicht freigeben", async () => {
    stubFetch(detail(null, "ungeprueft"));
    render(<SettingDetailPage id={3} me={me(["Config.Reader"])} />);
    expect(await screen.findByText("Legt fest, ob die Richtlinie wirkt.")).toBeVisible();
    expect(screen.getByText("KI-generiert, ungeprüft")).toBeVisible();
    expect(screen.getByText(/mit beispiel-modell/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Text freigeben" })).toBeNull();
  });

  it("lässt Reviewer den Text freigeben", async () => {
    const calls = stubFetch(detail(null, "ungeprueft"));
    render(<SettingDetailPage id={3} me={me(["Config.Reviewer"])} />);
    fireEvent.click(await screen.findByRole("button", { name: "Text freigeben" }));
    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.endsWith("/settings/3/ai-text"))).toBe(true),
    );
    const call = calls.find((entry) => entry.url.endsWith("/ai-text"));
    expect(call?.init?.method).toBe("POST");
    expect(JSON.parse(String(call?.init?.body))).toEqual({ action: "freigeben" });
  });

  it("zeigt nach der Freigabe das Kennzeichen „geprüft“ und nur noch „verwerfen“", async () => {
    stubFetch(detail(null, "geprueft"));
    render(<SettingDetailPage id={3} me={me(["Config.Reviewer"])} />);
    expect(await screen.findByText("KI-generiert, geprüft")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Text freigeben" })).toBeNull();
    expect(screen.getByRole("button", { name: "Text verwerfen" })).toBeVisible();
  });

  it("zeigt die eigene Beschreibung statt des KI-Texts", async () => {
    stubFetch(detail("Von Hand beschrieben.", "ungeprueft"));
    render(<SettingDetailPage id={3} me={me(["Config.Reader"])} />);
    expect(await screen.findByText("Von Hand beschrieben.")).toBeVisible();
    expect(screen.queryByText("Legt fest, ob die Richtlinie wirkt.")).toBeNull();
  });
});
