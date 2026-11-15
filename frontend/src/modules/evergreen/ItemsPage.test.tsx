import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemsPage } from "./ItemsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = {
  id: 5,
  number: "EV-2026-005",
  title: "Copilot in Outlook",
  service: "Outlook",
  source: "nachrichtencenter",
  major_change: true,
  rollout_date: "2999-12-01",
  step: "betriebsrat",
  step_title: "Betriebsrat",
  finished: false,
  waiting_for_me: true,
  created_at: "2026-11-01T08:00:00Z",
};

function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          entries: [item],
          has_more: false,
          can_create: true,
          counts: { offen: 3, meine: 1, abgeschlossen: 2, alle: 5 },
        }),
        { status: 200 },
      );
    }),
  );
  return urls;
}

describe("ItemsPage", () => {
  it("zeigt Filter mit Anzahl und Vorgänge als Karten", async () => {
    stubFetch();
    render(<ItemsPage />);
    const card = await screen.findByRole("link", { name: /Copilot in Outlook/ });
    expect(card).toHaveAttribute("href", "/evergreen/5");
    expect(card).toHaveTextContent("EV-2026-005 · Outlook");
    expect(card).toHaveTextContent("Wartet auf mich");
    expect(card).toHaveTextContent("Größere Änderung");
    expect(card).toHaveTextContent("Rollout am 01.12.2999");
    expect(screen.getByRole("heading", { level: 1, name: "Vorgänge" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Offen (3)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Vorgang anlegen" })).toBeVisible();
  });

  it("lädt beim Wechsel der Ansicht neu", async () => {
    const urls = stubFetch();
    render(<ItemsPage />);
    await screen.findByRole("link", { name: /Copilot in Outlook/ });
    fireEvent.click(screen.getByRole("button", { name: "Wartet auf mich (1)" }));
    await waitFor(() => {
      expect(urls.some((url) => url.includes("view=meine"))).toBe(true);
    });
  });
});
