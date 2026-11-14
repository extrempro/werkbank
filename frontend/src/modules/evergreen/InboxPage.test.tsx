import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxPage } from "./InboxPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const message = {
  id: 9,
  message_id: "MC123456",
  title: "Neue Aufzeichnungsfunktion in Teams",
  services: ["Microsoft Teams"],
  category: "planForChange",
  major_change: true,
  action_required_by: null,
  published_at: "2026-11-10T08:00:00Z",
  modified_at: "2026-11-10T08:00:00Z",
  body: "Ab Januar wird die Funktion aktiviert.",
  status: "neu",
  item_id: null,
};

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST" && url.endsWith("/adopt")) {
        return new Response(JSON.stringify({ id: 4, number: "EV-2026-004" }), { status: 201 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ...message, status: "ignoriert" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ entries: [message], has_more: false, new_count: 1 }),
        { status: 200 },
      );
    }),
  );
  return calls;
}

describe("InboxPage", () => {
  it("zeigt Meldungen mit Einordnung und Text", async () => {
    stubFetch();
    render(<InboxPage />);
    expect(
      await screen.findByRole("heading", { level: 2, name: "Neue Aufzeichnungsfunktion in Teams" }),
    ).toBeVisible();
    expect(screen.getByText("Größere Änderung")).toBeVisible();
    expect(screen.getByText(/Geplante Änderung/)).toBeVisible();
    expect(screen.getByText("Ab Januar wird die Funktion aktiviert.")).toBeInTheDocument();
  });

  it("übernimmt eine Meldung als Vorgang und lädt neu", async () => {
    const calls = stubFetch();
    render(<InboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Als Vorgang übernehmen/ }));
    expect(await screen.findByText("Vorgang EV-2026-004 ist angelegt.")).toBeVisible();
    expect(calls.some((call) => call.url === "/api/evergreen/messages/9/adopt")).toBe(true);
    await waitFor(() => {
      expect(calls.filter((call) => call.init?.method !== "POST").length).toBeGreaterThan(1);
    });
  });

  it("legt eine Meldung beiseite", async () => {
    const calls = stubFetch();
    render(<InboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Beiseitelegen/ }));
    expect(await screen.findByText("MC123456 ist beiseitegelegt.")).toBeVisible();
    const post = calls.find((call) => call.init?.method === "POST");
    expect(post?.url).toBe("/api/evergreen/messages/9/status");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ status: "ignoriert" });
  });
});
