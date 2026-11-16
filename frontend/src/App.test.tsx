import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_EVENT, notifyTasksChanged } from "./api";
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

  it("lädt die Zähler nach einer Änderung neu", async () => {
    let tasks = [
      { module: "Evergreen", title: "Neue Meldungen", subtitle: null, link: "/", count: 2 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/tasks"
          ? new Response(JSON.stringify({ tasks }), { status: 200 })
          : new Response(
              JSON.stringify({
                display_name: "Erika Beispiel",
                email: "erika@example.com",
                roles: ["Evergreen.Team"],
                authenticated_at: "2026-11-14T08:00:00Z",
              }),
              { status: 200 },
            ),
      ),
    );
    render(<App />);
    const link = await screen.findByRole("link", { name: "Meine Aufgaben: 2 offen" });
    // Die Aufgabe ist erledigt; nach der Änderung verschwindet der Zähler.
    tasks = [];
    act(() => notifyTasksChanged());
    await vi.waitFor(() => expect(link).toHaveAttribute("aria-label", "Meine Aufgaben"));
  });

  it("zeigt bei Serverfehler einen Hinweis", async () => {
    mockFetch(500);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Werkbank nicht erreichbar" })).toBeVisible();
  });

  it("zeigt die Anmeldeseite mit Hinweis, sobald die Sitzung abgelaufen ist", async () => {
    mockFetch(200, {
      display_name: "Erika Beispiel",
      email: "erika@example.com",
      roles: ["Evergreen.Team"],
      authenticated_at: "2026-11-14T08:00:00Z",
    });
    render(<App />);
    await screen.findByRole("heading", { name: /Erika Beispiel$/ });
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: "abgemeldet" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Deine Sitzung ist abgelaufen.");
    expect(screen.getByRole("link", { name: "Mit Microsoft anmelden" })).toBeVisible();
  });
});
