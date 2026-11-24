import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DokuBacklinks } from "./DokuBacklinks";
import { mentionQuery, mentionsIn } from "./DokuComments";
import { clearRefCache, RefChip } from "./DokuNodes";

afterEach(() => {
  cleanup();
  clearRefCache();
  vi.unstubAllGlobals();
});

function respond(map: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const key = Object.keys(map).find((part) => url.includes(part));
      return key
        ? new Response(JSON.stringify(map[key]), { status: 200 })
        : new Response("{}", { status: 404 });
    }),
  );
}

describe("Doku D3", () => {
  it("erkennt laufende Erwähnungen und behält nur Namen, die noch im Text stehen", () => {
    expect(mentionQuery("Frage an @ma")).toBe("ma");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("mail@example.com")).toBeNull();
    expect(mentionQuery("Hallo @Max Muster fertig")).toBeNull();
    const chosen = new Map([
      ["oid-1", "Max Muster"],
      ["oid-2", "Ina Beispiel"],
    ]);
    expect(mentionsIn("Danke @Max Muster!", chosen)).toEqual(["oid-1"]);
  });

  it("zeigt Verweise mit Stand und ohne Rechte nur „Kein Zugriff“", async () => {
    respond({
      "/api/doku/refs/resolve": [
        {
          kind: "ticket",
          id: "1042",
          allowed: true,
          found: true,
          title: "T-1042 · Drucker",
          status: "In Bearbeitung",
          detail: "Max Muster",
          href: "/tickets/1042",
        },
        {
          kind: "vertrag",
          id: "7",
          allowed: false,
          found: false,
          title: "",
          status: "",
          detail: "",
          href: "",
        },
      ],
    });
    render(
      <p>
        <RefChip kind="ticket" id="1042" /> <RefChip kind="vertrag" id="7" />
      </p>,
    );
    const link = await screen.findByRole("link", { name: /T-1042 · Drucker/ });
    expect(link).toHaveAttribute("href", "/tickets/1042");
    expect(screen.getByText("· In Bearbeitung")).toBeVisible();
    expect(await screen.findByText("Kein Zugriff")).toBeVisible();
    // Ein Abruf für alle Verweise der Seite
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("listet Seiten, die auf ein Objekt verweisen, und bleibt ohne Doku-Zugang leer", async () => {
    respond({
      "/api/doku/backlinks": [
        {
          id: "00000000-0000-0000-0000-000000000001",
          title: "Druckerumstellung",
          path: "IT › Projekte",
          updated_at: "2026-11-24T08:00:00Z",
          updated_by_name: "Ina Beispiel",
          snippet: "",
        },
      ],
    });
    render(<DokuBacklinks kind="projekt" id={3} />);
    expect(await screen.findByRole("link", { name: "Druckerumstellung" })).toHaveAttribute(
      "href",
      "/doku/seite/00000000-0000-0000-0000-000000000001",
    );
    cleanup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    const { container } = render(<DokuBacklinks kind="projekt" id={3} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
