import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function mockFetch(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("zeigt ohne Anmeldung die Login-Seite", async () => {
    mockFetch(401);
    render(<App />);
    const link = await screen.findByRole("link", { name: "Mit Microsoft anmelden" });
    expect(link).toHaveAttribute("href", "/auth/login");
  });

  it("zeigt nach der Anmeldung Name und Navigation", async () => {
    mockFetch(200, {
      display_name: "Erika Beispiel",
      email: "erika@example.com",
      roles: ["Evergreen.Team"],
      authenticated_at: "2026-11-14T08:00:00Z",
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Guten Tag, Erika Beispiel" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Vorgänge" })).toBeInTheDocument();
    expect(screen.queryByText("M365-Konfiguration")).not.toBeInTheDocument();
  });

  it("zeigt bei Serverfehler einen Hinweis", async () => {
    mockFetch(500);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Werkbank nicht erreichbar" })).toBeVisible();
  });
});
