import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { areasFor } from "../../navigation";
import { recordVisit, resetNavPrefs, togglePin } from "../../navPrefs";
import { AccountMenu } from "./AccountMenu";
import { menuGroups } from "./menuGroups";
import { MobileNav } from "./MobileNav";
import { QuickSearch } from "./QuickSearch";
import { GROUPS_KEY, SideMenu } from "./SideMenu";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  resetNavPrefs();
});

/** Antwortet auf PUT/POST/DELETE mit dem gesendeten Stand, wie der Server. */
function stubServer(status = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init?.method ?? "GET", url, body });
      if (status !== 200) {
        return new Response("{}", { status });
      }
      const paths = (body as { paths?: string[] } | null)?.paths ?? [];
      return new Response(JSON.stringify({ pinned: paths, recent: [] }), { status: 200 });
    }),
  );
  return calls;
}

const me: Me = {
  display_name: "Erika Beispiel",
  email: null,
  roles: ["Budget.Manager"],
  authenticated_at: "2026-11-20T08:00:00Z",
};

describe("menuGroups", () => {
  it("setzt im Start-Bereich Angeheftet und Zuletzt besucht zwischen Start und Suche", () => {
    const areas = areasFor(["Budget.Reader"]);
    const start = areas[0]!;
    const groups = menuGroups(start, areas, {
      pinned: ["/budget/rechnungen", "/budget/import"],
      recent: ["/budget", "/budget/konten", "/suche", "/budget/partner", "/budget/posten", "/"],
    });
    expect(groups.map((group) => group.title)).toEqual([
      null,
      "Angeheftet",
      "Zuletzt besucht",
      null,
    ]);
    // Ohne Recht (Import nur für den Budgetverwalter) fällt die Seite weg.
    expect(groups[1]!.entries.map((entry) => entry.item.path)).toEqual(["/budget/rechnungen"]);
    expect(groups[2]!.entries).toHaveLength(5);
  });

  it("lässt andere Bereiche unverändert", () => {
    const areas = areasFor(["Budget.Manager"]);
    const budget = areas.find((area) => area.id === "budget")!;
    const groups = menuGroups(budget, areas, { pinned: ["/budget"], recent: [] });
    expect(groups.map((group) => [group.title, group.collapsed])).toEqual([
      ["Überblick", false],
      ["Ausgaben", false],
      ["Stammdaten", false],
      ["Verwaltung", true],
    ]);
  });
});

describe("SideMenu", () => {
  const areas = areasFor(["Budget.Manager"]);
  const budget = areas.find((area) => area.id === "budget")!;

  function renderMenu(activePath = "/budget") {
    return render(
      <SideMenu
        id="menu"
        area={budget}
        areas={areas}
        activePath={activePath}
        hidden={false}
        badgeFor={(path) => (path === "/budget/rechnungen" ? 2 : 0)}
        onNavigate={(event) => event.preventDefault()}
        onCollapse={() => undefined}
      />,
    );
  }

  it("klappt Gruppen auf und zu und merkt sich das im Browser", () => {
    renderMenu();
    const nav = screen.getByRole("navigation", { name: "Seiten: IT-Budget" });
    const admin = within(nav).getByRole("button", { name: "Verwaltung" });
    expect(admin).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("link", { name: "Import" })).toBeNull();
    fireEvent.click(admin);
    expect(admin).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: "Import" })).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? "{}")).toEqual({
      "budget/Verwaltung": true,
    });
    fireEvent.click(within(nav).getByRole("button", { name: "Überblick" }));
    expect(within(nav).queryByRole("link", { name: "Statistik" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Rechnungen 2 offen" })).toBeVisible();
  });

  it("hält die Gruppe der geöffneten Seite offen", () => {
    renderMenu("/budget/import");
    const link = screen.getByRole("link", { name: "Import" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Verwaltung" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("heftet mit dem Stern an und speichert auf dem Server", async () => {
    const calls = stubServer();
    renderMenu();
    const star = screen.getByRole("button", { name: "Partner anheften" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await act(async () => fireEvent.click(star));
    expect(star).toHaveAttribute("aria-pressed", "true");
    expect(calls).toEqual([
      { method: "PUT", url: "/api/navigation/pins", body: { paths: ["/budget/partner"] } },
    ]);
  });
});

describe("navPrefs", () => {
  it("nimmt das Anheften zurück, wenn der Server ablehnt", async () => {
    stubServer(422);
    await act(() => togglePin("/budget"));
    const areas = areasFor(["Budget.Reader"]);
    expect(menuGroups(areas[0]!, areas, { pinned: [], recent: [] })[1]!.entries).toEqual([]);
    render(
      <SideMenu
        id="menu"
        area={areas[0]!}
        areas={areas}
        activePath="/"
        hidden={false}
        badgeFor={() => 0}
        onNavigate={(event) => event.preventDefault()}
        onCollapse={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Das hat nicht geklappt");
    expect(screen.getByText(/Noch nichts angeheftet/)).toBeVisible();
  });

  it("merkt Besuche ohne die Aufgaben neu zu laden", async () => {
    const calls = stubServer();
    const reload = vi.fn();
    window.addEventListener("werkbank:aufgaben-geaendert", reload);
    await act(() => recordVisit("/budget"));
    window.removeEventListener("werkbank:aufgaben-geaendert", reload);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/navigation/recent" });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("QuickSearch", () => {
  const areas = areasFor(["Budget.Reader", "Evergreen.Editor"]);

  it("findet Seiten, Enter öffnet den markierten Treffer", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<QuickSearch areas={areas} onClose={onClose} onNavigate={onNavigate} />);
    const dialog = screen.getByRole("dialog", { name: "Schnellsuche" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const field = screen.getByRole("combobox", { name: "Seite suchen" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "ausgaben" } });
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "BudgetpostenAusgaben · IT-Budget",
      "RechnungenAusgaben · IT-Budget",
      "VerträgeAusgaben · IT-Budget",
    ]);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(field).toHaveAttribute("aria-activedescendant", options[1]!.id);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    vi.runAllTimers();
    expect(onNavigate).toHaveBeenCalledWith("/budget/rechnungen");
    vi.useRealTimers();
  });

  it("zeigt ohne Eingabe die zuletzt besuchten Seiten und verlinkt die volle Suche", () => {
    resetNavPrefs({ pinned: [], recent: ["/m365/neuerungen", "/budget/import"] });
    render(<QuickSearch areas={areas} onClose={() => undefined} onNavigate={() => undefined} />);
    expect(screen.getByText("Zuletzt besucht")).toBeVisible();
    expect(screen.getAllByRole("option").map((option) => option.id)).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "teams" } });
    expect(screen.getByText("Keine Seite gefunden.")).toBeVisible();
    expect(screen.getByRole("link", { name: /In allen Einträgen suchen/ })).toHaveAttribute(
      "href",
      "/suche?q=teams",
    );
  });

  it("schließt mit Esc", () => {
    const onClose = vi.fn();
    render(<QuickSearch areas={areas} onClose={onClose} onNavigate={() => undefined} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AccountMenu", () => {
  it("lässt sich mit der Tastatur bedienen und gibt den Fokus zurück", () => {
    render(<AccountMenu me={me} newsUnseen onNavigate={() => undefined} />);
    const button = screen.getByRole("button", {
      name: "Konto und Einstellungen: Erika Beispiel, neue Version",
    });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "Konto" });
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(within(menu).getByRole("menuitem", { name: "Abmelden" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(within(menu).getByRole("menuitem", { name: "Konto" })).toHaveFocus();
    expect(within(menu).getByRole("menuitem", { name: /Release Notes/ })).toHaveTextContent("neu");
    expect(within(menu).getByRole("menuitem", { name: "Abmelden" })).toHaveAttribute(
      "form",
      "abmelden",
    );
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("führt zum Handbuch, Admins auch zur Verwaltung", () => {
    const paths: string[] = [];
    const { unmount } = render(
      <AccountMenu me={me} newsUnseen={false} onNavigate={(path) => paths.push(path)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Konto und Einstellungen/ }));
    expect(screen.queryByRole("menuitem", { name: "Verwaltung" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Handbuch" }));
    expect(paths).toEqual(["/handbuch"]);
    unmount();
    render(
      <AccountMenu
        me={{ ...me, roles: ["Werkbank.Admin"] }}
        newsUnseen={false}
        onNavigate={(path) => paths.push(path)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Konto und Einstellungen/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Verwaltung" }));
    expect(paths).toEqual(["/handbuch", "/verwaltung"]);
  });

  it("schaltet die Darstellung um", () => {
    render(<AccountMenu me={me} newsUnseen={false} onNavigate={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /^Konto und Einstellungen/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dunkel" }));
    expect(document.documentElement.dataset.theme).toBe("dunkel");
    expect(screen.getByRole("menuitemradio", { name: "Dunkel" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Automatisch" }));
    expect(window.localStorage.getItem("werkbank-darstellung")).toBeNull();
    delete document.documentElement.dataset.theme;
  });
});

describe("MobileNav", () => {
  it("zeigt im Blatt erst den Bereich, dann alle Bereiche", () => {
    resetNavPrefs({ pinned: ["/budget/rechnungen"], recent: [] });
    const areas = areasFor(["Budget.Reader", "Evergreen.Reader"]);
    const budget = areas.find((area) => area.id === "budget")!;
    render(
      <MobileNav
        areas={areas}
        current={budget}
        activePath="/budget"
        taskCount={3}
        searchOpen={false}
        hasOpen={(area) => area.id === "m365"}
        badgeFor={() => 0}
        onNavigate={() => undefined}
        onSearch={() => undefined}
        onTasks={() => undefined}
      />,
    );
    const bar = screen.getByRole("navigation", { name: "Schnellzugriff" });
    expect(within(bar).getByRole("link", { name: "Aufgaben 3 offen" })).toBeVisible();
    fireEvent.click(within(bar).getByRole("button", { name: "Menü" }));
    const sheet = screen.getByRole("dialog", { name: "IT-Budget" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    // Keine Sterne zum Anklicken, angeheftete Seiten nur markiert
    expect(within(sheet).queryByRole("button", { name: /anheften/ })).toBeNull();
    expect(within(sheet).getByRole("link", { name: "Rechnungen angeheftet" })).toBeVisible();
    fireEvent.click(within(sheet).getByRole("button", { name: "Alle Bereiche" }));
    const all = screen.getByRole("dialog", { name: "Alle Bereiche" });
    expect(
      within(all).getByRole("button", { name: /^Microsoft 365.*offene Aufgaben/ }),
    ).toBeVisible();
    // Handbuch und Verwaltung stehen im Kontomenü
    expect(within(all).queryByRole("link", { name: "Handbuch" })).toBeNull();
    fireEvent.click(within(all).getByRole("button", { name: /^Microsoft 365/ }));
    expect(screen.getByRole("dialog", { name: "Microsoft 365" })).toBeVisible();
  });

  it("zeigt Admins die Verwaltung nicht in der Liste der Bereiche", () => {
    const areas = areasFor(["Werkbank.Admin", "Budget.Reader"]);
    render(
      <MobileNav
        areas={areas}
        current={undefined}
        activePath="/"
        taskCount={0}
        searchOpen={false}
        hasOpen={() => false}
        badgeFor={() => 0}
        onNavigate={() => undefined}
        onSearch={() => undefined}
        onTasks={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menü" }));
    const all = screen.getByRole("dialog", { name: "Alle Bereiche" });
    expect(within(all).getByRole("button", { name: /^IT-Budget/ })).toBeVisible();
    expect(within(all).queryByRole("button", { name: /^Verwaltung/ })).toBeNull();
  });
});
