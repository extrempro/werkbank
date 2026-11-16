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
  hasTag,
  itemMatches,
  niceMax,
  parseEuro,
  parseRate,
  parseTags,
  deadlineBadge,
  partnerRoles,
  share,
  termText,
  type Account,
  type BudgetSettings,
  type Contract,
  type Invoice,
  type Item,
  type Overview,
  type Partner,
} from "./api";
import { BudgetOverviewPage } from "./BudgetOverviewPage";
import { BudgetSettingsPage } from "./BudgetSettingsPage";
import { ContractsPage } from "./ContractsPage";
import { InvoicesPage } from "./InvoicesPage";
import { ItemsPage } from "./ItemsPage";
import { PartnerDetailPage } from "./PartnerDetailPage";
import { PartnersPage } from "./PartnersPage";
import { PlanningPage } from "./PlanningPage";
import { DeleteButton } from "./shared";
import { StatisticsPage } from "./StatisticsPage";

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
  account_id: 1,
  account_number: "6815",
  account_name: "Softwarewartung",
  kind: "laufend",
  name: "Office-Lizenzen",
  partner_id: null,
  partner_name: null,
  note: "",
  tags: ["Lizenzen", "Cloud"],
  active: true,
};
const server: Item = {
  id: 12,
  account_id: 2,
  account_number: "0420",
  account_name: "Hardware",
  kind: "investition",
  name: "Server",
  partner_id: null,
  partner_name: null,
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
    year_status: "entwurf",
    years: [
      { year: 2027, name: "2027/28" },
      { year: 2026, name: "2026/27" },
      { year: 2025, name: "2025/26" },
    ],
    rows: [
      {
        account: hardware,
        plan_cents: 5_000_050,
        previous_cents: null,
        committed_cents: 0,
        actual_cents: 0,
        forecast_cents: 0,
      },
      {
        account: software,
        plan_cents: 1_190_000,
        previous_cents: 1_000_000,
        committed_cents: 600_000,
        actual_cents: 0,
        forecast_cents: 600_000,
      },
    ],
    items: [
      {
        item: server,
        plan_cents: 5_000_050,
        previous_cents: null,
        committed_cents: 0,
        actual_cents: 0,
        forecast_cents: 0,
        contracts: 0,
      },
      {
        item: office,
        plan_cents: 1_190_000,
        previous_cents: 1_000_000,
        committed_cents: 600_000,
        actual_cents: 0,
        forecast_cents: 600_000,
        contracts: 1,
      },
    ],
    plan: { running_cents: 1_190_000, investment_cents: 5_000_050, total_cents: 6_190_050 },
    previous: { running_cents: 1_000_000, investment_cents: 0, total_cents: 1_000_000 },
    committed: { running_cents: 600_000, investment_cents: 0, total_cents: 600_000 },
    actual: { running_cents: 0, investment_cents: 0, total_cents: 0 },
    forecast: { running_cents: 600_000, investment_cents: 0, total_cents: 600_000 },
    open_invoices: 0,
    committed_contracts: 1,
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
  it("zeigt Plan, gebunden, frei und Vorjahr je Posten und lädt ein anderes Jahr", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/partners": [partner],
    });
    render(<ItemsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("region", { name: "Budgetposten 2026/27" }));
    const row = table.getByRole("row", { name: /Office-Lizenzen/ });
    expect(plain(row.textContent)).toContain("11.900,00 €");
    expect(plain(row.textContent)).toContain("5.900,00 €");
    expect(plain(row.textContent)).toContain("10.000,00 €");
    expect(row).toHaveTextContent("1 Vertrag");
    expect(table.getByRole("row", { name: /Server/ })).toHaveTextContent("stillgelegt");
    expect(plain(table.getByRole("row", { name: /^Summe/ }).textContent)).toContain("61.900,50 €");
    // Lesende Rollen planen nicht und legen nichts an.
    expect(screen.queryByRole("button", { name: "Plan bearbeiten" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Budgetposten anlegen" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Wirtschaftsjahr"), { target: { value: "2025" } });
    await vi.waitFor(() =>
      expect(calls.map((call) => call.url)).toContain("/api/budget/overview?year=2025"),
    );
  });

  it("lässt den Budgetverwalter den Plan ändern und prüft die Eingabe", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/partners": [partner],
      "PUT /api/budget/plans/2026": overview(),
    });
    render(<ItemsPage roles={["Budget.Manager"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Plan bearbeiten" }));
    const field = screen.getByRole("textbox", { name: /Plan für Office-Lizenzen/ });
    expect(field).toHaveValue("11900,00");

    fireEvent.change(field, { target: { value: "zwölftausend" } });
    fireEvent.click(screen.getByRole("button", { name: "Plan speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ist nicht lesbar");
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);

    fireEvent.change(field, { target: { value: "12.500,00" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Plan für Server/ }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan speichern" }));
    expect(await screen.findByText("Der Plan ist gespeichert.")).toBeVisible();
    // Gesendet wird nur, was sich geändert hat; ein leeres Feld entfernt den Plan.
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      entries: [
        { item_id: 12, amount_cents: null },
        { item_id: 11, amount_cents: 1_250_000 },
      ],
    });
    expect(screen.queryByRole("textbox", { name: /Plan für/ })).toBeNull();
  });

  it("legt einen Posten an und ändert einen", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/partners": [partner],
      "POST /api/budget/items": { ...office, id: 13, name: "Sonstige Software" },
      "PUT /api/budget/items/12": { ...server, active: true },
    });
    render(<ItemsPage roles={["Budget.Editor"]} />);
    await screen.findByRole("region", { name: "Budgetposten 2026/27" });
    fireEvent.click(screen.getByRole("button", { name: "Budgetposten anlegen" }));
    fireEvent.click(screen.getByRole("button", { name: "Budgetposten speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Konto wählen");
    // Stillgelegte Konten stehen bei einem neuen Posten nicht zur Wahl.
    expect(within(screen.getByLabelText("Konto")).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Konto"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Bezeichnung"), {
      target: { value: "Sonstige Software" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Budgetposten speichern" }));
    expect(await screen.findByText("Sonstige Software ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      account_id: 1,
      name: "Sonstige Software",
      partner_id: null,
      note: "",
      tags: [],
      active: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Server bearbeiten" }));
    fireEvent.click(screen.getByLabelText("Budgetposten ist aktiv"));
    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
        account_id: 2,
        name: "Server",
        active: true,
      }),
    );
  });
});

describe("Übersicht", () => {
  it("erklärt den leeren Zustand", async () => {
    stubFetch({
      "GET /api/budget/overview": overview({
        rows: [],
        plan: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        items: [],
        committed: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        actual: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        forecast: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        open_invoices: 0,
        committed_contracts: 0,
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
    item_id: 11,
    item_name: "Office-Lizenzen",
    account_number: "6815",
    account_name: "Softwarewartung",
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

describe("Übersicht nach dem Entwurf", () => {
  it("zeigt Kennzahlen, Balken, Termine und Handlungsbedarf", async () => {
    stubFetch({
      "GET /api/budget/overview": overview({
        rows: [
          {
            account: hardware,
            plan_cents: null,
            previous_cents: null,
            committed_cents: 119_000,
            actual_cents: 0,
            forecast_cents: 119_000,
          },
          {
            account: software,
            plan_cents: 500_000,
            previous_cents: 1_000_000,
            committed_cents: 600_000,
            actual_cents: 0,
            forecast_cents: 600_000,
          },
        ],
        plan: { running_cents: 500_000, investment_cents: 0, total_cents: 500_000 },
        committed: { running_cents: 600_000, investment_cents: 119_000, total_cents: 719_000 },
        actual: { running_cents: 0, investment_cents: 0, total_cents: 0 },
        forecast: { running_cents: 600_000, investment_cents: 119_000, total_cents: 719_000 },
        open_invoices: 0,
        committed_contracts: 2,
      }),
      "GET /api/budget/contracts": {
        current_year_name: "2026/27",
        notice_warn_days: 60,
        entries: [
          contract(),
          contract({ id: 2, title: "Backup", dpa_status: "fehlt", days_to_deadline: 400 }),
        ],
      },
    });
    render(<BudgetOverviewPage roles={["Budget.Reader"]} />);
    expect(await screen.findByText("Durch Verträge gebunden", { selector: "dt" })).toBeVisible();
    expect(screen.getByText(/2 Verträge/)).toBeVisible();
    expect(plain(screen.getByText(/über Plan$/, { selector: "dd" }).textContent)).toBe(
      "2.190,00 € über Plan",
    );
    expect(
      screen.getByRole("img", { name: /Softwarewartung: Ist 0 %, Prognose 100 % des Plans/ }),
    ).toBeInTheDocument();

    const dates = within(
      await screen.findByRole("region", { name: /Kündigungstermine – nächste 120 Tage/ }),
    );
    expect(dates.getByRole("link", { name: "Wartung Zeiterfassung" })).toHaveAttribute(
      "href",
      "/budget/vertraege/1",
    );
    expect(screen.getByText(/Nur Lesezugriff/)).toBeVisible();
    expect(dates.getByText("noch 15 Tage")).toBeVisible();
    expect(dates.queryByText("Backup")).toBeNull();

    const needs = within(screen.getByRole("region", { name: "Handlungsbedarf" }));
    expect(plain(needs.getByText(/6815 Softwarewartung: Prognose liegt/).textContent)).toContain(
      "1.000,00 € über Plan",
    );
    expect(needs.getByText(/0420 Hardware: .* aber kein Plan/)).toBeVisible();
    expect(needs.getByText("Backup: Auftragsverarbeitungsvertrag fehlt.")).toBeVisible();
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

  it("zeigt laufende Verträge mit Termin, Rechnungssteller und AVV", async () => {
    stubFetch(routes);
    render(<ContractsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("region", { name: "Verträge" }));
    expect(table.getAllByRole("row")).toHaveLength(2);
    const row = table.getByRole("row", { name: /^Wartung Zeiterfassung/ });
    expect(row).toHaveTextContent("abweichend");
    expect(row).toHaveTextContent("noch 15 Tage");
    expect(plain(row.textContent)).toContain("6.000,00 €");
    expect(screen.getByText("1 Termin in 120 Tagen")).toBeVisible();
    expect(screen.getByText("0 AVV fehlt")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Vertrag anlegen" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Alle (2)" }));
    expect(table.getByRole("row", { name: /^Altvertrag/ })).toHaveTextContent("beendet");
  });

  it("zeigt einen Vertrag mit Daten, Fristen und Zuordnung", async () => {
    stubFetch(routes);
    const { unmount } = render(<ContractsPage roles={["Budget.Reader"]} selectedId={1} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Wartung Zeiterfassung" }),
    ).toBeVisible();
    const data = within(screen.getByRole("region", { name: "Vertragsdaten" }));
    expect(data.getByText("Beispiel Distribution AG")).toBeVisible();
    expect(data.getByText("1 Monate zum Laufzeitende")).toBeVisible();
    expect(data.getByText("19 %")).toBeVisible();
    const dates = within(screen.getByRole("region", { name: "Fristen" }));
    expect(dates.getByText("30.11.2026")).toBeVisible();
    expect(plain(dates.getByText(/^Verlängert sich um 12 Monate/).textContent)).toContain(
      "6.000,00 € im Jahr",
    );
    expect(
      within(screen.getByRole("region", { name: "Zuordnung zum Budget" })).getByText(
        "Office-Lizenzen",
      ),
    ).toBeVisible();
    expect(screen.getByText("Kündigung: noch 15 Tage")).toBeVisible();
    expect(screen.getByRole("link", { name: /Zurück zu den Verträgen/ })).toHaveAttribute(
      "href",
      "/budget/vertraege",
    );
    unmount();

    render(<ContractsPage roles={["Budget.Reader"]} selectedId={99} />);
    expect(await screen.findByText(/Diesen Vertrag gibt es nicht/)).toBeVisible();
  });

  it("prüft die Eingaben und legt einen Vertrag an", async () => {
    const calls = stubFetch({ ...routes, "POST /api/budget/contracts": contract({ id: 3 }) });
    render(<ContractsPage roles={["Budget.Manager"]} />);
    await screen.findByRole("region", { name: "Verträge" });
    fireEvent.click(screen.getByRole("button", { name: "Vertrag anlegen" }));
    fireEvent.click(screen.getByRole("button", { name: "Vertrag speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bezeichnung");

    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "Neuer Vertrag" } });
    fireEvent.change(screen.getByLabelText("Vertragspartner"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Rechnungssteller"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Budgetposten"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText(/^Betrag je Zahlung/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Vertrag speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Betrag ist nicht lesbar");

    fireEvent.change(screen.getByLabelText(/^Betrag je Zahlung/), { target: { value: "500,00" } });
    expect(plain(screen.getByText(/^Brutto je Zahlung/).textContent)).toContain("595,00 €");
    fireEvent.change(screen.getByLabelText(/^Steuersatz/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Vertrag speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Steuersatz ist nicht lesbar");
    fireEvent.change(screen.getByLabelText(/^Steuersatz/), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Beginn"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^Verlängert sich um/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Vertrag speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("nur bei einem Ende der Laufzeit");

    fireEvent.change(screen.getByLabelText(/^Ende der Laufzeit/), {
      target: { value: "2026-12-31" },
    });
    fireEvent.change(screen.getByLabelText(/^Kündigungsfrist/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^Auftragsverarbeitungsvertrag/), {
      target: { value: "fehlt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Vertrag speichern" }));
    expect(await screen.findByText("Wartung Zeiterfassung ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      title: "Neuer Vertrag",
      partner_id: 1,
      item_id: 11,
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
  });
});

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 1,
    invoicer_id: 1,
    invoicer_name: "Beispiel Software GmbH",
    number: "RE-1",
    internal_number: "re.26.0001",
    invoice_date: "2026-10-12",
    item_id: 11,
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
        contract_id: null,
        contract_title: null,
        status: "gebucht",
        booked_by_name: "Bodo Budget",
      }),
    ],
  };
  const routes = {
    "GET /api/budget/invoices": list,
    "GET /api/budget/partners": [partner, distributor],
    "GET /api/budget/items": [office, server],
    "GET /api/budget/contracts": {
      current_year_name: "2026/27",
      notice_warn_days: 60,
      entries: [contract()],
    },
  };

  it("zeigt Lesenden die Liste ohne Aktionen", async () => {
    stubFetch(routes);
    render(<InvoicesPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("region", { name: "Rechnungen 2026/27" }));
    const row = table.getByRole("row", { name: /RE-1/ });
    expect(row).toHaveTextContent("zu prüfen");
    expect(row).toHaveTextContent("erfasst: Ida IT");
    expect(row).toHaveTextContent("jährlich");
    expect(plain(row.textContent)).toContain("1.190,00 €");
    expect(table.getByRole("row", { name: /RE-2/ })).toHaveTextContent("ohne Vertrag");
    expect(screen.getByText("1 zu prüfen")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Rechnung erfassen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /prüfen und buchen/ })).toBeNull();
  });

  it("lässt die IT nur Offenes ändern und den Budgetverwalter buchen und löschen", async () => {
    const calls = stubFetch({
      ...routes,
      "POST /api/budget/invoices/1/book": invoice({ status: "gebucht" }),
      "DELETE /api/budget/invoices/2": { deleted: true },
    });
    const { unmount } = render(<InvoicesPage roles={["Budget.Editor"]} />);
    await screen.findByRole("region", { name: "Rechnungen 2026/27" });
    expect(screen.getByText("wartet auf Budgetverwalter")).toBeVisible();
    expect(screen.getByRole("button", { name: "Rechnung RE-1 bearbeiten" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Rechnung RE-2 bearbeiten" })).toBeNull();
    unmount();

    render(<InvoicesPage roles={["Budget.Manager"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rechnung RE-1 prüfen und buchen" }));
    expect(await screen.findByText(/RE-1 ist geprüft und gebucht/)).toBeVisible();
    expect(calls.some((call) => call.url === "/api/budget/invoices/1/book")).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: "Rechnung RE-2 löschen" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Wirklich löschen" }));
    expect(await screen.findByText("Rechnung RE-2 ist gelöscht.")).toBeVisible();
  });

  it("prüft die Eingaben und erfasst eine Rechnung", async () => {
    const calls = stubFetch({
      ...routes,
      "POST /api/budget/invoices": invoice({ id: 3, number: "RE-3" }),
    });
    render(<InvoicesPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rechnung erfassen" }));
    fireEvent.click(screen.getByRole("button", { name: "Rechnung speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Rechnungssteller und Budgetposten");

    fireEvent.change(screen.getByLabelText("Rechnungssteller"), { target: { value: "2" } });
    // Der Vertrag bringt seinen Budgetposten mit.
    fireEvent.change(screen.getByLabelText(/^Vertrag/), { target: { value: "1" } });
    expect(screen.getByLabelText("Budgetposten")).toHaveValue("11");
    fireEvent.change(screen.getByLabelText("Rechnungsnummer"), { target: { value: " RE-3 " } });
    fireEvent.change(screen.getByLabelText("Rechnungsdatum"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText(/^Betrag netto/), { target: { value: "1.000,00" } });
    expect(plain(screen.getByText(/^Gerechnetes Brutto/).textContent)).toContain("1.190,00 €");
    fireEvent.change(screen.getByLabelText(/^Brutto laut Rechnung/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Rechnung speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Das Brutto ist nicht lesbar");

    fireEvent.change(screen.getByLabelText(/^Brutto laut Rechnung/), {
      target: { value: "1190,02" },
    });
    fireEvent.click(screen.getByLabelText("Gehört zu einem Projekt"));
    fireEvent.click(screen.getByRole("button", { name: "Rechnung speichern" }));
    expect(
      await screen.findByText(/RE-3 ist gespeichert und wartet auf die Prüfung/),
    ).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      invoicer_id: 2,
      number: "RE-3",
      internal_number: "",
      invoice_date: "2026-11-02",
      item_id: 11,
      contract_id: 1,
      net_cents: 100_000,
      tax_rate_bp: 1900,
      gross_cents: 119_002,
      description: "",
      is_project: true,
      is_yearly: false,
    });
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
    fireEvent.click(
      screen.getByRole("button", {
        name: "Wirklich mit „Beispiel Software GmbH“ zusammenlegen",
      }),
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Doch nicht" }));
    expect(screen.queryByRole("button", { name: "Wirklich löschen" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Vertrag Wartung löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Wirklich löschen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Das Löschen hat nicht geklappt.");
    expect(onDeleted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Vertrag Wartung löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Wirklich löschen" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Wirklich löschen" }));
    expect(await screen.findByText("Beispiel Distribution AG ist gelöscht.")).toBeVisible();
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    expect(screen.queryByRole("link", { name: "Beispiel Distribution AG" })).toBeNull();
  });
});

describe("Planung", () => {
  it("meldet ein Vorhaben mit Partner und Plan an und gibt das Jahr frei", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [software],
      "GET /api/budget/partners": [partner],
      "POST /api/budget/items": { ...office, id: 14, name: "Projekt Ablage" },
      "PUT /api/budget/years/2026/status": { year: 2026, name: "2026/27", status: "freigegeben" },
    });
    render(<ItemsPage roles={["Budget.Manager"]} />);
    expect(await screen.findByText("Plan 2026/27: Entwurf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Budgetposten anlegen" }));
    fireEvent.change(screen.getByLabelText("Konto"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Bezeichnung"), { target: { value: "Projekt Ablage" } });
    fireEvent.change(screen.getByLabelText(/^Üblicher Partner/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/^Plan 2026\/27/), { target: { value: "viel" } });
    fireEvent.click(screen.getByRole("button", { name: "Budgetposten speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Planbetrag ist nicht lesbar");
    fireEvent.change(screen.getByLabelText(/^Plan 2026\/27/), { target: { value: "15.000,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Budgetposten speichern" }));
    expect(await screen.findByText("Projekt Ablage ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      account_id: 1,
      name: "Projekt Ablage",
      partner_id: 1,
      note: "",
      tags: [],
      active: true,
      plan_year: 2026,
      plan_cents: 1_500_000,
    });

    fireEvent.click(screen.getByRole("button", { name: "Plan freigeben" }));
    expect(await screen.findByText("Der Plan 2026/27 ist freigegeben.")).toBeVisible();
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ status: "freigegeben" });
  });

  it("sperrt den Plan eines freigegebenen Jahrs", async () => {
    stubFetch({
      "GET /api/budget/overview": overview({ year_status: "freigegeben" }),
      "GET /api/budget/accounts": [software],
      "GET /api/budget/partners": [partner],
    });
    render(<ItemsPage roles={["Budget.Manager"]} />);
    expect(await screen.findByText("Plan 2026/27: freigegeben")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Plan bearbeiten" })).toBeNull();
    expect(screen.getByRole("button", { name: "Freigabe aufheben" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Budgetposten anlegen" }));
    expect(screen.queryByLabelText(/^Plan 2026\/27/)).toBeNull();
  });

  it("plant mehrere Jahre und übernimmt Vorschläge aus Verträgen", async () => {
    const planning = {
      year_label: "Wirtschaftsjahr",
      years: [
        { year: 2026, name: "2026/27", status: "freigegeben" },
        { year: 2027, name: "2027/28", status: "entwurf" },
        { year: 2028, name: "2028/29", status: "entwurf" },
      ],
      rows: [
        {
          item: office,
          plans: { "2026": 600_000, "2027": 600_000 },
          proposals: { "2026": 600_000, "2027": 600_000, "2028": 300_000 },
        },
      ],
    };
    const calls = stubFetch({
      "GET /api/budget/planning": planning,
      "PUT /api/budget/plans/": overview(),
    });
    const { unmount } = render(<PlanningPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("region", { name: "Mehrjahresplanung" }));
    expect(plain(table.getByRole("row", { name: /^Office-Lizenzen/ }).textContent)).toContain(
      "Verträge: 3.000,00 €",
    );
    expect(plain(table.getByRole("row", { name: /^Summe Plan/ }).textContent)).toContain(
      "6.000,00 €",
    );
    expect(screen.queryByRole("button", { name: "Plan bearbeiten" })).toBeNull();
    unmount();

    render(<PlanningPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Plan bearbeiten" }));
    // Das freigegebene Jahr hat kein Eingabefeld.
    expect(screen.queryByRole("textbox", { name: /im 2026\/27/ })).toBeNull();
    const next = screen.getByRole("textbox", { name: /Office-Lizenzen im 2027\/28/ });
    const later = screen.getByRole("textbox", { name: /Office-Lizenzen im 2028\/29/ });
    expect(next).toHaveValue("6000,00");
    expect(later).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Leere Felder aus Verträgen füllen" }));
    expect(later).toHaveValue("3000,00");
    expect(next).toHaveValue("6000,00");
    fireEvent.change(next, { target: { value: "6.500,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Plan speichern" }));
    expect(await screen.findByText("Der Plan ist gespeichert.")).toBeVisible();
    const saved = calls.filter((call) => call.method === "PUT");
    expect(saved.map((call) => call.url).sort()).toEqual([
      "/api/budget/plans/2027",
      "/api/budget/plans/2028",
    ]);
    expect(saved.find((call) => call.url.endsWith("2027"))?.body).toEqual({
      entries: [{ item_id: 11, amount_cents: 650_000 }],
    });
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
    "GET /api/budget/contracts": {
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
    const input = await screen.findByLabelText("Beleg zu Rechnung RE-1 hochladen (PDF)");
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
    const link = await screen.findByRole("link", { name: "Rechnung.pdf" });
    expect(link).toHaveAttribute("href", "/api/budget/invoices/1/document");
    expect(link).toHaveAttribute("download", "Rechnung.pdf");
    expect(screen.getByText("PDF, 340 KB")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Beleg von Rechnung RE-1 löschen/ })).toBeNull();
    unmount();

    render(<InvoicesPage roles={["Budget.Editor"]} />);
    expect(
      await screen.findByRole("button", { name: "Beleg von Rechnung RE-1 löschen" }),
    ).toBeVisible();
  });
});

describe("Tags", () => {
  it("liest die Eingabe als Liste ohne Doppelte und prüft Länge und Anzahl", () => {
    expect(parseTags(" Cloud ,  Lizenzen ,cloud,, Microsoft  365 ")).toEqual([
      "Cloud",
      "Lizenzen",
      "Microsoft 365",
    ]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags("x".repeat(31))).toMatch(/zu lang/);
    expect(parseTags("a,b,c,d,e,f,g,h,i,j,k")).toMatch(/höchstens 10 Tags/);
  });

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
        { tag: "Cloud", items: 1 },
        { tag: "Lizenzen", items: 1 },
      ],
    });
    render(<ItemsPage roles={["Budget.Reader"]} />);
    const table = within(await screen.findByRole("region", { name: "Budgetposten 2026/27" }));
    expect(screen.getByText("2 Budgetposten")).toBeVisible();
    fireEvent.click(table.getByRole("button", { name: "Nach Tag Cloud filtern" }));
    expect(screen.getByText("1 von 2 Budgetposten")).toBeVisible();
    expect(table.queryByRole("row", { name: /Server/ })).toBeNull();
    expect(screen.getByLabelText("Tag")).toHaveValue("Cloud");
    expect(plain(table.getByRole("row", { name: /^Summe der gezeigten/ }).textContent)).toContain(
      "11.900,00 €",
    );
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

  it("speichert Tags am Budgetposten und schlägt vergebene vor", async () => {
    const calls = stubFetch({
      "GET /api/budget/overview": overview(),
      "GET /api/budget/accounts": [hardware, software],
      "GET /api/budget/partners": [partner],
      "GET /api/budget/tags": [
        { tag: "Cloud", items: 1 },
        { tag: "Projekt", items: 2 },
      ],
      "PUT /api/budget/items/11": office,
    });
    render(<ItemsPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Office-Lizenzen bearbeiten" }));
    const field = screen.getByLabelText(/^Tags/);
    expect(field).toHaveValue("Lizenzen, Cloud");
    // Vorgeschlagen wird nur, was noch nicht im Feld steht.
    const proposals = within(screen.getByRole("group", { name: "Schon vergebene Tags übernehmen" }));
    expect(proposals.queryByRole("button", { name: "Cloud" })).toBeNull();
    fireEvent.click(proposals.getByRole("button", { name: "Projekt" }));
    expect(field).toHaveValue("Lizenzen, Cloud, Projekt");

    fireEvent.change(field, { target: { value: "x".repeat(31) } });
    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("zu lang");
    fireEvent.change(field, { target: { value: "Lizenzen, Projekt, projekt" } });
    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
        name: "Office-Lizenzen",
        tags: ["Lizenzen", "Projekt"],
      }),
    );
  });
});

describe("Statistik", () => {
  const statistic = {
    year_label: "Wirtschaftsjahr",
    current_year: 2026,
    tags: ["Cloud"],
    mode: "any",
    years: [
      { year: 2025, name: "2025/26", plan_cents: 1_000_000, actual_cents: 1_250_000 },
      { year: 2026, name: "2026/27", plan_cents: 1_190_000, actual_cents: 300_000 },
    ],
    items: [{ item: office, plan_cents: 2_190_000, actual_cents: 1_550_000 }],
  };
  const routes = {
    "GET /api/budget/settings": settings,
    "GET /api/budget/tags": [
      { tag: "Cloud", items: 1 },
      { tag: "Lizenzen", items: 1 },
    ],
    "GET /api/budget/statistics": [{ id: 3, name: "Alles Cloud", tags: ["cloud"], mode: "any" }],
    "POST /api/budget/statistics/query": statistic,
    "POST /api/budget/statistics": { id: 4, name: "Lizenzen genau", tags: [], mode: "all" },
  };

  it("erklärt den leeren Zustand", async () => {
    stubFetch({ ...routes, "GET /api/budget/tags": [], "GET /api/budget/statistics": [] });
    render(<StatisticsPage roles={["Budget.Reader"]} />);
    expect(await screen.findByText(/Es sind noch keine Tags vergeben/)).toBeVisible();
  });

  it("wertet gewählte Tags aus und zeigt Plan und Ist je Jahr", async () => {
    const calls = stubFetch(routes);
    render(<StatisticsPage roles={["Budget.Reader"]} />);
    expect(await screen.findByText("Bitte mindestens einen Tag wählen.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cloud (1)" }));
    const years = within(
      await screen.findByRole("region", { name: "Plan und Ist je Wirtschaftsjahr" }),
    );
    expect(calls.find((call) => call.url.endsWith("/query"))?.body).toEqual({
      tags: ["Cloud"],
      mode: "any",
    });
    const before = years.getByRole("row", { name: /^2025\/26/ });
    expect(plain(before.textContent)).toContain("12.500,00 €");
    expect(plain(before.textContent)).toContain("2.500,00 €");
    expect(years.getByRole("row", { name: /^2026\/27/ })).toHaveTextContent("läuft");
    expect(plain(years.getByRole("row", { name: /^Summe/ }).textContent)).toContain("21.900,00 €");
    expect(
      screen.getByRole("img", { name: /^Plan und Ist je Wirtschaftsjahr/ }),
    ).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Ausblick: nächste fünf Jahre" }));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith("/query")).at(-1)?.body).toEqual({
        tags: ["Cloud"],
        mode: "any",
        start: 2026,
      }),
    );
  });

  it("speichert eine Auswahl unter einem Namen und öffnet gespeicherte", async () => {
    const calls = stubFetch(routes);
    render(<StatisticsPage roles={["Budget.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Lizenzen (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Cloud (1)" }));
    fireEvent.click(screen.getByLabelText(/^Alle gewählten Tags müssen/));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith("/query")).at(-1)?.body).toEqual({
        tags: ["Lizenzen", "Cloud"],
        mode: "all",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Statistik speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte einen Namen");
    fireEvent.change(screen.getByLabelText("Auswahl speichern unter"), {
      target: { value: " Lizenzen genau " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Statistik speichern" }));
    expect(await screen.findByText("Die Statistik „Lizenzen genau“ ist gespeichert.")).toBeVisible();
    expect(calls.find((call) => call.url === "/api/budget/statistics" && call.method === "POST")?.body)
      .toEqual({ name: "Lizenzen genau", tags: ["Lizenzen", "Cloud"], mode: "all" });

    fireEvent.click(screen.getByRole("button", { name: "Alles Cloud" }));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith("/query")).at(-1)?.body).toEqual({
        tags: ["cloud"],
        mode: "any",
      }),
    );
  });
});
