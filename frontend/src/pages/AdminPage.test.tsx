import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminPage", () => {
  it("zeigt die Rollen", async () => {
    const roles = [
      {
        value: "Werkbank.Admin",
        label: "Werkbank Admin",
        description: "Verwaltung der Werkbank",
        holders: [
          { display_name: "Ada Admin", email: null, last_login_at: "2026-11-14T08:00:00Z" },
        ],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(roles), { status: 200 })),
    );
    render(<AdminPage />);
    expect(await screen.findByText("Werkbank Admin")).toBeVisible();
    expect(screen.getByText(/Ada Admin/)).toBeVisible();
  });

  it("bittet um erneute Anmeldung, wenn die letzte zu lange her ist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "Erneute Anmeldung erforderlich" }), {
            status: 403,
            headers: { "X-Werkbank-Step-Up": "required" },
          }),
      ),
    );
    render(<AdminPage />);
    const link = await screen.findByRole("link", { name: "Erneut anmelden" });
    expect(link).toHaveAttribute("href", "/auth/login?step_up=true&return_to=%2Fverwaltung");
    expect(screen.queryByText(/Keine Berechtigung/)).toBeNull();
  });

  it("meldet fehlende Berechtigung ohne Hinweis auf erneute Anmeldung", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    render(<AdminPage />);
    expect(await screen.findByText(/Keine Berechtigung/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Erneut anmelden" })).toBeNull();
  });
});
