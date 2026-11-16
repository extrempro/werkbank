import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPage, searchUrl } from "./SearchPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const hits = [
  {
    module: "M365-Konfiguration",
    kind: "Einstellung",
    title: "MFA für alle: State",
    subtitle: "entra/conditionalaccesspolicy/p1/State",
    link: "/m365/einstellungen/3",
  },
  {
    module: "Evergreen",
    kind: "Vorgang",
    title: "MFA-Abfrage in Teams",
    subtitle: "EV-2026-014 · Betriebsrat",
    link: "/evergreen/14",
  },
];

function stubFetch(result: unknown[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ query: "MFA", hits: result }), { status: 200 });
    }),
  );
  return urls;
}

describe("SearchPage", () => {
  it("zeigt mit der Rolle für IT-Tools auch passende Tools, ohne sie nicht", async () => {
    window.history.replaceState(null, "", searchUrl("subnetz"));
    stubFetch([]);
    const { unmount } = render(<SearchPage roles={["Tools.User"]} />);
    expect(await screen.findByRole("link", { name: "Subnetz-Rechner" })).toHaveAttribute(
      "href",
      "/it-tools/subnetz",
    );
    expect(screen.getAllByText("Tool · Netzwerk").length).toBeGreaterThan(0);
    unmount();
    render(<SearchPage roles={["Config.Reader"]} />);
    expect(await screen.findByText("Keine Treffer für „subnetz“.")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Subnetz-Rechner" })).toBeNull();
  });

  it("zeigt Tools auch, wenn die Suche in den Modulen fehlschlägt", async () => {
    window.history.replaceState(null, "", searchUrl("dns"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    render(<SearchPage roles={["Tools.User"]} />);
    expect(await screen.findByRole("link", { name: "DNS Lookup" })).toHaveAttribute(
      "href",
      "/it-tools/dns-lookup",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("IT-Tools stehen trotzdem da");
  });

  it("sucht nach dem Begriff aus der Adresse und zeigt Treffer mit Modul", async () => {
    window.history.replaceState(null, "", searchUrl("MFA"));
    const urls = stubFetch(hits);
    render(<SearchPage />);
    expect(screen.getByLabelText("Suchbegriff")).toHaveValue("MFA");
    expect(await screen.findByRole("link", { name: "MFA für alle: State" })).toHaveAttribute(
      "href",
      "/m365/einstellungen/3",
    );
    expect(screen.getByRole("link", { name: "MFA-Abfrage in Teams" })).toHaveAttribute(
      "href",
      "/evergreen/14",
    );
    expect(screen.getByText("2 Treffer für „MFA“")).toBeVisible();
    expect(screen.getByText("Vorgang · EV-2026-014 · Betriebsrat")).toBeVisible();
    expect(urls[0]).toBe("/api/search?q=MFA");
  });

  it("sagt, wenn es keine Treffer gibt", async () => {
    window.history.replaceState(null, "", searchUrl("Zeppelin"));
    stubFetch([]);
    render(<SearchPage />);
    expect(await screen.findByText(/Keine Treffer für/)).toBeVisible();
  });

  it("sucht erst ab zwei Zeichen und übernimmt den Begriff in die Adresse", async () => {
    const urls = stubFetch(hits);
    render(<SearchPage />);
    fireEvent.change(screen.getByLabelText("Suchbegriff"), { target: { value: "M" } });
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }));
    expect(urls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Suchbegriff"), { target: { value: "MFA für" } });
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }));
    await waitFor(() => expect(urls).toHaveLength(1));
    expect(window.location.search).toBe("?q=MFA+f%C3%BCr");
  });
});
