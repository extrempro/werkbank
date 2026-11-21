import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api";
import { AccountPage } from "./AccountPage";
import { confirmDialog } from "../test/confirm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const me: Me = {
  user_id: "11111111-1111-1111-1111-111111111111",
  display_name: "Erika Beispiel",
  email: "erika@example.com",
  roles: ["Config.Reviewer", "Evergreen.Editor"],
  authenticated_at: "2026-11-14T08:00:00Z",
  session_expires_at: "2026-11-14T16:00:00Z",
  avatar_url: null,
  version: "0.3.0",
};

const sessions = [
  {
    id: "a",
    device: "Edge unter Windows",
    authenticated_at: "2026-11-14T08:00:00Z",
    last_seen_at: "2026-11-14T09:00:00Z",
    expires_at: "2026-11-14T16:00:00Z",
    current: true,
  },
  {
    id: "b",
    device: "Safari auf dem iPhone",
    authenticated_at: "2026-11-13T07:00:00Z",
    last_seen_at: "2026-11-14T07:30:00Z",
    expires_at: "2026-11-13T15:00:00Z",
    current: false,
  },
  {
    id: "c",
    device: "Chrome unter Android",
    authenticated_at: "2026-11-12T07:00:00Z",
    last_seen_at: "2026-11-14T07:00:00Z",
    expires_at: "2026-11-12T15:00:00Z",
    current: false,
  },
];

function stubSessions() {
  const calls: { url: string; method: string }[] = [];
  let list = [...sessions];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url === "/api/account/sessions/logout-others") {
        const ended = list.filter((entry) => !entry.current).length;
        list = list.filter((entry) => entry.current);
        return new Response(JSON.stringify({ ended }));
      }
      if (method === "DELETE" && url.startsWith("/api/account/sessions/")) {
        const id = url.split("/").at(-1);
        list = list.filter((entry) => entry.id !== id);
        return new Response(JSON.stringify({ ended: 1 }));
      }
      if (url === "/api/account/sessions") {
        return new Response(JSON.stringify(list));
      }
      return new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

describe("AccountPage", () => {
  it("zeigt Angaben, Rollen mit Beschreibung, angemeldete Geräte und Version", async () => {
    stubSessions();
    render(<AccountPage me={me} />);
    expect(screen.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible();
    expect(screen.getByText("erika@example.com")).toBeVisible();
    expect(screen.getByText("EB")).toBeInTheDocument();
    expect(screen.getByText("Konfiguration Prüfer")).toBeVisible();
    expect(screen.getByText("Evergreen.Editor")).toBeVisible();
    expect(await screen.findByText("Edge unter Windows")).toBeVisible();
    expect(screen.getByText("Dieses Gerät")).toBeVisible();
    expect(screen.getByText(/läuft spätestens .* ab/)).toBeVisible();
    expect(screen.getByText("0.3.0")).toBeVisible();
    expect(screen.getByRole("link", { name: "Neuigkeiten ansehen" })).toHaveAttribute(
      "href",
      "/neuigkeiten",
    );
    // Dieses Gerät meldet das Formular ab
    const logout = screen.getByRole("button", { name: "Abmelden" });
    expect(logout).toHaveAttribute("form", "konto-abmelden");
    expect(document.getElementById("konto-abmelden")).toHaveAttribute("action", "/auth/logout");
  });

  it("meldet ein anderes Gerät und dann alle anderen ab", async () => {
    const calls = stubSessions();
    render(<AccountPage me={me} />);
    const list = await screen.findByRole("list", { name: "Angemeldete Geräte" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /^Abmelden.*Safari auf dem iPhone$/ }));
    await confirmDialog("Abmelden");
    expect(await screen.findByText("Safari auf dem iPhone ist abgemeldet.")).toBeVisible();
    expect(
      calls.some((call) => call.method === "DELETE" && call.url === "/api/account/sessions/b"),
    ).toBe(true);
    expect(await screen.findByText("2 Geräte")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Auf allen anderen Geräten abmelden" }));
    await confirmDialog("Abmelden");
    expect(await screen.findByText("1 anderes Gerät ist abgemeldet.")).toBeVisible();
    expect(await screen.findByText("1 Gerät")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Auf allen anderen Geräten abmelden" })).toBeNull();
  });

  it("zeigt das Profilbild und fällt bei einem Fehler auf die Initialen zurück", () => {
    stubSessions();
    const url = "/api/users/11111111-1111-1111-1111-111111111111/avatar?v=abc";
    const { container } = render(<AccountPage me={{ ...me, avatar_url: url }} />);
    const image = container.querySelector("img.avatar");
    expect(image).toHaveAttribute("src", url);
    expect(screen.queryByText("EB")).toBeNull();
    fireEvent.error(image as Element);
    expect(screen.getByText("EB")).toBeInTheDocument();
  });

  it("stellt die Darstellung um", () => {
    stubSessions();
    render(<AccountPage me={me} />);
    fireEvent.click(screen.getByRole("radio", { name: "Dunkel" }));
    expect(document.documentElement.dataset.theme).toBe("dunkel");
  });
});
