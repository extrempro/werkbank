import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  budgetShares,
  filterProjects,
  initials,
  isHttpsUrl,
  parseProjectPath,
  periodText,
  projectPath,
  type Project,
  type ProjectSummary,
} from "./api";
import { applyFormat, parseInline, parseMarkdown, plainExcerpt } from "./markdown";
import { Markdown } from "./Markdown";
import { ProjectPage } from "./ProjectPage";
import { ProjectsPage } from "./ProjectsPage";
import { moved } from "./ProjectSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      // Längster passender Eintrag gewinnt, damit „/api/projects/3“ nicht „/api/projects“ trifft.
      const key = Object.keys(routes)
        .filter(
          (route) => `${method} ${url}` === route || `${method} ${url}`.startsWith(`${route}?`),
        )
        .sort((left, right) => right.length - left.length)[0];
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

const sums = {
  budget_cents: 1_000_000,
  planned_cents: 300_000,
  actual_cents: 200_000,
  remaining_cents: 500_000,
  items: 2,
};

const summary: ProjectSummary = {
  id: 3,
  name: "WLAN-Erneuerung",
  description: "Neue Access Points",
  status: "aktiv",
  starts_on: "2026-01-01",
  ends_on: null,
  budget: sums,
  open_tasks: 2,
  last_meeting_on: "2026-03-05",
};

const project: Project = {
  id: 3,
  name: "WLAN-Erneuerung",
  description: "Neue Access Points",
  status: "aktiv",
  starts_on: "2026-01-01",
  ends_on: "2026-12-31",
  budget_approved_on: null,
  budget_note: "",
  budget: sums,
  people: [
    {
      name: "Erika Beispiel",
      role: "Projektleitung",
      kind: "intern",
      organisation: "",
      contact: "",
    },
    {
      name: "Jana Muster",
      role: "Technik",
      kind: "extern",
      organisation: "Beispiel GmbH",
      contact: "jana@example.com",
    },
  ],
  links: [{ label: "Ablage", url: "https://ablage.example.com/projekt" }],
  open_tasks: 1,
  tasks: [
    {
      id: 1,
      text: "Angebote vergleichen",
      owner: "Erika",
      due_on: "2026-03-01",
      done: false,
      done_at: null,
    },
  ],
  last_meeting: {
    id: 9,
    held_on: "2026-03-05",
    title: "Jour Fixe",
    body: "## Stand\n- Ausleuchtung fertig",
    files: [{ id: 1, name: "Protokoll.pdf", size: 2048 }],
    created_at: "2026-03-05T10:00:00Z",
    updated_at: "2026-03-05T10:00:00Z",
  },
  year_label: "Geschäftsjahr",
};

describe("Pfade und Hilfen", () => {
  it("liest Projekt und Reiter aus dem Pfad", () => {
    expect(parseProjectPath("/projekte/12")).toEqual({ id: 12, tab: "uebersicht" });
    expect(parseProjectPath("/projekte/12/jour-fixe")).toEqual({ id: 12, tab: "jour-fixe" });
    expect(parseProjectPath("/projekte/12/unbekannt")).toBeNull();
    expect(parseProjectPath("/projekte")).toBeNull();
    expect(projectPath(12)).toBe("/projekte/12");
    expect(projectPath(12, "budget")).toBe("/projekte/12/budget");
  });

  it("lässt nur https-Links zu", () => {
    expect(isHttpsUrl("https://ablage.example.com/a")).toBe(true);
    for (const bad of [
      "http://example.com",
      "javascript:alert(1)",
      "https://nutzer:pw@example.com",
      "https://example.com/ a",
      "ablage",
    ]) {
      expect(isHttpsUrl(bad)).toBe(false);
    }
  });

  it("rechnet die Anteile für den Balken und schreibt Laufzeit und Initialen", () => {
    expect(budgetShares(sums)).toEqual({ actual: 20, planned: 30 });
    // Über dem Budget zählt die Summe als Ganzes.
    expect(budgetShares({ ...sums, budget_cents: 250_000 })).toEqual({ actual: 40, planned: 60 });
    expect(budgetShares({ ...sums, budget_cents: null })).toBeNull();
    expect(periodText("2026-01-01", "2026-12-31")).toBe("01.01.2026 – 31.12.2026");
    expect(periodText("2026-01-01", null)).toBe("ab 01.01.2026");
    expect(periodText(null, null)).toBe("");
    expect(initials("Erika Beispiel")).toBe("EB");
    expect(initials("  jana  ")).toBe("J");
  });

  it("filtert Projekte nach Status und Suchtext", () => {
    const done = {
      ...summary,
      id: 4,
      name: "Archiv",
      description: "",
      status: "abgeschlossen" as const,
    };
    expect(filterProjects([summary, done], "offen", "").map((entry) => entry.id)).toEqual([3]);
    expect(filterProjects([summary, done], "alle", "access").map((entry) => entry.id)).toEqual([3]);
    expect(filterProjects([summary, done], "abgeschlossen", "").map((entry) => entry.id)).toEqual([
      4,
    ]);
  });

  it("verschiebt Einträge in der Liste", () => {
    expect(moved(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("Markdown", () => {
  it("zerlegt Blöcke, Listen und Checklisten", () => {
    const blocks = parseMarkdown(
      "# Titel\n\nErste Zeile\nzweite Zeile\n- [ ] offen\n- [x] erledigt\n1. eins\n2. zwei\n> Zitat\n---",
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "rule",
    ]);
    const checks = blocks[2];
    expect(checks?.kind === "list" && checks.items.map((item) => item.checked)).toEqual([
      false,
      true,
    ]);
    const numbered = blocks[3];
    expect(numbered?.kind === "list" && numbered.ordered).toBe(true);
  });

  it("erkennt fett, kursiv, Code und nur https-Links", () => {
    expect(parseInline("a **b** *c* `d`").map((part) => part.kind)).toEqual([
      "text",
      "strong",
      "text",
      "em",
      "text",
      "code",
    ]);
    expect(parseInline("[Ablage](https://ablage.example.com)")[0]).toMatchObject({
      kind: "link",
      href: "https://ablage.example.com/",
    });
    // Andere Adressen bleiben Text.
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[x](javascript:alert(1))" },
    ]);
    expect(plainExcerpt("## Stand\n- **eins**\n- zwei\n\nmehr\nnoch mehr", 3)).toEqual([
      "Stand",
      "eins",
      "zwei",
    ]);
  });

  it("stellt alles als Text dar, nie als HTML", () => {
    const { container } = render(
      <Markdown source={'<img src=x onerror="alert(1)"> **fett** [Link](https://example.com)'} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeVisible();
    expect(screen.getByText("fett").closest("strong")).not.toBeNull();
    const link = screen.getByRole("link", { name: /Link/ });
    expect(link).toHaveAttribute("href", "https://example.com/");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("setzt die Zeichen der Leiste um die Auswahl", () => {
    expect(applyFormat("Hallo Welt", 6, 10, "bold")).toEqual({
      value: "Hallo **Welt**",
      start: 8,
      end: 12,
    });
    expect(applyFormat("eins\nzwei", 0, 9, "check").value).toBe("- [ ] eins\n- [ ] zwei");
    expect(applyFormat("eins\nzwei", 2, 7, "numbered").value).toBe("1. eins\n2. zwei");
    const link = applyFormat("Ablage", 0, 6, "link");
    expect(link.value).toBe("[Ablage](https://)");
    expect(link.value.slice(link.start, link.end)).toBe("https://");
  });
});

describe("Seiten", () => {
  it("zeigt die Projektliste und Bearbeitenden den Knopf für neue Projekte", async () => {
    stubFetch({ "GET /api/projects": [summary] });
    render(<ProjectsPage roles={["Projekte.Editor"]} />);
    const table = within(await screen.findByRole("region", { name: "Projektliste" }));
    expect(table.getByRole("link", { name: "WLAN-Erneuerung" })).toHaveAttribute(
      "href",
      "/projekte/3",
    );
    expect(screen.getByRole("button", { name: "Neues Projekt" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Neues Projekt" }));
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name: Trag einen Namen ein.");
  });

  it("zeigt Lesenden keinen Knopf für neue Projekte", async () => {
    stubFetch({ "GET /api/projects": [] });
    render(<ProjectsPage roles={["Projekte.Reader"]} />);
    expect(await screen.findByText(/Es gibt noch kein Projekt/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Neues Projekt" })).toBeNull();
  });

  it("zeigt die Übersicht mit Budget, offenen Punkten, Personen und Links", async () => {
    stubFetch({ "GET /api/projects/3": project });
    render(<ProjectPage projectId={3} tab="uebersicht" roles={["Projekte.Reader"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "WLAN-Erneuerung" })).toBeVisible();
    expect(screen.getByText("Angebote vergleichen")).toBeVisible();
    expect(screen.getByText("Jana Muster")).toBeVisible();
    expect(screen.getByRole("link", { name: /Ablage/ })).toHaveAttribute(
      "href",
      "https://ablage.example.com/projekt",
    );
    expect(screen.getByText("Ausleuchtung fertig")).toBeVisible();
    // Ohne Bearbeitungsrecht gibt es keinen Reiter Einstellungen.
    const tabs = within(screen.getByRole("navigation", { name: "Bereiche des Projekts" }));
    expect(tabs.queryByRole("link", { name: "Einstellungen" })).toBeNull();
    expect(tabs.getByRole("link", { name: "Übersicht" })).toHaveAttribute("aria-current", "page");
  });

  it("prüft die Einstellungen vor dem Speichern und speichert Personen und Links", async () => {
    const calls = stubFetch({
      "GET /api/projects/3": project,
      "PUT /api/projects/3": project,
    });
    render(<ProjectPage projectId={3} tab="einstellungen" roles={["Projekte.Editor"]} />);
    await screen.findByRole("heading", { name: "Allgemein" });
    fireEvent.change(screen.getByLabelText("Adresse"), { target: { value: "http://ablage" } });
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("https://");
    fireEvent.change(screen.getByLabelText("Adresse"), {
      target: { value: "https://ablage.example.com/neu" },
    });
    fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: "12.000,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    expect(await screen.findByText("Die Einstellungen sind gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      name: "WLAN-Erneuerung",
      budget_cents: 1_200_000,
      links: [{ label: "Ablage", url: "https://ablage.example.com/neu" }],
      people: [
        { name: "Erika Beispiel", kind: "intern" },
        { name: "Jana Muster", kind: "extern" },
      ],
    });
  });

  it("zeigt Jour-Fixe-Einträge und legt einen neuen an", async () => {
    const meeting = project.last_meeting;
    const calls = stubFetch({
      "GET /api/projects/3": project,
      "GET /api/projects/3/meetings": [
        { id: 9, held_on: "2026-03-05", title: "Jour Fixe", files: 1, updated_at: "" },
      ],
      "GET /api/projects/3/meetings/9": meeting,
      "POST /api/projects/3/meetings": { ...meeting, id: 10, held_on: "2026-04-02", files: [] },
      "GET /api/projects/3/meetings/10": { ...meeting, id: 10, held_on: "2026-04-02", files: [] },
    });
    render(<ProjectPage projectId={3} tab="jour-fixe" roles={["Projekte.Editor"]} />);
    expect(await screen.findByRole("heading", { name: "Stand" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Protokoll.pdf" })).toHaveAttribute(
      "href",
      "/api/projects/3/meetings/9/files/1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Neuer Eintrag" }));
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-04-02" } });
    const text = screen.getByLabelText("Protokoll");
    fireEvent.change(text, { target: { value: "Punkt" } });
    fireEvent.click(screen.getByRole("button", { name: "Vorschau" }));
    expect(screen.getByText("Punkt")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Eintrag speichern" }));
    expect(await screen.findByText(/02\.04\.2026 ist gespeichert/)).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      held_on: "2026-04-02",
      title: "Jour Fixe",
      body: "Punkt",
    });
  });

  it("hakt Aufgaben ab", async () => {
    const task = project.tasks[0];
    const calls = stubFetch({
      "GET /api/projects/3": project,
      "GET /api/projects/3/tasks": [task],
      "PUT /api/projects/3/tasks/1": { ...task, done: true },
    });
    render(<ProjectPage projectId={3} tab="aufgaben" roles={["Projekte.Editor"]} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Angebote vergleichen" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        text: "Angebote vergleichen",
        owner: "Erika",
        due_on: "2026-03-01",
        done: true,
      }),
    );
  });
});
