import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsPage } from "./AccountsPage";
import {
  euroInput,
  fileSize,
  formatBudgetDay,
  formatEuro,
  formatRate,
  grossCents,
  fiscalYearOf,
  hasTag,
  itemMatches,
  runtimeText,
  niceMax,
  parseEuro,
  parseRate,
  deadlineBadge,
  partnerRoles,
  share,
  termText,
  type Account,
  type BudgetSettings,
  type Contract,
  type Invoice,
  type InvoiceLine,
  type Item,
  type Overview,
  type Partner,
} from "./api";
import { BudgetOverviewPage } from "./BudgetOverviewPage";
import { BudgetSettingsPage } from "./BudgetSettingsPage";
import { ContractsPage } from "./ContractsPage";
import { InvoicesPage } from "./InvoicesPage";
import { ItemsPage } from "./ItemsPage";

/** Eintrag in einer Auswahl mit Suche wählen (Partner, Vertrag). */
async function pick(scope: ReturnType<typeof within>, label: RegExp, text: string) {
  const box = scope.getByRole("combobox", { name: label });
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(await scope.findByRole("option", { name: new RegExp(text) }));
}
import { PartnerDetailPage } from "./PartnerDetailPage";
import { PartnersPage } from "./PartnersPage";
import { PlanningPage } from "./PlanningPage";
import { DeleteButton } from "./shared";
import { StatisticsPage } from "./StatisticsPage";
import { cancelDialog, confirmDialog } from "../../test/confirm";

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

const office: Item = {
  id: 11,
  number: "BP-2025-003",
  account_id: 1,
  account_number: "6815",
  account_name: "Softwarewartung",
  kind: "laufend",
  name: "Office-Lizenzen",
  partner_id: 1,
  partner_name: "Beispiel Software GmbH",
  amount_cents: 1_190_000,
  start_year: 2025,
  start_year_name: "2025/26",
  end_year: null,
  end_year_name: null,
  note: "",
  tags: ["Lizenzen", "Cloud"],
  active: true,
  contract_id: 1,
  contract_title: "Wartung Zeiterfassung",
};
const server: Item = {
  id: 12,
  number: "BP-2026-001",
  account_id: 2,
  account_number: "0420",
  account_name: "Hardware",
  kind: "investition",
  name: "Server",
  amount_cents: 5_000_050,
  start_year: 2026,
  start_year_name: "2026/27",
  end_year: 2026,
  end_year_name: "2026/27",
  note: "",
  tags: [],
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
      {
        account: hardware,
        expected_cents: 5_000_050,
        previous_cents: null,
        actual_cents: 0,
        forecast_cents: 0,
      },
      {
        account: software,
        expected_cents: 1_190_000,
        previous_cents: 1_000_000,
        actual_cents: 0,
        forecast_cents: 600_000,
      },
    ],
    items: [
      {
        item: server,
        expected_cents: 5_000_050,
        previous_cents: null,
        actual_cents: 0,
        forecast_cents: 5_000_050,
        status: "offen",
        closed_by_hand: false,
        closed_by_invoice: false,
        contracts: 0,
      },
      {
        item: office,
        expected_cents: 1_190_000,
        previous_cents: 1_000_000,
        actual_cents: 0,
        forecast_cents: 1_190_000,
        status: "rechnung",
        closed_by_hand: false,
        closed_by_invoice: false,
        contracts: 1,
      },
    ],
    expected: { running_cents: 1_190_000, investment_cents: 5_000_050, total_cents: 6_190_050 },
    previous: { running_cents: 1_000_000, investment_cents: 0, total_cents: 1_000_000 },
    actual: { running_cents: 0, investment_cents: 0, total_cents: 0 },
    forecast: { running_cents: 600_000, investment_cents: 0, total_cents: 600_000 },
    statuses: { open: 1, invoiced: 1, closed: 0 },
    open_invoices: 0,
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
      // Nur JSON-Inhalte auslesen; ein hochgeladener Beleg ist eine Datei.
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
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
  return (text ?? "").replace(/\s/g, " ");
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

describe("Budgetposten", () => {
  it("zeigt Nummer, Status, Partner und Beträge, filtert und lädt ein anderes Jahr", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
    });
    render(<ItemsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("table"));
    const row = table.getByRole("row", { name: /Office-Lizenzen/ });
    expect(row).toHaveTextContent("BP-2025-003");
    expect(row).toHaveTextContent("Rechnung liegt vor");
    expect(row).toHaveTextContent("ab 2025/26, bis auf Weiteres");
    expect(row).toHaveTextContent("Beispiel Software GmbH");
    expect(plain(row.textContent)).toContain("11.900,00 €");
    expect(plain(row.textContent)).toContain("10.000,00 €");
    const serverRow = table.getByRole("row", { name: /Server/ });
    expect(serverRow).toHaveTextContent("stillgelegt");
    expect(serverRow).toHaveTextContent("einmalig 2026/27");
    expect(serverRow).toHaveTextContent("offen");
    // Ältere Posten ohne Partner: Hinweis
    expect(serverRow).toHaveTextContent("Partner fehlt");
    // Prognose und Abweichung gibt es nicht mehr.
    expect(table.queryByRole("columnheader", { name: "Prognose" })).toBeNull();
    expect(plain(screen.getByText(/^2 Budgetposten/).textContent)).toContain("geplant 61.900,50 €");
    // Lesende Rollen legen nichts an.
    expect(screen.queryByRole("button", { name: "Posten hinzufügen" })).toBeNull();
    // Gruppiert nach Konto
    expect(table.getByRole("rowheader", { name: /^0420 Hardware/ })).toBeVisible();

    // Nach Status filtern
    fireEvent.click(screen.getByRole("button", { name: "Offen · 1" }));
    expect(table.queryByRole("row", { name: /Office-Lizenzen/ })).toBeNull();
    expect(screen.getByText(/^1 von 2 Budgetposten/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));
    expect(table.getByRole("row", { name: /Office-Lizenzen/ })).toBeVisible();

    // Suche nach der Nummer
    fireEvent.change(screen.getByLabelText("Budgetposten suchen"), {
      target: { value: "bp-2026" },
    });
    expect(table.queryByRole("row", { name: /Office-Lizenzen/ })).toBeNull();
    expect(table.getByRole("row", { name: /Server/ })).toBeVisible();

    fireEvent.change(screen.getByLabelText("Wirtschaftsjahr"), { target: { value: "2025" } });
    await vi.waitFor(() =>
      expect(calls.map((call) => call.url)).toContain("/api/budget/overview?year=2025"),
    );
  });

  it("sortiert nach Spalten und gruppiert nach Partner oder gar nicht", async () => {
    stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
    });
    render(<ItemsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("table"));
    fireEvent.change(screen.getByLabelText("Gruppieren"), { target: { value: "keine" } });
    const names = () =>
      table
        .getAllByRole("button", { name: /^(Office-Lizenzen|Server)$/ })
        .map((button) => button.textContent);
    // Vorgabe: nach Nummer
    expect(names()).toEqual(["Office-Lizenzen", "Server"]);
    fireEvent.click(table.getByRole("button", { name: /^Geplant/ }));
    expect(table.getByRole("columnheader", { name: /^Geplant/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(names()).toEqual(["Office-Lizenzen", "Server"]);
    fireEvent.click(table.getByRole("button", { name: /^Geplant/ }));
    expect(names()).toEqual(["Server", "Office-Lizenzen"]);
    fireEvent.change(screen.getByLabelText("Gruppieren"), { target: { value: "partner" } });
    expect(table.getByRole("rowheader", { name: /^Beispiel Software GmbH/ })).toBeVisible();
    expect(table.getByRole("rowheader", { name: /^Ohne Partner/ })).toBeVisible();
  });

  it("öffnet einen Posten rechts, hakt ihn ab und nimmt das Abhaken zurück", async () => {
    const row = {
      previous_cents: null,
      contracts: 0,
      actual_cents: 0,
      closed_by_invoice: false,
    };
    const calls = stubFetch({
      "GET /api/budget/overview": overview({
        items: [
          {
            ...row,
            item: office,
            expected_cents: 1_190_000,
            forecast_cents: 1_190_000,
            status: "rechnung",
            closed_by_hand: false,
          },
          {
            ...row,
            item: server,
            expected_cents: 5_000_050,
            forecast_cents: 0,
            status: "abgeschlossen",
            closed_by_hand: true,
          },
        ],
      }),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/invoices": {
        year: 2026,
        year_name: "2026/27",
        years: [],
        entries: [invoice({ number: "RE-7", lines: [invoiceLine({ gross_cents: 119_000 })] })],
      },
      "POST /api/budget/items/11/close": {
        item_id: 11,
        year: 2026,
        status: "abgeschlossen",
        closed_by_hand: true,
        closed_by_invoice: false,
      },
      "POST /api/budget/items/12/reopen": {
        item_id: 12,
        year: 2026,
        status: "offen",
        closed_by_hand: false,
        closed_by_invoice: false,
      },
    });
    render(<ItemsPage roles={["Budget.Editor"]} />);
    const table = within(await screen.findByRole("table"));
    fireEvent.click(table.getByRole("button", { name: "Office-Lizenzen" }));
    const pane = within(screen.getByRole("region", { name: "Office-Lizenzen" }));
    expect(pane.getByText("BP-2025-003", { selector: "dd span" })).toBeVisible();
    expect(pane.getByRole("list", { name: /^Status für Wirtschaftsjahr/ })).toBeVisible();
    // Rechnungen auf dem Posten
    expect(await pane.findByText(/RE-7/)).toBeVisible();
    fireEvent.click(pane.getByRole("button", { name: "Abschließen" }));
    await confirmDialog("Abschließen");
    expect(
      await screen.findByText("Office-Lizenzen ist im Wirtschaftsjahr 2026/27 abgeschlossen."),
    ).toBeVisible();
    expect(calls.find((call) => call.url === "/api/budget/items/11/close")?.body).toEqual({
      year: 2026,
    });
    // Von Hand abgeschlossen: wieder öffnen, nicht noch einmal abschließen
    fireEvent.click(table.getByRole("button", { name: "Server" }));
    const serverPane = within(screen.getByRole("region", { name: "Server" }));
    expect(serverPane.queryByRole("button", { name: "Abschließen" })).toBeNull();
    fireEvent.click(serverPane.getByRole("button", { name: "Wieder öffnen" }));
    await confirmDialog("Wieder öffnen");
    expect(await screen.findByText("Server ist wieder offen.")).toBeVisible();
    fireEvent.click(serverPane.getByRole("button", { name: "Ansicht schließen" }));
    expect(screen.queryByRole("region", { name: "Server" })).toBeNull();
  });

  it("legt einen Posten in der Maske rechts an und ändert einen", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "POST /api/budget/items": {
        ...office,
        id: 13,
        number: "BP-2026-002",
        name: "Zeiterfassung Lizenz",
      },
      "PUT /api/budget/items/12": { ...server, active: true },
      "GET /api/budget/contracts": {
        year: 2026,
        years: [{ year: 2026, name: "2026/27" }],
        current_year_name: "2026/27",
        notice_warn_days: 60,
        entries: [contract()],
      },
      "GET /api/projects/choices": [
        { id: 3, name: "WLAN-Erneuerung", status: "aktiv" },
        { id: 4, name: "Altes Projekt", status: "abgeschlossen" },
      ],
      "GET /api/budget/partners": [partner, { ...distributor, active: false }],
    });
    render(<ItemsPage roles={["Budget.Editor"]} />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Posten hinzufügen" }));
    const form = within(screen.getByRole("region", { name: "Posten hinzufügen" }));
    fireEvent.click(form.getByRole("button", { name: "Posten speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Bitte eine Bezeichnung eintragen.");
    fireEvent.change(form.getByLabelText(/^Bezeichnung/), {
      target: { value: "Zeiterfassung Lizenz" },
    });
    fireEvent.click(form.getByRole("button", { name: "Posten speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Bitte ein Konto wählen.");
    // Stillgelegte Konten stehen bei einem neuen Posten nicht zur Wahl.
    expect(within(form.getByLabelText(/^Konto/)).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(form.getByLabelText(/^Konto/), { target: { value: "1" } });
    // Der Partner ist Pflicht; stillgelegte stehen nicht zur Wahl.
    fireEvent.click(form.getByRole("button", { name: "Posten speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Bitte einen Partner wählen.");
    fireEvent.focus(form.getByRole("combobox", { name: /^Partner/ }));
    const partnerList = await form.findByRole("listbox", { name: "Partner" });
    expect(
      within(partnerList)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Beispiel Software GmbH"]);
    await pick(form, /^Partner/, "Beispiel Software GmbH");
    fireEvent.change(form.getByLabelText(/^Betrag \(Brutto\)/), { target: { value: "viel" } });
    fireEvent.click(form.getByRole("button", { name: "Posten speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Der Betrag ist nicht lesbar");
    fireEvent.change(form.getByLabelText(/^Betrag \(Brutto\)/), {
      target: { value: "5.000,00" },
    });
    // Einmalig: nur das Jahr; Beginn ist das gezeigte Jahr.
    expect(form.getByRole("button", { name: "Einmalig" })).toHaveAttribute("aria-pressed", "true");
    expect(form.getByLabelText("Wirtschaftsjahr")).toHaveValue("2026");
    expect(form.getByText("Plan: 5.000,00 € nur für Wirtschaftsjahr 2026/27.")).toBeVisible();
    // Mehrere Jahre brauchen ein Ende; dann heißt das Feld „Ab …“.
    fireEvent.click(form.getByRole("button", { name: "Mehrere Jahre" }));
    expect(form.getByLabelText("Ab Wirtschaftsjahr")).toHaveValue("2026");
    fireEvent.click(form.getByRole("button", { name: "Posten speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("bis zu welchem Wirtschaftsjahr");
    // Als Ende stehen nur Jahre nach dem Beginn zur Wahl.
    expect(
      within(form.getByLabelText(/^Bis Wirtschaftsjahr/))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Bitte wählen", "2027/28"]);
    fireEvent.change(form.getByLabelText(/^Bis Wirtschaftsjahr/), { target: { value: "2027" } });
    expect(plain(form.getByText(/^Plan: 5.000,00 € je Wirtschaftsjahr/).textContent)).toContain(
      "zusammen 10.000,00 €",
    );
    await pick(form, /^Vertrag/, "Wartung Zeiterfassung");
    // Abgeschlossene Projekte stehen bei einem neuen Posten nicht zur Wahl.
    expect(
      within(form.getByLabelText("IT-Projekt"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Kein Projekt", "WLAN-Erneuerung"]);
    fireEvent.change(form.getByLabelText("IT-Projekt"), { target: { value: "3" } });
    fireEvent.click(form.getByRole("button", { name: "Posten speichern" }));
    expect(
      await screen.findByText("Zeiterfassung Lizenz (BP-2026-002) ist gespeichert."),
    ).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      account_id: 1,
      partner_id: 1,
      name: "Zeiterfassung Lizenz",
      amount_cents: 500_000,
      start_year: 2026,
      end_year: 2027,
      note: "",
      tags: [],
      active: true,
      contract_id: 1,
      project_id: 3,
    });

    // Bearbeiten: Laufzeit und Betrag sind vorbelegt.
    fireEvent.click(await screen.findByRole("button", { name: "Server" }));
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const edit = within(screen.getByRole("region", { name: "Server bearbeiten" }));
    expect(edit.getByRole("button", { name: "Einmalig" })).toHaveAttribute("aria-pressed", "true");
    expect(edit.getByLabelText(/^Betrag \(Brutto\)/)).toHaveValue("50000,50");
    fireEvent.click(edit.getByLabelText("Budgetposten ist aktiv"));
    fireEvent.click(edit.getByRole("button", { name: "Bis auf Weiteres" }));
    // Älterer Posten ohne Partner: beim Speichern Pflicht
    expect(edit.getByRole("combobox", { name: /^Partner/ })).toHaveValue("");
    await pick(edit, /^Partner/, "Beispiel Software GmbH");
    fireEvent.click(edit.getByRole("button", { name: "Änderungen speichern" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
        account_id: 2,
        partner_id: 1,
        name: "Server",
        start_year: 2026,
        end_year: null,
        active: true,
        contract_id: null,
      }),
    );
  });
});

describe("Übersicht", () => {
  it("erklärt den leeren Zustand", async () => {
    stubFetch({
      "GET /api/budget/overview": overview({
        rows: [],
        expected: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        items: [],
        statuses: { open: 0, invoiced: 0, closed: 0 },
        actual: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        forecast: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        open_invoices: 0,
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
      "GET /api/budget/partners": [partner],
      "POST /api/budget/accounts": created,
      "PUT /api/budget/accounts/2": { ...hardware, active: true },
    });
    render(<AccountsPage roles={["Budget.Editor"]} />);
    await screen.findByRole("region", { name: "Konten" });

    fireEvent.click(screen.getByRole("button", { name: "Konto anlegen" }));
    fireEvent.click(screen.getByRole("button", { name: "Konto speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Kontonummer und Bezeichnung");
    fireEvent.change(screen.getByLabelText("Kontonummer"), { target: { value: " 6820 " } });
    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "Telefonie" } });
    fireEvent.click(screen.getByRole("button", { name: "Konto speichern" }));
    expect(await screen.findByText("Konto 6820 ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      number: "6820",
      name: "Telefonie",
      kind: "laufend",
      note: "",
      active: true,
    });
    // Nach dem Speichern schließt das Formular.
    expect(screen.queryByLabelText("Kontonummer")).toBeNull();

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
      "GET /api/budget/tags": [],
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

const partner: Partner = {
  id: 1,
  name: "Beispiel Software GmbH",
  is_contract_partner: true,
  is_invoicer: true,
  customer_number: "K-100",
  note: "",
  active: true,
};
const distributor: Partner = {
  ...partner,
  id: 2,
  name: "Beispiel Distribution AG",
  is_contract_partner: false,
};

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 1,
    title: "Wartung Zeiterfassung",
    partner_id: 1,
    partner_name: "Beispiel Software GmbH",
    items: [
      {
        id: 11,
        number: "BP-2025-003",
        name: "Office-Lizenzen",
        account_number: "6815",
        account_name: "Softwarewartung",
      },
    ],
    invoicer_id: null,
    invoicer_name: null,
    dpa_status: "vorhanden",
    yearly_cents: 600_000,
    number: "V-1",
    starts_on: "2026-01-01",
    ends_on: "2026-12-31",
    renewal_months: 12,
    notice_months: 1,
    cancelled_to: null,
    net_cents: 42_017,
    tax_rate_bp: 1900,
    amount_cents: 50_000,
    interval: "monatlich",
    note: "",
    running: true,
    term_end: "2026-12-31",
    notice_deadline: "2026-11-30",
    days_to_deadline: 15,
    deadline_soon: true,
    current_year_cents: 600_000,
    year_actual_cents: 0,
    closed_items: 0,
    ...overrides,
  };
}

describe("Hilfen für Verträge", () => {
  it("stuft den Kündigungstermin ein", () => {
    expect(deadlineBadge(contract())).toEqual({ text: "noch 15 Tage", tone: "bad" });
    expect(deadlineBadge(contract({ days_to_deadline: 90 }))).toEqual({
      text: "noch 90 Tage",
      tone: "todo",
    });
    expect(deadlineBadge(contract({ days_to_deadline: 300 }))).toEqual({
      text: "in 10 Monaten",
      tone: "ok",
    });
    expect(deadlineBadge(contract({ days_to_deadline: -3 }))?.text).toBe("Frist verstrichen");
    expect(deadlineBadge(contract({ days_to_deadline: null }))).toBeNull();
    expect(deadlineBadge(contract({ running: false }))).toBeNull();
  });

  it("beschreibt Laufzeit, Partnerrolle und Anteile", () => {
    expect(termText(contract())).toBe("01.01.2026 bis 31.12.2026, verlängert sich um 12 Monate");
    expect(termText(contract({ ends_on: null, term_end: null, renewal_months: null }))).toBe(
      "seit 01.01.2026, unbefristet",
    );
    expect(termText(contract({ cancelled_to: "2026-09-30" }))).toBe(
      "01.01.2026 bis 30.09.2026 (gekündigt)",
    );
    expect(partnerRoles(partner)).toBe("Vertragspartner und Rechnungssteller");
    expect(partnerRoles(distributor)).toBe("Rechnungssteller");
    expect(share(600_000, 1_190_000)).toBe(50);
    expect(share(5, 0)).toBe(100);
    expect(share(0, 0)).toBe(0);
    expect(share(300, 100)).toBe(100);
    expect(grossCents(100_000, 1900)).toBe(119_000);
    expect(grossCents(999, 700)).toBe(1069);
    expect(grossCents(2, 1900)).toBe(2);
    expect(formatRate(1900)).toBe("19 %");
    expect(formatRate(810)).toBe("8,1 %");
    expect(parseRate("19")).toBe(1900);
    expect(parseRate("8,1 %")).toBe(810);
    expect(parseRate("0")).toBe(0);
    for (const bad of ["", "abc", "19.5", "101", "7,123"]) {
      expect(parseRate(bad)).toBeNull();
    }
  });
});

describe("Übersicht mit Karten und Balken", () => {
  it("zeigt Kennzahlen, Balken, Termine und Handlungsbedarf", async () => {
    stubFetch({
      "GET /api/budget/overview": overview({
        rows: [
          {
            account: hardware,
            expected_cents: null,
            previous_cents: null,
            actual_cents: 0,
            forecast_cents: 119_000,
          },
          {
            account: software,
            expected_cents: 500_000,
            previous_cents: 1_000_000,
            actual_cents: 0,
            forecast_cents: 600_000,
          },
        ],
        expected: { running_cents: 500_000, investment_cents: 0, total_cents: 500_000 },
        actual: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        forecast: { running_cents: 600_000, investment_cents: 119_000, total_cents: 719_000 },
        open_invoices: 0,
      }),
      "GET /api/budget/contracts": {
        year: 2026,
        years: [{ year: 2026, name: "2026/27" }],
        current_year_name: "2026/27",
        notice_warn_days: 60,
        entries: [
          contract(),
          contract({ id: 2, title: "Backup", dpa_status: "fehlt", days_to_deadline: 400 }),
        ],
      },
    });
    render(<BudgetOverviewPage roles={["Budget.Reader"]} />);
    expect(await screen.findByText("Geplant 2026/27", { selector: "dt" })).toBeVisible();
    expect(screen.getByText(/1 offen · 1 mit Rechnung · 0 abgeschlossen/)).toBeVisible();
    expect(
      plain(screen.getByText("Verfügbar", { selector: "dt" }).nextSibling?.textContent ?? null),
    ).toBe("5.000,00 €");
    // Konten nach Art, mit Auslastung; keine Prognose mehr
    const konten = within(screen.getByRole("table", { name: /Budget nach Konten/ }));
    expect(konten.getByRole("rowheader", { name: "Laufende Kosten" })).toBeVisible();
    expect(konten.getByRole("img", { name: "Softwarewartung: 0 % ausgegeben" })).toBeVisible();
    expect(screen.queryByText(/Prognose/)).toBeNull();

    // Zu erledigen mit Sprung in die Liste
    const todo = within(screen.getByRole("region", { name: "Zu erledigen" }));
    expect(todo.getByRole("link", { name: /1 Vertrag ohne AVV/ })).toHaveAttribute(
      "href",
      "/budget/vertraege",
    );
    expect(todo.getByRole("link", { name: /1 Posten ohne Partner/ })).toHaveAttribute(
      "href",
      "/budget/posten",
    );

    const dates = within(await screen.findByRole("region", { name: "Kündigungstermine" }));
    expect(dates.getByRole("link", { name: "Wartung Zeiterfassung" })).toHaveAttribute(
      "href",
      "/budget/vertraege/1",
    );
    expect(screen.getByText(/Nur Lesezugriff/)).toBeVisible();
    expect(dates.getByText("noch 15 Tage")).toBeVisible();
    expect(dates.queryByText("Backup")).toBeNull();
  });
});

describe("Partner", () => {
  it("legt einen Partner an und prüft die Rolle", async () => {
    const calls = stubFetch({
      "GET /api/budget/partners": [partner],
      "POST /api/budget/partners": distributor,
    });
    render(<PartnersPage roles={["Budget.Editor"]} />);
    const table = within(await screen.findByRole("region", { name: "Partner" }));
    expect(table.getByRole("row", { name: /Beispiel Software GmbH/ })).toHaveTextContent(
      "Vertragspartner und Rechnungssteller",
    );
    fireEvent.click(screen.getByRole("button", { name: "Partner anlegen" }));
    fireEvent.change(screen.getByLabelText("Name der Firma"), {
      target: { value: "Beispiel Distribution AG" },
    });
    fireEvent.click(screen.getByLabelText("Vertragspartner"));
    fireEvent.click(screen.getByLabelText("Rechnungssteller"));
    fireEvent.click(screen.getByRole("button", { name: "Partner speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("oder beides ankreuzen");
    fireEvent.click(screen.getByLabelText("Rechnungssteller"));
    fireEvent.click(screen.getByRole("button", { name: "Partner speichern" }));
    expect(await screen.findByText("Beispiel Distribution AG ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      name: "Beispiel Distribution AG",
      is_contract_partner: false,
      is_invoicer: true,
    });
  });
});

describe("Verträge", () => {
  const routes = {
    "GET /api/budget/contracts": {
      year: 2026,
      years: [{ year: 2026, name: "2026/27" }],
      current_year_name: "2026/27",
      notice_warn_days: 60,
      entries: [
        contract({ invoicer_id: 2, invoicer_name: "Beispiel Distribution AG" }),
        contract({
          id: 2,
          title: "Altvertrag",
          running: false,
          cancelled_to: "2025-12-31",
          notice_deadline: null,
          days_to_deadline: null,
          current_year_cents: 0,
          dpa_status: "fehlt",
        }),
      ],
    },
    "GET /api/budget/partners": [partner, distributor],
    "GET /api/budget/items": [office, server],
  };

  it("zeigt laufende Verträge mit Kennzahlen, Termin und AVV und filtert", async () => {
    stubFetch(routes);
    render(<ContractsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("table"));
    // Kopfzeile und ein laufender Vertrag
    expect(table.getAllByRole("row")).toHaveLength(2);
    const row = table.getByRole("row", { name: /Wartung Zeiterfassung/ });
    expect(row).toHaveTextContent("noch 15 Tage");
    expect(plain(row.textContent)).toContain("6.000,00 € im Jahr");
    expect(screen.getByText("Laufende Verträge", { selector: "dt" })).toBeVisible();
    expect(screen.getByText(/1 Kündigungstermin in 120 Tagen/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Vertrag anlegen" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Alle · 2" }));
    expect(table.getByRole("row", { name: /Altvertrag/ })).toHaveTextContent("beendet");
    fireEvent.click(screen.getByRole("button", { name: "AVV fehlt · 1" }));
    expect(table.queryByRole("row", { name: /Wartung Zeiterfassung/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));
    fireEvent.change(screen.getByLabelText("Verträge suchen"), { target: { value: "wartung" } });
    expect(table.getByRole("row", { name: /Wartung Zeiterfassung/ })).toBeVisible();
  });

  it("zeigt Monatsbetrag mit Jahressumme sowie Soll und Ist im Geschäftsjahr", async () => {
    const calls = stubFetch({
      ...routes,
      "GET /api/budget/contracts": {
        ...routes["GET /api/budget/contracts"],
        years: [
          { year: 2027, name: "2027/28" },
          { year: 2026, name: "2026/27" },
        ],
        entries: [contract({ year_actual_cents: 150_000, closed_items: 1 })],
      },
    });
    render(<ContractsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("table"));
    expect(table.getByRole("columnheader", { name: "Soll 2026/27" })).toBeInTheDocument();
    const row = plain(table.getByRole("row", { name: /Wartung Zeiterfassung/ }).textContent);
    expect(row).toContain("500,00 € monatlich");
    expect(row).toContain("6.000,00 € im Jahr");
    expect(row).toContain("1.500,00 €");
    expect(row).toContain("1 von 1 Posten abgeschlossen");
    expect(
      plain(screen.getByText("Ist 2026/27", { selector: "dt" }).nextSibling?.textContent ?? null),
    ).toBe("1.500,00 €");
    fireEvent.change(screen.getByLabelText("Geschäftsjahr"), { target: { value: "2027" } });
    await vi.waitFor(() =>
      expect(calls.map((call) => call.url)).toContain("/api/budget/contracts?year=2027"),
    );
  });

  it("zeigt einen Vertrag rechts mit Daten, Fristen und Posten und legt Monatsposten an", async () => {
    const calls = stubFetch({
      ...routes,
      "GET /api/budget/accounts": [hardware, software],
      "POST /api/budget/contracts/1/monthly-items": { created: [office, server], skipped: 1 },
    });
    const { unmount } = render(<ContractsPage roles={["Budget.Editor"]} selectedId={1} />);
    const pane = within(await screen.findByRole("region", { name: "Wartung Zeiterfassung" }));
    expect(pane.getByText("Beispiel Distribution AG")).toBeVisible();
    expect(pane.getByText("1 Monate zum Laufzeitende")).toBeVisible();
    expect(pane.getByText("30.11.2026")).toBeVisible();
    expect(plain(pane.getByText(/^Verlängert sich um 12 Monate/).textContent)).toContain(
      "6.000,00 € im Jahr",
    );
    expect(pane.getByText(/Office-Lizenzen/)).toBeVisible();
    expect(pane.getByText("Kündigung: noch 15 Tage")).toBeVisible();
    // Monatlicher Vertrag: Vorschlag „Monatsposten anlegen“ mit dem Konto der Posten
    expect(pane.getByLabelText("Konto der Posten")).toHaveValue("1");
    fireEvent.click(pane.getByRole("button", { name: /^Monatsposten für 2026\/27 anlegen/ }));
    expect(await screen.findByText("2 Monatsposten sind angelegt, 1 gab es schon.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      year: 2026,
      account_id: 1,
    });
    unmount();

    render(<ContractsPage roles={["Budget.Reader"]} selectedId={99} />);
    expect(await screen.findByText(/Diesen Vertrag gibt es nicht/)).toBeVisible();
  });

  it("prüft die Eingaben und legt einen Vertrag in der Maske rechts an", async () => {
    const calls = stubFetch({ ...routes, "POST /api/budget/contracts": contract({ id: 3 }) });
    render(<ContractsPage roles={["Budget.Manager"]} />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Vertrag anlegen" }));
    const form = within(screen.getByRole("region", { name: "Vertrag anlegen" }));
    fireEvent.click(form.getByRole("button", { name: "Vertrag speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Bezeichnung");

    fireEvent.change(form.getByLabelText(/^Bezeichnung/), { target: { value: "Neuer Vertrag" } });
    await pick(form, /^Vertragspartner/, "Beispiel Software GmbH");
    await pick(form, /^Rechnungssteller/, "Beispiel Distribution AG");
    // Turnus zuerst; das Betragsfeld heißt passend.
    expect(form.getByRole("button", { name: "Jährlich" })).toHaveAttribute("aria-pressed", "true");
    expect(form.getByLabelText(/^Jahresbetrag \(netto\)/)).toBeVisible();
    fireEvent.click(form.getByRole("button", { name: "Monatlich" }));
    expect(form.getByLabelText(/^Monatsbetrag \(netto\)/)).toBeVisible();
    fireEvent.click(form.getByRole("button", { name: "Jährlich" }));
    fireEvent.change(form.getByLabelText(/^Jahresbetrag/), { target: { value: "abc" } });
    // Stillgelegte Posten stehen nicht zur Wahl; die Suche grenzt ein.
    expect(form.queryByLabelText(/Server/)).toBeNull();
    fireEvent.change(form.getByLabelText("Budgetposten suchen"), { target: { value: "xyz" } });
    expect(form.getByText("Kein Budgetposten passt zur Suche.")).toBeVisible();
    fireEvent.change(form.getByLabelText("Budgetposten suchen"), { target: { value: "office" } });
    // Ein Posten mit einem anderen Vertrag ist nicht wählbar; ein Vertrag geht auch ohne Posten.
    expect(form.getByLabelText(/^BP-2025-003 · 6815 · Office-Lizenzen/)).toBeDisabled();
    expect(form.getByText("(Vertrag: Wartung Zeiterfassung)", { exact: false })).toBeVisible();
    expect(form.getByText("Budgetposten (0 zugeordnet)")).toBeVisible();
    fireEvent.click(form.getByRole("button", { name: "Vertrag speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Betrag ist nicht lesbar");

    fireEvent.change(form.getByLabelText(/^Jahresbetrag/), { target: { value: "500,00" } });
    expect(plain(form.getByText(/^Brutto 595,00 € im Jahr/).textContent)).toContain(
      "Soll je Geschäftsjahr",
    );
    fireEvent.change(form.getByLabelText(/^Steuersatz/), { target: { value: "x" } });
    fireEvent.click(form.getByRole("button", { name: "Vertrag speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Steuersatz ist nicht lesbar");
    fireEvent.change(form.getByLabelText(/^Steuersatz/), { target: { value: "7" } });
    fireEvent.change(form.getByLabelText(/^Beginn/), { target: { value: "2026-01-01" } });
    fireEvent.change(form.getByLabelText(/^Verlängert sich um/), { target: { value: "12" } });
    fireEvent.click(form.getByRole("button", { name: "Vertrag speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("nur bei einem Ende der Laufzeit");

    fireEvent.change(form.getByLabelText(/^Ende der Laufzeit/), {
      target: { value: "2026-12-31" },
    });
    // Die Kündigungsfrist steht als Auswahl bis 12 Monate bereit.
    expect(within(form.getByLabelText(/^Kündigungsfrist/)).getAllByRole("option")).toHaveLength(14);
    fireEvent.change(form.getByLabelText(/^Kündigungsfrist/), { target: { value: "3" } });
    fireEvent.change(form.getByLabelText(/^Auftragsverarbeitungsvertrag/), {
      target: { value: "fehlt" },
    });
    fireEvent.click(form.getByRole("button", { name: "Vertrag speichern" }));
    expect(await screen.findByText("Wartung Zeiterfassung ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      title: "Neuer Vertrag",
      partner_id: 1,
      item_ids: [],
      invoicer_id: 2,
      dpa_status: "fehlt",
      number: "",
      starts_on: "2026-01-01",
      ends_on: "2026-12-31",
      renewal_months: 12,
      notice_months: 3,
      cancelled_to: null,
      net_cents: 50_000,
      tax_rate_bp: 700,
      interval: "jaehrlich",
      note: "",
    });
    window.history.replaceState(null, "", "/");
  });
});

function invoiceLine(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: 1,
    item_id: 11,
    item_number: "BP-2025-003",
    item_name: "Office-Lizenzen",
    account_number: "6815",
    account_name: "Softwarewartung",
    contract_id: 1,
    contract_title: "Wartung Zeiterfassung",
    net_cents: 100_000,
    tax_rate_bp: 1900,
    gross_cents: 119_000,
    description: "Wartung Oktober",
    is_project: false,
    is_yearly: true,
    closes_item: false,
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 1,
    invoicer_id: 1,
    invoicer_name: "Beispiel Software GmbH",
    number: "RE-1",
    internal_number: "re.26.0001",
    invoice_date: "2026-10-12",
    net_cents: 100_000,
    gross_cents: 119_000,
    lines: [invoiceLine()],
    status: "zu_pruefen",
    created_by_name: "Ida IT",
    booked_by_name: null,
    booked_at: null,
    doc_name: null,
    doc_size: null,
    ...overrides,
  };
}

describe("Rechnungen", () => {
  const list = {
    year: 2026,
    year_name: "2026/27",
    years: [{ year: 2026, name: "2026/27" }],
    entries: [
      invoice(),
      invoice({
        id: 2,
        number: "RE-2",
        net_cents: 120_000,
        gross_cents: 140_400,
        lines: [
          invoiceLine({ id: 2, contract_id: null, contract_title: null }),
          invoiceLine({
            id: 3,
            item_id: 12,
            item_name: "Server",
            account_number: "0420",
            account_name: "Hardware",
            contract_id: null,
            contract_title: null,
            net_cents: 20_000,
            tax_rate_bp: 700,
            gross_cents: 21_400,
            description: "Schulung",
            is_yearly: false,
            closes_item: true,
          }),
        ],
        status: "gebucht",
        booked_by_name: "Bodo Budget",
      }),
    ],
  };
  const routes = {
    "GET /api/budget/invoices": list,
    "GET /api/budget/settings": settings,
    "GET /api/budget/partners": [partner, distributor],
    "GET /api/budget/items": [office, server],
    "GET /api/budget/contracts": {
      year: 2026,
      years: [{ year: 2026, name: "2026/27" }],
      current_year_name: "2026/27",
      notice_warn_days: 60,
      entries: [contract()],
    },
  };

  it("zeigt Lesenden Liste und Ansicht ohne Aktionen", async () => {
    stubFetch(routes);
    render(<InvoicesPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("table"));
    const row = table.getByRole("row", { name: /RE-1/ });
    expect(row).toHaveTextContent("zu prüfen");
    expect(plain(row.textContent)).toContain("1.190,00 €");
    expect(table.getByRole("row", { name: /RE-2/ })).toHaveTextContent("2 Posten");
    expect(screen.getByText(/2 Rechnungen · 1 zu prüfen/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Rechnung erfassen" })).toBeNull();

    // Ansicht rechts: Positionen mit Posten, Steuersatz und Vertrag
    fireEvent.click(table.getByRole("button", { name: "RE-1" }));
    const one = within(screen.getByRole("region", { name: "Rechnung RE-1" }));
    expect(one.getByText("Ida IT")).toBeVisible();
    expect(one.getByRole("link", { name: "Wartung Zeiterfassung" })).toBeVisible();
    expect(one.getByText(/jährlich/)).toBeVisible();
    expect(one.queryByRole("button", { name: "Prüfen und buchen" })).toBeNull();
    expect(one.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
    fireEvent.click(table.getByRole("button", { name: "RE-2" }));
    const split = within(screen.getByRole("region", { name: "Rechnung RE-2" }));
    expect(split.getAllByRole("listitem")).toHaveLength(2);
    expect(plain(split.getByText(/7 % Steuer/).textContent)).toContain("Schulung");
    expect(split.getByText("Bodo Budget")).toBeVisible();
  });

  it("lässt die IT nur Offenes ändern und den Budgetverwalter buchen und löschen", async () => {
    const calls = stubFetch({
      ...routes,
      "POST /api/budget/invoices/1/book": invoice({ status: "gebucht" }),
      "DELETE /api/budget/invoices/2": { deleted: true },
    });
    const { unmount } = render(<InvoicesPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "RE-1" }));
    expect(screen.getByText("Prüfen und buchen darf nur der Budgetverwalter.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "RE-2" }));
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
    unmount();

    render(<InvoicesPage roles={["Budget.Manager"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "RE-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Prüfen und buchen" }));
    expect(calls.some((call) => call.url === "/api/budget/invoices/1/book")).toBe(false);
    expect(await screen.findByRole("alertdialog", { name: "Rechnung buchen?" })).toBeVisible();
    await confirmDialog("Buchen");
    expect(await screen.findByText(/RE-1 ist geprüft und gebucht/)).toBeVisible();
    expect(calls.some((call) => call.url === "/api/budget/invoices/1/book")).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: "RE-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await confirmDialog("Löschen");
    expect(await screen.findByText("Rechnung RE-2 ist gelöscht.")).toBeVisible();
  });

  it("prüft die Eingaben und erfasst eine Rechnung", async () => {
    const calls = stubFetch({
      ...routes,
      "POST /api/budget/invoices": invoice({ id: 3, number: "RE-3" }),
    });
    render(<InvoicesPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rechnung erfassen" }));
    const form = within(screen.getByRole("region", { name: "Rechnung erfassen" }));
    fireEvent.click(form.getByRole("button", { name: "Rechnung speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Bitte den Rechnungssteller wählen");

    // Erst der Rechnungssteller: seine Posten stehen oben in der Auswahl.
    await pick(form, /^Rechnungssteller/, "Beispiel Software GmbH");
    expect(
      within(form.getByLabelText("Budgetposten")).getByRole("group", {
        name: "Posten von Beispiel Software GmbH",
      }),
    ).toBeInTheDocument();
    fireEvent.click(form.getByRole("button", { name: /^Rechnungssteller ändern/ }));
    await pick(form, /^Rechnungssteller/, "Beispiel Distribution AG");
    // Rechnungen hängen nur am Posten; dessen Vertrag wird angezeigt und lässt den Posten offen.
    expect(form.queryByLabelText(/^Vertrag/)).toBeNull();
    fireEvent.change(form.getByLabelText("Budgetposten"), { target: { value: "11" } });
    expect(form.getByText("Vertrag des Postens: Wartung Zeiterfassung")).toBeVisible();
    expect(form.getByLabelText(/Schließt den Budgetposten/)).not.toBeChecked();
    fireEvent.change(form.getByLabelText(/^Rechnungsnummer/), { target: { value: " RE-3 " } });
    fireEvent.change(form.getByLabelText(/^Rechnungsdatum/), { target: { value: "2026-11-02" } });
    expect(form.getByText("Zählt für Wirtschaftsjahr 2026/27.")).toBeVisible();
    fireEvent.change(form.getByLabelText(/^Betrag netto/), { target: { value: "1.000,00" } });
    expect(plain(form.getByText(/^Brutto der Position/).textContent)).toContain("1.190,00 €");
    fireEvent.change(form.getByLabelText(/^Brutto laut Rechnung/), { target: { value: "x" } });
    fireEvent.click(form.getByRole("button", { name: "Rechnung speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Das Brutto ist nicht lesbar");

    fireEvent.change(form.getByLabelText(/^Brutto laut Rechnung/), {
      target: { value: "1190,02" },
    });
    fireEvent.click(form.getByLabelText("Gehört zu einem Projekt"));

    // Zweite Position für einen anderen Budgetposten, mit anderem Steuersatz
    fireEvent.click(form.getByRole("button", { name: "Position hinzufügen" }));
    const second = within(form.getByRole("group", { name: "Position 2" }));
    fireEvent.click(form.getByRole("button", { name: "Rechnung speichern" }));
    expect(form.getByRole("alert")).toHaveTextContent("Position 2: Bitte den Budgetposten");
    // Stillgelegte Posten stehen nicht zur Wahl; zwei Positionen dürfen denselben Posten haben.
    expect(
      within(second.getByLabelText("Budgetposten")).queryByRole("option", { name: /Server/ }),
    ).toBeNull();
    fireEvent.change(second.getByLabelText("Budgetposten"), { target: { value: "11" } });
    fireEvent.change(second.getByLabelText(/^Betrag netto/), { target: { value: "200,00" } });
    fireEvent.change(second.getByLabelText(/^Steuersatz/), { target: { value: "7" } });
    expect(plain(form.getByText(/^Summe der Positionen/).textContent)).toContain(
      "brutto 1.404,02 €",
    );
    // Der Rechnungsbetrag laut Beleg muss ganz verteilt sein.
    fireEvent.change(form.getByLabelText(/^Rechnungsbetrag laut Beleg/), {
      target: { value: "1.500,00" },
    });
    fireEvent.click(form.getByRole("button", { name: "Rechnung speichern" }));
    expect(plain(form.getByRole("alert").textContent)).toContain(
      "noch 95,98 € nicht auf Positionen verteilt",
    );
    fireEvent.change(form.getByLabelText(/^Rechnungsbetrag laut Beleg/), {
      target: { value: "1.404,02" },
    });
    fireEvent.click(form.getByRole("button", { name: "Rechnung speichern" }));
    expect(
      await screen.findByText(/RE-3 ist gespeichert und wartet auf die Prüfung/),
    ).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      invoicer_id: 2,
      number: "RE-3",
      internal_number: "",
      invoice_date: "2026-11-02",
      lines: [
        {
          item_id: 11,
          net_cents: 100_000,
          tax_rate_bp: 1900,
          gross_cents: 119_002,
          description: "",
          is_project: true,
          is_yearly: false,
          closes_item: false,
        },
        {
          item_id: 11,
          net_cents: 20_000,
          tax_rate_bp: 700,
          gross_cents: null,
          description: "",
          is_project: false,
          is_yearly: false,
          closes_item: false,
        },
      ],
      total_gross_cents: 140_402,
    });
  });

  it("öffnet eine Rechnung mit ihren Positionen und entfernt eine", async () => {
    const calls = stubFetch({
      ...routes,
      "PUT /api/budget/invoices/2": invoice({ id: 2, number: "RE-2", status: "gebucht" }),
    });
    render(<InvoicesPage roles={["Budget.Manager"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "RE-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(
      within(screen.getByRole("group", { name: "Position 2" })).getByLabelText("Budgetposten"),
    ).toHaveValue("12");
    fireEvent.click(screen.getByRole("button", { name: "Position 2 entfernen" }));
    expect(screen.queryByRole("group", { name: "Position 2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
        number: "RE-2",
        lines: [{ item_id: 11, net_cents: 100_000, tax_rate_bp: 1900, gross_cents: null }],
        total_gross_cents: null,
      }),
    );
  });
});

describe("Partner im Detail", () => {
  const detail = {
    partner: distributor,
    contracts: [contract({ invoicer_id: 2, invoicer_name: "Beispiel Distribution AG" })],
    invoices: [invoice({ invoicer_id: 2, status: "gebucht" })],
    invoice_total: 1,
  };

  it("zeigt Verträge, Budgetposten und Rechnungen der Firma", async () => {
    stubFetch({
      "GET /api/budget/partners/2": detail,
      "GET /api/budget/partners": [partner, distributor],
    });
    render(<PartnerDetailPage roles={["Budget.Reader"]} partnerId={2} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Beispiel Distribution AG" }),
    ).toBeVisible();
    const contracts = within(screen.getByRole("region", { name: "Verträge (1)" }));
    expect(contracts.getByRole("link", { name: "Wartung Zeiterfassung" })).toHaveAttribute(
      "href",
      "/budget/vertraege/1",
    );
    expect(contracts.getByText(/^Rechnungssteller · 6815/)).toBeVisible();
    const items = within(screen.getByRole("region", { name: "Budgetposten (1)" }));
    expect(items.getByText("1 Vertrag, 1 Rechnung")).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Rechnungen (1)" })).getByText(
        /12\.10\.2026 · RE-1/,
      ),
    ).toBeVisible();
    // Zusammenlegen darf nur der Budgetverwalter.
    expect(screen.queryByRole("heading", { name: /zusammenlegen/ })).toBeNull();
  });

  it("legt erst nach Bestätigung zusammen", async () => {
    const calls = stubFetch({
      "GET /api/budget/partners/2": detail,
      "GET /api/budget/partners": [partner, distributor],
      "POST /api/budget/partners/2/merge": {
        partner,
        moved_contracts: 1,
        moved_invoices: 1,
      },
    });
    render(<PartnerDetailPage roles={["Budget.Manager"]} partnerId={2} />);
    const start = await screen.findByRole("button", { name: "Zusammenlegen" });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Zusammenlegen mit"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Zusammenlegen" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "wandern zu „Beispiel Software GmbH“",
    );
    await confirmDialog("Zusammenlegen");
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({ into_id: 1 }),
    );
    await vi.waitFor(() => expect(window.location.pathname).toBe("/budget/partner/1"));
  });
});

describe("Löschen", () => {
  it("fragt nach und zeigt den Grund, wenn der Server ablehnt", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("abgelehnt"))
      .mockResolvedValueOnce({ deleted: true });
    const onDeleted = vi.fn();
    render(<DeleteButton what="Vertrag Wartung" run={run} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "Vertrag Wartung löschen" }));
    expect(run).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog", { name: "Vertrag Wartung löschen?" });
    expect(dialog).toHaveTextContent("Das lässt sich nicht rückgängig machen.");
    await cancelDialog();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Vertrag Wartung löschen" }));
    await confirmDialog("Löschen");
    expect(await screen.findByRole("alert")).toHaveTextContent("Das Löschen hat nicht geklappt.");
    expect(onDeleted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Vertrag Wartung löschen" }));
    await confirmDialog("Löschen");
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("löscht einen Partner aus der Liste", async () => {
    const calls = stubFetch({
      "GET /api/budget/partners": [partner, distributor],
      "DELETE /api/budget/partners/2": { deleted: true },
    });
    render(<PartnersPage roles={["Budget.Editor"]} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Partner Beispiel Distribution AG löschen" }),
    );
    await confirmDialog("Löschen");
    expect(await screen.findByText("Beispiel Distribution AG ist gelöscht.")).toBeVisible();
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    expect(screen.queryByRole("link", { name: "Beispiel Distribution AG" })).toBeNull();
  });
});

describe("Mehrjahresübersicht", () => {
  const planning = {
    year_label: "Wirtschaftsjahr",
    current_year: 2026,
    years: [2026, 2027, 2028, 2029, 2030].map((year) => ({
      year,
      name: `${year}/${String((year + 1) % 100).padStart(2, "0")}`,
      expected_cents: year <= 2027 ? 500_000 : 0,
      actual_cents: year === 2026 ? 119_000 : 0,
    })),
    rows: [
      {
        item: { ...office, end_year: 2027, end_year_name: "2027/28" },
        years: {
          "2026": { expected_cents: 500_000, actual_cents: 119_000, status: "abgeschlossen" },
          "2027": { expected_cents: 500_000, actual_cents: 0, status: "offen" },
          "2028": { expected_cents: null, actual_cents: 0, status: null },
          "2029": { expected_cents: null, actual_cents: 0, status: null },
          "2030": { expected_cents: null, actual_cents: 0, status: null },
        },
      },
    ],
  };

  it("zeigt Erwartung, Ist und Status je Jahr und bietet den Export an", async () => {
    const calls = stubFetch({ "GET /api/budget/planning": planning });
    render(<PlanningPage />);
    const table = within(await screen.findByRole("region", { name: /^Mehrjahresübersicht/ }));
    const row = table.getByRole("row", { name: /Office-Lizenzen/ });
    expect(row).toHaveTextContent("2025/26 bis 2027/28");
    expect(row).toHaveTextContent("abgeschlossen");
    expect(row).toHaveTextContent("offen");
    expect(plain(row.textContent)).toContain("Ist 1.190,00 €");
    expect(plain(table.getByRole("row", { name: /^Summe erwartet/ }).textContent)).toContain(
      "5.000,00 €",
    );
    expect(screen.getByRole("link", { name: "Als Excel-Datei herunterladen" })).toHaveAttribute(
      "href",
      "/api/budget/export",
    );
    // Planen gibt es hier nicht mehr; geändert wird am Budgetposten.
    expect(screen.queryByRole("button", { name: /bearbeiten/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rückblick: letzte fünf Jahre" }));
    await vi.waitFor(() =>
      expect(calls.map((call) => call.url)).toContain("/api/budget/planning?start=2022"),
    );
    expect(screen.getByRole("link", { name: "Als Excel-Datei herunterladen" })).toHaveAttribute(
      "href",
      "/api/budget/export?start=2022",
    );
  });

  it("beschreibt die Laufzeit in Worten und rechnet das Geschäftsjahr eines Tages", () => {
    expect(runtimeText(office)).toBe("ab 2025/26, bis auf Weiteres");
    expect(runtimeText(server)).toBe("einmalig 2026/27");
    expect(runtimeText({ ...office, end_year: 2027, end_year_name: "2027/28" })).toBe(
      "2025/26 bis 2027/28",
    );
    expect(fiscalYearOf("2026-07-31", 8)).toBe(2025);
    expect(fiscalYearOf("2026-08-01", 8)).toBe(2026);
    expect(fiscalYearOf("2026-01-15", 1)).toBe(2026);
    expect(fiscalYearOf("", 8)).toBeNull();
  });
});

describe("Belege", () => {
  const routes = (entries: Invoice[]) => ({
    "GET /api/budget/invoices": {
      year: 2026,
      year_name: "2026/27",
      years: [{ year: 2026, name: "2026/27" }],
      entries,
    },
    "GET /api/budget/partners": [partner],
    "GET /api/budget/items": [office],
    "GET /api/budget/settings": settings,
    "GET /api/budget/contracts": {
      year: 2026,
      years: [{ year: 2026, name: "2026/27" }],
      current_year_name: "2026/27",
      notice_warn_days: 60,
      entries: [],
    },
  });

  it("nennt Dateigrößen in Worten", () => {
    expect(fileSize(300)).toBe("1 KB");
    expect(fileSize(348_160)).toBe("340 KB");
    expect(fileSize(1_258_291)).toBe("1,2 MB");
  });

  it("lädt einen Beleg hoch und lehnt zu große Dateien ab", async () => {
    const calls = stubFetch({
      ...routes([invoice()]),
      "PUT /api/budget/invoices/1/document": invoice({ doc_name: "Rechnung März.pdf" }),
    });
    render(<InvoicesPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "RE-1" }));
    const input = screen.getByLabelText("Beleg zu Rechnung RE-1 hochladen (PDF)");
    const big = new File(["x"], "gross.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 16 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole("alert")).toHaveTextContent("größer als 15 MB");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);

    const file = new File(["%PDF-1.4"], "Rechnung März.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText("Der Beleg zu RE-1 ist gespeichert.")).toBeVisible();
    const upload = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(upload?.[0]).toBe("/api/budget/invoices/1/document");
    expect(new Headers(upload?.[1]?.headers).get("X-Dateiname")).toBe("Rechnung%20M%C3%A4rz.pdf");
    expect(upload?.[1]?.body).toBe(file);
  });

  it("zeigt den Beleg als Download; Lesende können ihn nicht entfernen", async () => {
    stubFetch(routes([invoice({ doc_name: "Rechnung.pdf", doc_size: 348_160 })]));
    const { unmount } = render(<InvoicesPage roles={["Budget.Reader"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "RE-1" }));
    const link = screen.getByRole("link", { name: "Rechnung.pdf" });
    expect(link).toHaveAttribute("href", "/api/budget/invoices/1/document");
    expect(link).toHaveAttribute("download", "Rechnung.pdf");
    expect(screen.getByText(/PDF, 340 KB/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Beleg von Rechnung RE-1 löschen/ })).toBeNull();
    unmount();

    render(<InvoicesPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "RE-1" }));
    expect(screen.getByRole("button", { name: "Beleg von Rechnung RE-1 löschen" })).toBeVisible();
  });
});

describe("Tags", () => {
  it("findet Posten über Name, Konto und Tag", () => {
    expect(itemMatches(office, "")).toBe(true);
    expect(itemMatches(office, " cloud ")).toBe(true);
    expect(itemMatches(office, "6815")).toBe(true);
    expect(itemMatches(office, "Hardware")).toBe(false);
    expect(hasTag(office, "LIZENZEN")).toBe(true);
    expect(hasTag(server, "Cloud")).toBe(false);
  });

  it("rundet den Höchstwert der Achse auf", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1_190_000)).toBe(2_000_000);
    expect(niceMax(4_100)).toBe(5_000);
    expect(niceMax(5_000)).toBe(5_000);
    expect(niceMax(73)).toBe(100);
  });

  it("filtert die Budgetposten nach Tag und Suchtext", async () => {
    stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/partners": [partner],
      "GET /api/budget/tags": [
        { id: 1, tag: "Cloud", items: 1 },
        { id: 2, tag: "Lizenzen", items: 1 },
      ],
    });
    render(<ItemsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("table"));
    expect(screen.getByText(/^2 Budgetposten/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "Cloud" } });
    expect(plain(screen.getByText(/^1 von 2 Budgetposten/).textContent)).toContain(
      "geplant 11.900,00 €",
    );
    expect(table.queryByRole("row", { name: /Server/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Statistik zu „Cloud“" })).toHaveAttribute(
      "href",
      "/budget/statistik?tag=Cloud",
    );

    fireEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));
    expect(table.getByRole("row", { name: /Server/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Budgetposten suchen"), { target: { value: "hardw" } });
    expect(table.queryByRole("row", { name: /Office-Lizenzen/ })).toBeNull();
    expect(table.getByRole("row", { name: /Server/ })).toBeVisible();
  });

  it("wählt Tags am Budgetposten aus der Liste", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/tags": [
        { id: 1, tag: "Cloud", items: 1 },
        { id: 2, tag: "Lizenzen", items: 1 },
        { id: 3, tag: "Projekt", items: 2 },
      ],
      "PUT /api/budget/items/11": office,
      "GET /api/budget/partners": [partner],
    });
    render(<ItemsPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Office-Lizenzen" }));
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const tags = within(screen.getByRole("group", { name: "Tags" }));
    expect(tags.getByRole("button", { name: "Cloud" })).toHaveAttribute("aria-pressed", "true");
    expect(tags.getByRole("button", { name: "Projekt" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tags.getByRole("button", { name: "Projekt" }));
    fireEvent.click(tags.getByRole("button", { name: "Cloud" }));
    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
        name: "Office-Lizenzen",
        tags: ["Lizenzen", "Projekt"],
      }),
    );
  });

  it("verweist auf die Einstellungen, solange es keine Tags gibt", async () => {
    stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/tags": [],
    });
    render(<ItemsPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Posten hinzufügen" }));
    // Tags stehen sichtbar im Formular, nicht unter „Weitere Angaben“.
    expect(screen.getByText(/legt sie unter Einstellungen an/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /Tags verwalten/ })).not.toBeInTheDocument();
  });

  it("zeigt dem Budgetverwalter den Weg zur Tag-Liste", async () => {
    stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/tags": [],
    });
    render(<ItemsPage roles={["Budget.Manager"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Posten hinzufügen" }));
    expect(screen.getByText(/Lege sie zuerst an/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Tags verwalten/ })).toHaveAttribute(
      "href",
      "/budget/einstellungen",
    );
  });

  it("fragt vor dem Wechsel zu den Tags nach, wenn schon etwas eingetragen ist", async () => {
    stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/tags": [],
    });
    render(<ItemsPage roles={["Budget.Manager"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Posten hinzufügen" }));
    fireEvent.change(screen.getByLabelText(/^Bezeichnung/), {
      target: { value: "Neuer Posten" },
    });
    fireEvent.click(screen.getByRole("link", { name: /Tags verwalten/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("geht das verloren");
    expect(window.location.pathname).not.toBe("/budget/einstellungen");
    fireEvent.click(screen.getByRole("button", { name: "Hierbleiben" }));
    expect(screen.getByLabelText(/^Bezeichnung/)).toHaveValue("Neuer Posten");
    fireEvent.click(screen.getByRole("link", { name: /Tags verwalten/ }));
    fireEvent.click(screen.getByRole("button", { name: "Trotzdem zu den Tags" }));
    expect(window.location.pathname).toBe("/budget/einstellungen");
    window.history.replaceState(null, "", "/");
  });
});

describe("Tag-Liste in den Einstellungen", () => {
  it("legt Tags an, benennt sie um und löscht sie", async () => {
    const calls = stubFetch({
      "GET /api/budget/settings": settings,
      "GET /api/budget/tags": [
        { id: 1, tag: "Clod", items: 2 },
        { id: 2, tag: "Lizenzen", items: 0 },
      ],
      "POST /api/budget/tags": { id: 3, tag: "Projekt", items: 0 },
      "PUT /api/budget/tags/1": { id: 1, tag: "Cloud", items: 2 },
      "DELETE /api/budget/tags/2": { deleted: true },
    });
    render(<BudgetSettingsPage />);
    const list = within(await screen.findByRole("list", { name: "Tags" }));
    expect(list.getByText("2 Budgetposten")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Tag anlegen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Namen für den Tag");
    fireEvent.change(screen.getByLabelText("Neuer Tag"), { target: { value: " Projekt " } });
    fireEvent.click(screen.getByRole("button", { name: "Tag anlegen" }));
    expect(await screen.findByText("Der Tag „Projekt“ ist angelegt.")).toBeVisible();
    expect(
      calls.find((call) => call.url === "/api/budget/tags" && call.method === "POST")?.body,
    ).toEqual({ name: "Projekt" });

    fireEvent.click(screen.getByRole("button", { name: "Tag Clod umbenennen" }));
    fireEvent.change(screen.getByLabelText("Neuer Name für Clod"), { target: { value: "Cloud" } });
    fireEvent.click(screen.getByRole("button", { name: "Umbenennen" }));
    expect(await screen.findByText("Der Tag heißt jetzt „Cloud“.")).toBeVisible();
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ name: "Cloud" });

    fireEvent.click(screen.getByRole("button", { name: "Tag Lizenzen löschen" }));
    await confirmDialog("Löschen");
    expect(await screen.findByText("Der Tag „Lizenzen“ ist gelöscht.")).toBeVisible();
  });
});

describe("Statistik", () => {
  const years = [2025, 2026].map((year) => ({ year, name: `${year}/${(year + 1) % 100}` }));
  const statistic = {
    year_label: "Wirtschaftsjahr",
    current_year: 2026,
    tags: ["Cloud"],
    mode: "any",
    years: [
      {
        year: 2025,
        name: "2025/26",
        expected_cents: 1_000_000,
        actual_cents: 1_250_000,
        actual_to_date_cents: 400_000,
      },
      {
        year: 2026,
        name: "2026/27",
        expected_cents: 1_190_000,
        actual_cents: 300_000,
        actual_to_date_cents: 300_000,
      },
    ],
    items: [{ item: office, expected_cents: 2_190_000, actual_cents: 1_550_000 }],
    per_tag: [
      {
        tag: "Cloud",
        years: [
          {
            year: 2025,
            name: "2025/26",
            expected_cents: 1_000_000,
            actual_cents: 1_250_000,
            actual_to_date_cents: 400_000,
          },
          {
            year: 2026,
            name: "2026/27",
            expected_cents: 1_190_000,
            actual_cents: 300_000,
            actual_to_date_cents: 300_000,
          },
        ],
      },
    ],
  };
  const monthNames = [
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
  ];
  const summary = {
    year_label: "Wirtschaftsjahr",
    current_year: 2026,
    year: 2026,
    year_name: "2026/27",
    years: [
      { year: 2027, name: "2027/28" },
      ...years.slice().reverse(),
      { year: 2024, name: "2024/25" },
    ],
    compare: 2025,
    compare_name: "2025/26",
    elapsed_months: 4,
    expected_cents: 10_000_000,
    actual_cents: 2_500_000,
    compare_to_date_cents: 2_000_000,
    compare_actual_cents: 9_000_000,
    months: monthNames.map((name, index) => ({
      name,
      actual_cents: index < 4 ? 625_000 : 0,
      compare_cents: 750_000,
    })),
    accounts: [
      { account: software, expected_cents: 8_000_000, actual_cents: 2_000_000 },
      { account: hardware, expected_cents: 2_000_000, actual_cents: 500_000 },
    ],
    partners: [{ id: 5, name: "Beispiel Software GmbH", actual_cents: 2_500_000 }],
    contracts: {
      yearly_cents: 1_200_000,
      soon_days: 90,
      soon: 1,
      next: [
        {
          id: 7,
          title: "Wartung Server",
          partner_name: "Beispiel Technik AG",
          yearly_cents: 1_200_000,
          notice_deadline: "2026-12-31",
        },
      ],
    },
  };
  const compare = {
    year_label: "Wirtschaftsjahr",
    current_year: 2026,
    year: 2026,
    years: [2022, 2023, 2024, 2025, 2026].map((year) => ({
      year,
      name: `${year}/${(year + 1) % 100}`,
    })),
    cutoff: "2026-11-21",
    accounts: [software, hardware].map((account, index) => ({
      account,
      values: [2022, 2023, 2024, 2025, 2026].map((year) => ({
        year,
        expected_cents: (index + 1) * 1_000_000,
        actual_cents: (index + 1) * 900_000,
        actual_to_date_cents: (index + 1) * 300_000,
      })),
    })),
  };
  const routes = {
    "GET /api/budget/settings": settings,
    "GET /api/budget/statistics/summary": summary,
    "GET /api/budget/statistics/compare": compare,
    "GET /api/budget/tags": [
      { id: 1, tag: "Cloud", items: 1 },
      { id: 2, tag: "Lizenzen", items: 1 },
    ],
    "GET /api/budget/statistics": [{ id: 3, name: "Alles Cloud", tags: ["cloud"], mode: "any" }],
    "POST /api/budget/statistics/query": statistic,
    "POST /api/budget/statistics": { id: 4, name: "Lizenzen genau", tags: [], mode: "all" },
  };

  it("zeigt den Überblick des laufenden Jahres mit Vergleich zum Vorjahr", async () => {
    const calls = stubFetch(routes);
    render(<StatisticsPage roles={["Budget.Reader"]} />);
    expect(await screen.findByRole("tab", { name: "Überblick" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await vi.waitFor(() =>
      expect(
        calls.some((call) => call.url === "/api/budget/statistics/summary?year=2026&compare=2025"),
      ).toBe(true),
    );
    expect(calls.some((call) => call.url === "/api/budget/statistics/compare?year=2026")).toBe(
      true,
    );
    const cards = screen.getAllByRole("definition").map((entry) => plain(entry.textContent));
    expect(cards).toContain("100.000,00 €");
    expect(cards).toContain("25 %");
    expect(cards).toContain("+25 %");
    expect(screen.getByLabelText("Wirtschaftsjahr")).toHaveValue("2026");
    expect(screen.getByLabelText("Vergleich mit")).toHaveValue("2025");
    fireEvent.click(screen.getByRole("button", { name: "Oktober anzeigen" }));
    expect(plain(screen.getByText(/^Ist bis dahin/).textContent)).toContain("18.750,00 €");
    fireEvent.click(screen.getAllByRole("button", { name: "Als Tabelle" })[0]!);
    expect(screen.getByRole("region", { name: "Ist je Monat 2026/27" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Wartung Server" })).toHaveAttribute(
      "href",
      "/budget/vertraege/7",
    );

    fireEvent.change(screen.getByLabelText("Vergleich mit"), { target: { value: "" } });
    await vi.waitFor(() =>
      expect(calls.at(-2)?.url).toBe("/api/budget/statistics/summary?year=2026"),
    );
  });

  it("vergleicht Konten über mehrere Jahre, bis heute oder im ganzen Jahr", async () => {
    stubFetch(routes);
    render(<StatisticsPage roles={["Budget.Reader"]} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Konten und Partner" }));
    const chips = within(screen.getByRole("group", { name: "Jahre im Vergleich" }));
    expect(chips.getByRole("button", { name: /^2026\/27/ })).toBeDisabled();
    expect(chips.getByRole("button", { name: /^2025\/26/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(chips.getByRole("button", { name: /^2024\/25/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Bis heute: Ist bis zum Stichtag in jedem Jahr
    const first = screen.getByRole("button", { name: /^Softwarewartung: / });
    expect(plain(first.getAttribute("aria-label"))).toBe(
      "Softwarewartung: 2026/27 3.000,00 €, 2025/26 3.000,00 €",
    );
    fireEvent.click(chips.getByRole("button", { name: /^2024\/25/ }));
    expect(
      plain(screen.getByRole("button", { name: /^Softwarewartung: / }).getAttribute("aria-label")),
    ).toContain("2024/25 3.000,00 €");
    // Ganzes Jahr: laufendes Jahr erwartet, frühere mit dem Ist
    fireEvent.click(screen.getByRole("button", { name: "Ganzes Jahr" }));
    expect(
      plain(screen.getByRole("button", { name: /^Softwarewartung: / }).getAttribute("aria-label")),
    ).toBe(
      "Softwarewartung: 2026/27 (erwartet) 10.000,00 €, 2025/26 9.000,00 €, 2024/25 9.000,00 €",
    );
    fireEvent.click(screen.getByRole("button", { name: "Nach Art" }));
    expect(screen.getByRole("button", { name: /^Laufende Kosten: / })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Investition: / })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Überlappend" }));
    expect(screen.getByRole("button", { name: /^Investition: / })).toHaveClass("stat-row");
    fireEvent.click(screen.getAllByRole("button", { name: "Als Tabelle" })[0]!);
    const table = within(screen.getByRole("region", { name: "Jahresvergleich nach Art" }));
    expect(plain(table.getByRole("row", { name: /^Investition/ }).textContent)).toContain(
      "18.000,00 €",
    );
    expect(screen.getByRole("link", { name: "Beispiel Software GmbH" })).toHaveAttribute(
      "href",
      "/budget/partner/5",
    );
  });

  it("erklärt den leeren Zustand der Tags", async () => {
    stubFetch({ ...routes, "GET /api/budget/tags": [], "GET /api/budget/statistics": [] });
    render(<StatisticsPage roles={["Budget.Reader"]} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Nach Tags" }));
    expect(await screen.findByText(/Es sind noch keine Tags vergeben/)).toBeVisible();
  });

  it("wertet gewählte Tags je Jahr aus", async () => {
    const calls = stubFetch(routes);
    render(<StatisticsPage roles={["Budget.Reader"]} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Nach Tags" }));
    expect(await screen.findByText("Bitte mindestens einen Tag wählen.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cloud (1)" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.url.endsWith("/query"))?.body).toEqual({
        tags: ["Cloud"],
        mode: "any",
        start: 2022,
      }),
    );
    expect(
      plain((await screen.findByRole("button", { name: /^Cloud: / })).getAttribute("aria-label")),
    ).toBe("Cloud: 2026/27 3.000,00 €, 2025/26 4.000,00 €");
    expect(
      within(screen.getByRole("region", { name: "Budgetposten der Auswahl" })).getByRole("row", {
        name: /Office-Lizenzen/,
      }),
    ).toHaveTextContent("Lizenzen, Cloud");
    // Die Auswahl entspricht einer gespeicherten Statistik; Lesende speichern und löschen nichts.
    expect(screen.getByRole("button", { name: "Alles Cloud" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Statistik speichern" })).toBeNull();
    expect(screen.queryByRole("button", { name: /löschen/i })).toBeNull();
  });

  it("speichert eine Auswahl unter einem Namen und öffnet gespeicherte", async () => {
    const calls = stubFetch(routes);
    render(<StatisticsPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Nach Tags" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lizenzen (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Cloud (1)" }));
    fireEvent.click(screen.getByLabelText(/^Alle gewählten Tags müssen/));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith("/query")).at(-1)?.body).toEqual({
        tags: ["Lizenzen", "Cloud"],
        mode: "all",
        start: 2022,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Statistik speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte einen Namen");
    fireEvent.change(screen.getByLabelText("Auswahl speichern unter"), {
      target: { value: " Lizenzen genau " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Statistik speichern" }));
    expect(
      await screen.findByText("Die Statistik „Lizenzen genau“ ist gespeichert."),
    ).toBeVisible();
    expect(
      calls.find((call) => call.url === "/api/budget/statistics" && call.method === "POST")?.body,
    ).toEqual({ name: "Lizenzen genau", tags: ["Lizenzen", "Cloud"], mode: "all" });

    fireEvent.click(screen.getByRole("button", { name: "Alles Cloud" }));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith("/query")).at(-1)?.body).toEqual({
        tags: ["cloud"],
        mode: "any",
        start: 2022,
      }),
    );
  });
});
