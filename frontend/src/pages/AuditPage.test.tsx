import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "./AuditPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuditPage", () => {
  it("zeigt Einträge als Tabelle", async () => {
    const page = {
      entries: [
        {
          id: 1,
          occurred_at: "2026-11-14T08:00:00Z",
          user: "Ada Admin",
          module: "kern",
          action: "anmeldung.erfolgreich",
          object_type: null,
          object_id: null,
          result: "ok",
          origin: "203.0.113.0/24",
          details: { methode: "entra" },
        },
      ],
      has_more: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(page), { status: 200 })),
    );
    render(<AuditPage />);
    expect(await screen.findByText("anmeldung.erfolgreich")).toBeVisible();
    expect(screen.getByText("Ada Admin")).toBeVisible();
    expect(screen.getByText("methode: entra")).toBeVisible();
    expect(screen.getByText("203.0.113.0/24")).toBeVisible();
    expect(screen.getByRole("link", { name: "Als CSV exportieren" })).toHaveAttribute(
      "href",
      "/api/audit/export.csv?",
    );
  });

  it("zeigt ohne Berechtigung einen Hinweis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    render(<AuditPage />);
    expect(await screen.findByText(/Keine Berechtigung/)).toBeVisible();
  });
});
