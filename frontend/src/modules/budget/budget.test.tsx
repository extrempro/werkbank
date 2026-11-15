import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsPage } from "./AccountsPage";
import {
  euroInput,
  formatBudgetDay,
  formatEuro,
  parseEuro,
  type Account,
  type BudgetSettings,
  type Overview,
} from "./api";
import { BudgetOverviewPage } from "./BudgetOverviewPage";
import { BudgetSettingsPage } from "./BudgetSettingsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings: BudgetSettings = {
  start_month: 8,
  year_label: "Wirtschaftsjahr",
  cost_center: "4711",
  current_year: 2026,
  current_year_name: "2026/27",
};

const software: Account = {
  id: 1,
  number: "6815",
  name: "Softwarewartung",
  kind: "laufend",
  note: "",
  active: true,
};
const hardware: Account = {
  id: 2,
  number: "0420",
  name: "Hardware",
  kind: "investition",
  note: "Server",
  active: false,
};

function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    settings,
    year: 2026,
    year_name: "2026/27",
    first_day: "2026-08-01",
    last_day: "2027-07-31",
    years: [
      { year: 2027, name: "2027/28" },
      { year: 2026, name: "2026/27" },
      { year: 2025, name: "2025/26" },
    ],
    rows: [
      { account: hardware, plan_cents: 5_000_050, previous_cents: null },
      { account: software, plan_cents: 1_190_000, previous_cents: 1_000_000 },
    ],
    plan: { running_cents: 1_190_000, investment_cents: 5_000_050, total_cents: 6_190_050 },
    previous: { running_cents: 1_000_000, investment_cents: 0, total_cents: 1_000_000 },
    ...overrides,
  };
}

/** Antwortet je Methode und Pfad; merkt sich alle Aufrufe. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = Object.keys(routes).find((route) => `${method} ${url}`.startsWith(route));
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

/** Beträge ohne die geschützten Leerzeichen der Zahlenformatierung. */
function plain(text: string | null): string {
  return (text ?? "").replace(/[  ]/g, " ");
}

describe("Beträge", () => {
  it("liest die deutsche Schreibweise und lehnt alles andere ab", () => {
    expect(parseEuro("11.900,00")).toBe(1_190_000);
    expect(parseEuro("11900")).toBe(1_190_000);
    expect(parseEuro("11900,5")).toBe(1_190_050);
    expect(parseEuro("1 190 €")).toBe(119_000);
    expect(parseEuro("0")).toBe(0);
    for (const bad of ["", "abc", "1.19,00", "12,345", "-5", "11,900.00", "9999999999999"]) {
      expect(parseEuro(bad)).toBeNull();
    }
  });

  it("schreibt Beträge für Anzeige und Eingabefeld", () => {
    expect(plain(formatEuro(1_190_000))).toBe("11.900,00 €");
    expect(euroInput(1_190_000)).toBe("11900,00");
    expect(euroInput(5)).toBe("0,05");
    expect(euroInput(null)).toBe("");
    expect(formatBudgetDay("2026-08-01")).toBe("01.08.2026");
  });
});

describe("Übersicht", () => {
  it("zeigt Plan, Vorjahr und Summen und lädt ein anderes Jahr", async () => {
    const calls = stubFetch({ "GET /api/budget/overview": overview() });
    render(<BudgetOverviewPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("region", { name: "Plan 2026/27" }));
    const row = table.getByRole("row", { name: /6815 Softwarewartung/ });
    expect(plain(row.textContent)).toContain("11.900,00 €");
    expect(plain(row.textContent)).toContain("10.000,00 €");
    expect(table.getByRole("row", { name: /0420 Hardware/ })).toHaveTextContent("stillgelegt");
    expect(plain(table.getByRole("row", { name: /^Gesamt/ }).textContent)).toContain("61.900,50 €");
    expect(screen.getByText(/Kostenstelle 4711/)).toBeVisible();
    expect(screen.getByText(/01\.08\.2026 bis 31\.07\.2027 · läuft gerade/)).toBeVisible();
    // Lesende Rollen können den Plan nicht bearbeiten.
    expect(screen.queryByRole("button", { name: "Plan bearbeiten" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Wirtschaftsjahr"), { target: { value: "2025" } });
    await vi.waitFor(() =>
      expect(calls.map((call) => call.url)).toContain("/api/budget/overview?year=2025"),
    );
  });

  it("lässt den Budgetverwalter den Plan ändern und prüft die Eingabe", async () => {
    const saved = overview({
      rows: [
        { account: hardware, plan_cents: null, previous_cents: null },
        { account: software, plan_cents: 1_250_000, previous_cents: 1_000_000 },
      ],
      plan: { running_cents: 1_250_000, investment_cents: 0, total_cents: 1_250_000 },
    });
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "PUT /api/budget/plans/2026": saved,
    });
    render(<BudgetOverviewPage roles={["Budget.Manager"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Plan bearbeiten" }));
    const softwareField = screen.getByRole("textbox", { name: /Plan für 6815 Softwarewartung/ });
    expect(softwareField).toHaveValue("11900,00");

    fireEvent.change(softwareField, { target: { value: "zwölftausend" } });
    fireEvent.click(screen.getByRole("button", { name: "Plan speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ist nicht lesbar");
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);

    fireEvent.change(softwareField, { target: { value: "12.500,00" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Plan für 0420 Hardware/ }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan speichern" }));
    expect(await screen.findByText("Der Plan ist gespeichert.")).toBeVisible();
    // Gesendet wird nur, was sich geändert hat; ein leeres Feld entfernt den Plan.
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      entries: [
        { account_id: 2, amount_cents: null },
        { account_id: 1, amount_cents: 1_250_000 },
      ],
    });
    expect(screen.queryByRole("textbox", { name: /Plan für/ })).toBeNull();
  });

  it("erklärt den leeren Zustand", async () => {
    stubFetch({
      "GET /api/budget/overview": overview({
        rows: [],
        plan: { running_cents: 0, investment_cents: 0, total_cents: 0 },
      }),
    });
    render(<BudgetOverviewPage roles={["Budget.Editor"]} />);
    expect(await screen.findByText(/Es sind noch keine Konten angelegt/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Konten anlegen" })).toHaveAttribute(
      "href",
      "/budget/konten",
    );
  });
});

describe("Konten", () => {
  it("zeigt Lesenden nur die Liste", async () => {
    stubFetch({ "GET /api/budget/accounts": [hardware, software] });
    render(<AccountsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("region", { name: "Konten" }));
    expect(table.getAllByRole("row")).toHaveLength(3);
    expect(table.getByRole("row", { name: /0420/ })).toHaveTextContent("stillgelegt");
    expect(screen.queryByRole("button", { name: /bearbeiten/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Konto anlegen" })).toBeNull();
  });

  it("legt ein Konto an und ändert eines", async () => {
    const created: Account = { ...software, id: 3, number: "6820", name: "Telefonie" };
    const calls = stubFetch({
      "GET /api/budget/accounts": [hardware, software],
      "POST /api/budget/accounts": created,
      "PUT /api/budget/accounts/2": { ...hardware, active: true },
    });
    render(<AccountsPage roles={["Budget.Editor"]} />);
    await screen.findByRole("region", { name: "Konten" });

    fireEvent.click(screen.getByRole("button", { name: "Konto anlegen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Kontonummer und Bezeichnung");
    fireEvent.change(screen.getByLabelText("Kontonummer"), { target: { value: " 6820 " } });
    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "Telefonie" } });
    fireEvent.click(screen.getByRole("button", { name: "Konto anlegen" }));
    expect(await screen.findByText("Konto 6820 ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      number: "6820",
      name: "Telefonie",
      kind: "laufend",
      note: "",
      active: true,
    });
    // Das Formular beginnt danach wieder leer.
    expect(screen.getByLabelText("Kontonummer")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Konto 0420 bearbeiten" }));
    expect(screen.getByRole("heading", { name: "Konto 0420 bearbeiten" })).toBeVisible();
    expect(screen.getByLabelText("Art")).toHaveValue("investition");
    fireEvent.click(screen.getByLabelText("Konto ist aktiv"));
    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(await screen.findByText("Konto 0420 ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      number: "0420",
      active: true,
    });
    const table = within(screen.getByRole("region", { name: "Konten" }));
    expect(table.getByRole("row", { name: /0420/ })).toHaveTextContent("aktiv");
  });
});

describe("Einstellungen", () => {
  it("speichert Beginn, Bezeichnung und Kostenstelle", async () => {
    const calls = stubFetch({
      "GET /api/budget/settings": settings,
      "PUT /api/budget/settings": { ...settings, start_month: 1, current_year_name: "2026" },
    });
    render(<BudgetSettingsPage />);
    expect(await screen.findByLabelText("Beginn des Geschäftsjahrs")).toHaveValue("8");
    expect(screen.getByText(/endet am letzten Tag im Juli/)).toBeVisible();
    expect(screen.getByText("Laufend: Wirtschaftsjahr 2026/27")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bezeichnung");

    fireEvent.change(screen.getByLabelText("Bezeichnung"), {
      target: { value: "Wirtschaftsjahr" },
    });
    fireEvent.change(screen.getByLabelText("Beginn des Geschäftsjahrs"), {
      target: { value: "1" },
    });
    expect(screen.getByText(/endet am letzten Tag im Dezember/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    expect(await screen.findByText("Die Einstellungen sind gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      start_month: 1,
      year_label: "Wirtschaftsjahr",
      cost_center: "4711",
    });
    expect(screen.getByText("Laufend: Wirtschaftsjahr 2026")).toBeVisible();
  });
});
