import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AchievementPeek } from "./AchievementPeek";
import { AchievementsPage } from "./AchievementsPage";
import { AchievementToast, TOAST_MS } from "./AchievementToast";
import type { Achievements } from "./api";
import { cssObject, drawBadge, levelName, splitLevel, STYLES } from "./badges";

function data(extra: Partial<Achievements> = {}): Achievements {
  return {
    enabled: true,
    audience: "me",
    toast: true,
    style: "wappen",
    showcase: [],
    categories: [
      { id: "chronist", name: "Chronist", count: 14, level: 4, current_at: 10, next_at: 15 },
      { id: "quelle", name: "Wissensquelle", count: 0, level: 0, current_at: 0, next_at: 1 },
      { id: "staffel", name: "Staffelläufer", count: 3, level: 3, current_at: 3, next_at: 4 },
      { id: "ordnung", name: "Ordnungshüter", count: 1, level: 1, current_at: 1, next_at: 2 },
      { id: "atem", name: "Langer Atem", count: 0, level: 0, current_at: 0, next_at: 1 },
      { id: "bruecke", name: "Brückenbauer", count: 0, level: 0, current_at: 0, next_at: 1 },
    ],
    allrounder: 1,
    wreaths: [3, 0, 0, 0, 0, 0],
    total: 8,
    new: [],
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Abzeichen", () => {
  it("zeichnet jede Stufe in jedem Stil, mit Namen", () => {
    for (const style of STYLES) {
      for (let level = 1; level <= 30; level++) {
        const badge = drawBadge(style, level, 64, "✒");
        expect(badge.layers.length).toBeGreaterThanOrEqual(2);
        expect(badge.wrap).toContain("width: 64px");
      }
    }
    expect(splitLevel(13)).toEqual({ rank: 2, sub: 3 });
    expect(levelName("wappen", 13)).toBe("Gold III");
    expect(levelName("neon", 30)).toBe("Supernova V");
    expect(levelName("fantasy", 1)).toBe("Lehrling I");
    // Gesperrt: grau
    expect(drawBadge("pixel", 0, 40, "✒").wrap).toContain("grayscale(1)");
  });

  it("wandelt CSS-Text in ein Style-Objekt", () => {
    expect(cssObject("top: 4px; -webkit-mask: none; clip-path: polygon(0 0, 1% 2%)")).toEqual({
      top: "4px",
      WebkitMask: "none",
      clipPath: "polygon(0 0, 1% 2%)",
    });
  });
});

describe("AchievementsPage", () => {
  it("ist anfangs aus und lässt sich einschalten", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          sent.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify(data()), { status: 200 });
        }
        return new Response(JSON.stringify(data({ enabled: false, total: 0 })), { status: 200 });
      }),
    );
    render(<AchievementsPage />);
    const box = await screen.findByRole("checkbox", { name: "Erfolge sammeln" });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/Gesamtstufe/)).toBeNull();
    fireEvent.click(box);
    await screen.findByRole("heading", { name: "Gesamtstufe 8" });
    expect(sent).toEqual([{ enabled: true, audience: "me", toast: true, style: "wappen" }]);
    // Kategorien mit Stufe im gewählten Stil
    const card = screen.getByRole("heading", { name: "Chronist" }).closest("li")!;
    expect(within(card).getByText("Holz IV · 4/30")).toBeTruthy();
    expect(within(card).getByText("14 · noch 1 bis Holz V")).toBeTruthy();
  });

  it("stellt Erfolge in die Vitrine und fragt vor dem Ausschalten", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { ids?: string[]; enabled?: boolean };
          calls.push({ url, body });
          return new Response(
            JSON.stringify(
              body.ids
                ? data({ showcase: body.ids as Achievements["showcase"] })
                : data({ enabled: false }),
            ),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(data()), { status: 200 });
      }),
    );
    render(<AchievementsPage />);
    const card = (await screen.findByRole("heading", { name: "Chronist" })).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "In die Vitrine" }));
    await waitFor(() =>
      expect(calls[0]).toEqual({
        url: "/api/tickets/erfolge/vitrine",
        body: { ids: ["chronist"] },
      }),
    );
    // Nicht erreichte Erfolge lassen sich nicht anheften
    const empty = screen.getByRole("heading", { name: "Wissensquelle" }).closest("li")!;
    expect(within(empty).queryByRole("button", { name: "In die Vitrine" })).toBeNull();
    // Alle 30 Stufen aufklappen
    fireEvent.click(within(card).getByRole("button", { name: "Alle 30 Stufen" }));
    expect(within(card).getAllByRole("listitem")).toHaveLength(30);
    // Ausschalten nur nach Bestätigung
    fireEvent.click(screen.getByRole("checkbox", { name: "Erfolge sammeln" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Erfolge ausschalten?" });
    expect(calls).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ausschalten" }));
    await waitFor(() => expect(calls[1]?.body).toMatchObject({ enabled: false }));
  });
});

describe("AchievementToast", () => {
  it("blendet eine neue Stufe nach einer Änderung ein und meldet sie als gesehen", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify(data({ new: [{ id: "chronist", name: "Chronist", level: 5 }] })),
          { status: 200 },
        );
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = render(<AchievementToast trigger="a" />);
    // Beim ersten Anzeigen nichts
    expect(urls).toEqual([]);
    rerender(<AchievementToast trigger="b" />);
    expect(await screen.findByText("Chronist · Holz V")).toBeTruthy();
    await waitFor(() => expect(urls).toContain("/api/tickets/erfolge/gesehen"));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.queryByText("Chronist · Holz V")).toBeNull();
  });
});

describe("AchievementPeek", () => {
  it("zeigt die Vitrine einer anderen Person im eigenen Stil, sonst einen Hinweis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/personen/")) {
          return url.includes("olga")
            ? new Response(
                JSON.stringify({
                  total: 12,
                  showcase: [{ id: "staffel", name: "Staffelläufer", level: 13 }],
                }),
                { status: 200 },
              )
            : new Response(JSON.stringify({ detail: "Nicht gefunden." }), { status: 404 });
        }
        return new Response(JSON.stringify(data({ style: "neon" })), { status: 200 });
      }),
    );
    render(<AchievementPeek oid="test:olga" name="Olga" />);
    fireEvent.click(screen.getByRole("button", { name: "Erfolge von Olga" }));
    expect(await screen.findByText("Staffelläufer · Puls III")).toBeTruthy();
    expect(screen.getByText("Gesamtstufe 12")).toBeTruthy();
    cleanup();
    render(<AchievementPeek oid="test:max" name="Max" />);
    fireEvent.click(screen.getByRole("button", { name: "Erfolge von Max" }));
    expect(await screen.findByText("Max zeigt keine Erfolge.")).toBeTruthy();
  });
});
