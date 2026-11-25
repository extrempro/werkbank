import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveBlockForm } from "./DokuNodes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Live-Baustein einfügen", () => {
  it("zeigt eine Vorschau, die beim Ändern neu lädt", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/optionen")) {
          return new Response(JSON.stringify({ areas: [], floors: [], kinds: [], projects: [] }));
        }
        const body = JSON.parse(String(init?.body)) as { q?: string };
        bodies.push(body);
        return new Response(
          JSON.stringify({
            kind: "tickets",
            allowed: true,
            title: "",
            rows: [
              {
                number: "T-1",
                title: body.q ? `Drucker ${body.q}` : "Drucker",
                status: "offen",
                who: "",
                href: "/tickets/1",
              },
            ],
            project: null,
          }),
        );
      }),
    );
    render(<LiveBlockForm initial={null} onSubmit={() => undefined} onCancel={() => undefined} />);
    expect(await screen.findByText("Drucker")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Stichwort im Betreff" }), {
      target: { value: "Toner" },
    });
    expect(await screen.findByText("Drucker Toner")).toBeTruthy();
    expect(bodies.at(-1)).toMatchObject({ kind: "tickets", q: "Toner" });
  });
});
