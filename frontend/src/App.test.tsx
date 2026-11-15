import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
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
    expect(
      await screen.findByRole("heading", { name: /^Guten (Morgen|Tag|Abend), Erika Beispiel$/ }),
    ).toBeVisible();
    // Auf der Startseite zeigt die Navigation den allgemeinen Bereich; Evergreen ist ein eigener.
    expect(screen.getByRole("link", { name: "Evergreen" })).toHaveAttribute("href", "/evergreen");
    expect(screen.queryByRole("link", { name: "Microsoft 365" })).toBeNull();
    expect(screen.getByRole("link", { name: "Werkbank" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Meine Aufgaben" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /^Neuigkeiten/ })).toHaveAttribute(
      "href",
      "/neuigkeiten",
    );
    fireEvent.click(screen.getByRole("button", { name: "Navigation einklappen" }));
    expect(screen.getByRole("button", { name: "Navigation ausklappen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(window.localStorage.getItem("werkbank-navigation")).toBe("eingeklappt");
    fireEvent.click(screen.getByRole("button", { name: "Dunkle Darstellung einschalten" }));
    expect(document.documentElement.dataset.theme).toBe("dunkel");
    expect(screen.getByText("EB")).toBeInTheDocument();
    expect(screen.getByText("Evergreen-Team")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Erika Beispiel.*Konto öffnen/ })).toHaveAttribute(
      "href",
      "/konto",
    );
    expect(screen.queryByText("M365-Konfiguration")).not.toBeInTheDocument();
  });

  it("zeigt bei Serverfehler einen Hinweis", async () => {
    mockFetch(500);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Werkbank nicht erreichbar" })).toBeVisible();
  });
});
