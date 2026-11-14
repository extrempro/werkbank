import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { ChangesPage } from "./ChangesPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const change = {
  id: 7,
  setting_id: 3,
  path: "entra/conditionalaccesspolicy/p1/State",
  object_name: "MFA für alle",
  property: "State",
  kind: "geaendert",
  status: "offen",
  detected_at: "2026-11-14T08:00:00Z",
  old_value: "enabled",
  new_value: "disabled",
  changed_by: "ada@example.com",
  reviewed_by: null,
  reviewed_at: null,
  comment: null,
};

function me(roles: string[]): Me {
  return { display_name: "Rita", email: null, roles, authenticated_at: "2026-11-14T08:00:00Z" };
}

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ updated: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ entries: [change], has_more: false }), { status: 200 });
    }),
  );
  return calls;
}

describe("ChangesPage", () => {
  it("zeigt Änderungen mit altem und neuem Wert", async () => {
    const calls = stubFetch();
    render(<ChangesPage me={me(["Config.Reader"])} />);
    expect(await screen.findByRole("link", { name: "MFA für alle – State" })).toHaveAttribute(
      "href",
      "/m365/einstellungen/3",
    );
    expect(screen.getByText("enabled")).toBeVisible();
    expect(screen.getByText("disabled")).toBeVisible();
    expect(screen.getByText("ada@example.com")).toBeVisible();
    expect(calls[0]?.url).toContain("status=offen");
  });

  it("bietet Lesern keine Bewertung an", async () => {
    stubFetch();
    render(<ChangesPage me={me(["Config.Reader"])} />);
    await screen.findByText("enabled");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Als gewollt bewerten" })).toBeNull();
  });

  it("verlangt Auswahl und bei ungewollt einen Kommentar", async () => {
    const calls = stubFetch();
    render(<ChangesPage me={me(["Config.Reviewer"])} />);
    await screen.findByText("enabled");

    fireEvent.click(screen.getByRole("button", { name: "Als gewollt bewerten" }));
    expect(screen.getByRole("alert")).toHaveTextContent("mindestens eine Änderung");

    fireEvent.click(screen.getByRole("checkbox", { name: "MFA für alle – State auswählen" }));
    fireEvent.click(screen.getByRole("button", { name: "Als ungewollt bewerten" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Kommentar nötig");
    expect(calls.some((call) => call.init?.method === "POST")).toBe(false);
  });

  it("bietet der Evergreen-IT an, aus einer Änderung einen Vorgang zu machen", async () => {
    const calls = stubFetch();
    render(<ChangesPage me={me(["Config.Reader"])} />);
    await screen.findByText("enabled");
    expect(screen.queryByRole("button", { name: /Vorgang anlegen/ })).toBeNull();
    cleanup();

    render(<ChangesPage me={me(["Config.Reader", "Evergreen.IT"])} />);
    fireEvent.click(await screen.findByRole("button", { name: /Vorgang anlegen/ }));
    await waitFor(() => {
      const post = calls.find((call) => call.init?.method === "POST");
      expect(post?.url).toBe("/api/evergreen/items/from-change");
      expect(JSON.parse(String(post?.init?.body))).toEqual({ change_id: 7 });
    });
  });

  it("sendet die Bewertung und lädt neu", async () => {
    const calls = stubFetch();
    render(<ChangesPage me={me(["Config.Reviewer"])} />);
    await screen.findByText("enabled");

    fireEvent.click(screen.getByRole("checkbox", { name: "MFA für alle – State auswählen" }));
    fireEvent.change(screen.getByLabelText(/Kommentar/), {
      target: { value: " Nicht abgestimmt " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Als ungewollt bewerten" }));

    expect(await screen.findByText("1 Änderung(en) als ungewollt bewertet.")).toBeVisible();
    const post = calls.find((call) => call.init?.method === "POST");
    expect(post?.url).toBe("/api/m365-config/changes/review");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      ids: [7],
      status: "ungewollt",
      comment: "Nicht abgestimmt",
    });
    await waitFor(() => {
      expect(calls.filter((call) => call.init?.method !== "POST").length).toBeGreaterThan(1);
    });
  });
});
