import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
      roles: ["Evergreen.Reader"],
      authenticated_at: "2026-11-14T08:00:00Z",
    });
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: /^(Guten Morgen|Hallo|Guten Abend), Erika$/ }),
    ).toBeVisible();
    // Auf der Startseite zeigt die Navigation den Start-Bereich; die Neuerungen stehen unter M365.
    const bar = screen.getByRole("navigation", { name: "Bereiche" });
    expect(within(bar).getByRole("link", { name: "Microsoft 365" })).toHaveAttribute(
      "href",
      "/m365/neuerungen",
    );
    expect(within(bar).queryByRole("link", { name: "Evergreen" })).toBeNull();
    expect(within(bar).getByRole("link", { name: "Start" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Das Handbuch steht im Kontomenü, nicht in der Bereichsleiste
    expect(within(bar).queryByRole("link", { name: "Handbuch" })).toBeNull();
    expect(screen.getByRole("link", { name: "Meine Aufgaben" })).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: "Menü einklappen" }));
    expect(screen.queryByRole("navigation", { name: "Seiten: Start" })).toBeNull();
    expect(screen.getByRole("button", { name: "Menü ausklappen" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(window.localStorage.getItem("werkbank-navigation")).toBe("eingeklappt");
    fireEvent.click(screen.getByRole("button", { name: "Menü ausklappen" }));
    expect(screen.getByRole("navigation", { name: "Seiten: Start" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: /^Konto und Einstellungen: Erika Beispiel/ }),
    );
    const menu = screen.getByRole("menu", { name: "Konto" });
    expect(within(menu).getByRole("menuitem", { name: "Konto" })).toHaveAttribute("href", "/konto");
    expect(within(menu).getByRole("menuitem", { name: /^Release Notes/ })).toHaveAttribute(
      "href",
      "/neuigkeiten",
    );
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Dunkel" }));
    expect(document.documentElement.dataset.theme).toBe("dunkel");
    expect(screen.getAllByText("EB").length).toBeGreaterThan(0);
    expect(screen.getByText("Evergreen-Leser")).toBeInTheDocument();
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
                roles: ["Evergreen.Reader"],
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

    // Zurück in die App (z. B. am Handy): Die Zähler laden ebenfalls neu.
    tasks = [{ module: "Tenant", title: "Secrets", subtitle: null, link: "/", count: 1 }];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await vi.waitFor(() => expect(link).toHaveAttribute("aria-label", "Meine Aufgaben: 1 offen"));
  });

  it("zeigt in der Glocke die ungelesenen Benachrichtigungen", async () => {
    const me = {
      display_name: "Erika Beispiel",
      email: "erika@example.com",
      roles: ["Budget.Manager"],
      authenticated_at: "2026-11-14T08:00:00Z",
    };
    const list = {
      unread: 1,
      entries: [
        {
          id: 7,
          kind: "budget.rechnung_pruefen",
          module: "IT-Budget",
          title: "Rechnung R-1 von Beispiel GmbH prüfen",
          link: "/budget/rechnungen",
          created_at: "2026-11-14T08:00:00Z",
          read: false,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/api/notifications")
          ? new Response(JSON.stringify(list), { status: 200 })
          : url === "/api/tasks"
            ? new Response(JSON.stringify({ tasks: [] }), { status: 200 })
            : new Response(JSON.stringify(me), { status: 200 }),
      ),
    );
    render(<App />);
    const bell = await screen.findByRole("button", { name: "Benachrichtigungen: 1 ungelesen" });
    expect(bell).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
    // Dieselbe Meldung steht auch unter „Letzte Aktivitäten“ auf der Startseite.
    const popup = document.getElementById(bell.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(
      within(popup).getByRole("link", { name: /Rechnung R-1 von Beispiel GmbH prüfen/ }),
    ).toHaveAttribute("href", "/budget/rechnungen");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bell).toHaveAttribute("aria-expanded", "false");
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
      roles: ["Evergreen.Reader"],
      authenticated_at: "2026-11-14T08:00:00Z",
    });
    render(<App />);
    await screen.findByRole("heading", { name: /, Erika$/ });
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: "abgemeldet" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Deine Sitzung ist abgelaufen.");
    expect(screen.getByRole("link", { name: "Mit Microsoft anmelden" })).toBeVisible();
  });
});
