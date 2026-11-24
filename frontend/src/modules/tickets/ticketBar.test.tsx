import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketBar } from "./TicketBar";
import { TicketBarSettings } from "./TicketBarSettings";
import { dotKind, resetTicketBar } from "./ticketBar";

interface Bar {
  limit: number;
  compact: boolean;
  favorites: { number: number; subject: string; status: string }[];
  recent: { number: number; subject: string; status: string }[];
}

function bar(extra: Partial<Bar> = {}): Bar {
  return {
    limit: 15,
    compact: true,
    favorites: [{ number: 1051, subject: "Neues Notebook", status: "new" }],
    recent: [
      { number: 1042, subject: "Drucker druckt nicht", status: "in_progress" },
      { number: 1038, subject: "VPN trennt ständig", status: "waiting" },
    ],
    ...extra,
  };
}

let calls: { method: string; url: string; body: unknown }[] = [];

function stub(answer: (method: string, url: string, body: unknown) => Bar) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      return new Response(JSON.stringify(answer(method, url, body)), { status: 200 });
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetTicketBar();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TicketBar", () => {
  it("zeigt Favoriten und Geöffnet kompakt mit Status für Screenreader und Legende", async () => {
    stub(() => bar());
    const navigate = vi.fn();
    render(<TicketBar activeNumber={1042} variant="side" onNavigate={navigate} />);
    const open = await screen.findByRole("list", { name: "Geöffnet" });
    const links = within(open).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "T-1042 · Drucker druckt nicht, In Arbeit",
      "T-1038 · VPN trennt ständig, Wartet auf Rückmeldung",
    ]);
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Favoriten · 1" })).toBeTruthy();
    expect(screen.getByText("In Arbeit", { selector: ".ticket-legend span" })).toBeTruthy();
    fireEvent.click(links[1]!);
    expect(navigate).toHaveBeenCalledWith(expect.anything(), "/tickets/1038");
  });

  it("schreibt den Status in der normalen Ansicht aus", async () => {
    stub(() => bar({ compact: false }));
    render(<TicketBar activeNumber={null} variant="sheet" onNavigate={vi.fn()} />);
    const open = await screen.findByRole("list", { name: "Geöffnet" });
    expect(within(open).getByText("In Arbeit")).toBeTruthy();
    expect(document.querySelector(".ticket-legend")).toBeNull();
  });

  it("Stern, X und „Liste leeren“ (mit Bestätigung) gehen an den Server", async () => {
    stub((method, url) => {
      if (method === "PUT" && url.endsWith("/1042/favorit")) {
        return bar({
          favorites: [...bar().favorites, bar().recent[0]!],
          recent: [bar().recent[1]!],
        });
      }
      if (method === "DELETE" && url.endsWith("/leiste")) {
        return bar({ recent: [] });
      }
      return bar();
    });
    render(<TicketBar activeNumber={null} variant="side" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "T-1042 als Favorit" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        url: "/api/tickets/leiste/1042/favorit",
        body: { favorite: true },
      }),
    );
    expect(await screen.findByRole("button", { name: "Favoriten · 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "T-1038 aus der Liste nehmen" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/1038"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Liste leeren" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Leeren" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/tickets/leiste")).toBe(
        true,
      ),
    );
  });

  it("klappt Gruppen zu und merkt es sich", async () => {
    stub(() => bar());
    const { unmount } = render(
      <TicketBar activeNumber={null} variant="side" onNavigate={vi.fn()} />,
    );
    const toggle = await screen.findByRole("button", { name: "Geöffnet · 2" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    unmount();
    render(<TicketBar activeNumber={null} variant="side" onNavigate={vi.fn()} />);
    expect(
      (await screen.findByRole("button", { name: "Geöffnet · 2" })).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("ordnet Status Punkten zu", () => {
    expect(dotKind("new")).toBe("neu");
    expect(dotKind("reminder")).toBe("wartet");
    expect(dotKind("closed")).toBe("erledigt");
    expect(dotKind("merged")).toBe("zusammen");
  });
});

describe("TicketBarSettings", () => {
  it("speichert Höchstzahl und Ansicht und meldet das Kürzen", async () => {
    stub((method, _url, body) =>
      method === "PUT"
        ? bar({
            limit: (body as { limit: number }).limit,
            compact: (body as { compact: boolean }).compact,
          })
        : bar({
            recent: Array.from({ length: 8 }, (_, i) => ({
              number: 1000 + i,
              subject: `Anliegen ${i}`,
              status: "new",
            })),
          }),
    );
    render(<TicketBarSettings />);
    const fifteen = await screen.findByRole("radio", { name: "15" });
    await waitFor(() => expect((fifteen as HTMLInputElement).checked).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "5" }));
    });
    expect(calls).toContainEqual({
      method: "PUT",
      url: "/api/tickets/leiste/einstellungen",
      body: { limit: 5, compact: true },
    });
    expect(await screen.findByText(/ältesten Tickets ohne Stern/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Normal" }));
    });
    expect(calls.at(-1)?.body).toEqual({ limit: 5, compact: false });
  });
});
