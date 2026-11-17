import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, Item, Partner } from "./api";
import { ImportDetailPage } from "./ImportDetailPage";
import {
  filterRows,
  netFromGross,
  nextOpenRow,
  percent,
  planCandidates,
  type ImportDetail,
  type ImportRow,
} from "./imports";
import { ImportsPage } from "./ImportsPage";

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
      const key = Object.keys(routes)
        .filter((route) => `${method} ${url}` === route)
        .sort((left, right) => right.length - left.length)[0];
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    id: 1,
    row_number: 5,
    invoice_date: "2026-02-03",
    number: "RE-1",
    internal_number: "re.26.001",
    firm: "Beispiel Hardware GmbH",
    description: "Notebooks",
    gross_cents: 119_000,
    account_number: "6050",
    yearly: false,
    hints: [],
    status: "offen",
    invoice_id: null,
    planned_item_id: null,
    partner_match: "neu",
    partner_id: null,
    partner_name: null,
    item_id: 7,
    ...overrides,
  };
}

function detail(overrides: Partial<ImportDetail> = {}): ImportDetail {
  return {
    id: 3,
    file_name: "Budget 2026.xlsx",
    year: 2026,
    year_name: "2026",
    status: "offen",
    rows: 2,
    open: 2,
    taken: 0,
    skipped: 0,
    created_at: "2026-11-17T08:00:00Z",
    created_by: "Bea Budget",
    finished_at: null,
    tax_rate_bp: 1900,
    skipped_rows: 0,
    hints: 1,
    firms: 2,
    new_firms: 1,
    year_label: "Geschäftsjahr",
    accounts: [
      {
        number: "6050",
        name: "Hardware",
        budget_cents: 1_500_000,
        account_id: 1,
        created: true,
        item_id: 7,
        item_name: "Allgemein 2026",
        rows: 2,
      },
    ],
    rows_detail: [
      row(),
      row({
        id: 2,
        row_number: 6,
        firm: "Beispiel Software GmbH",
        description: "Lizenz",
        number: "",
        partner_match: "aehnlich",
        partner_id: 9,
        partner_name: "Beispiel Software GmbH",
        hints: ["Ohne Rechnungsnummer: Übernommen wird die interne Nummer."],
        yearly: true,
      }),
    ],
    ...overrides,
  };
}

const account: Account = {
  id: 1,
  number: "6050",
  name: "Hardware",
  kind: "investition",
  note: "",
  active: true,
};
const general = { id: 7, account_id: 1, name: "Allgemein 2026", active: true } as Item;
const partner = { id: 9, name: "Beispiel Software GmbH", active: true } as Partner;

describe("Hilfen", () => {
  it("rechnet Netto, Anteile und die nächste offene Zeile", () => {
    expect(netFromGross(119_000, 1900)).toBe(100_000);
    expect(netFromGross(107, 700)).toBe(100);
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(1, 0)).toBe(0);
    const rows = [
      row({ id: 1, status: "uebernommen" }),
      row({ id: 2 }),
      row({ id: 3, hints: ["x"] }),
    ];
    expect(nextOpenRow(rows, 2)?.id).toBe(3);
    expect(nextOpenRow(rows, 3)?.id).toBe(2);
    expect(nextOpenRow([row({ status: "uebersprungen" })], 1)).toBeNull();
    expect(filterRows(rows, "offen").map((entry) => entry.id)).toEqual([2, 3]);
    expect(filterRows(rows, "hinweis").map((entry) => entry.id)).toEqual([3]);
    expect(
      planCandidates([
        row({ id: 1, yearly: true, status: "uebernommen" }),
        row({ id: 2, yearly: true, status: "uebernommen", planned_item_id: 4 }),
        row({ id: 3, yearly: true }),
      ]).map((entry) => entry.id),
    ).toEqual([1]);
  });
});

describe("Import", () => {
  it("zeigt die Vorgänge und lädt eine Datei hoch", async () => {
    const draft = detail({ status: "entwurf", id: 4 });
    stubFetch({
      "GET /api/budget/imports": [detail()],
      "POST /api/budget/imports": draft,
      "GET /api/budget/settings": {},
    });
    render(<ImportsPage />);
    const table = within(await screen.findByRole("region", { name: "Import-Vorgänge" }));
    expect(table.getByRole("link", { name: "Budget 2026.xlsx" })).toHaveAttribute(
      "href",
      "/budget/import/3",
    );
    const file = new File(["x"], "Budget 2026.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByLabelText(/^Excel-Datei/), { target: { files: [file] } });
    expect(await screen.findByRole("heading", { name: /Erkanntes prüfen/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Vorgang anlegen und Zeilen abarbeiten" }),
    ).toBeVisible();
  });

  it("übernimmt eine Zeile mit neuem Partner und springt zur nächsten", async () => {
    const after = detail({
      open: 1,
      taken: 1,
      rows_detail: [
        row({ status: "uebernommen", invoice_id: 11 }),
        ...detail().rows_detail.slice(1),
      ],
    });
    const calls = stubFetch({
      "GET /api/budget/imports/3": detail(),
      "GET /api/budget/accounts": [account],
      "GET /api/budget/items": [general],
      "GET /api/budget/partners": [partner],
      "POST /api/budget/imports/3/rows/1/take": after,
      "GET /api/budget/settings": {},
    });
    render(<ImportDetailPage importId={3} />);
    expect(await screen.findByRole("heading", { name: "Zeile 5: Notebooks" })).toBeVisible();
    expect(screen.getByLabelText("Budgetposten")).toHaveValue("7");
    expect(screen.getByText(/Netto: 1\.000,00/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und weiter" }));
    expect(await screen.findByRole("heading", { name: "Zeile 6: Lizenz" })).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      invoice_date: "2026-02-03",
      number: "RE-1",
      internal_number: "re.26.001",
      description: "Notebooks",
      item_id: 7,
      gross_cents: 119_000,
      tax_rate_bp: 1900,
      yearly: false,
      new_partner: "Beispiel Hardware GmbH",
    });
    // Nächste Zeile: Vorschlag des ähnlichen Partners, interne Nummer als Nummer, Hinweis sichtbar
    expect(screen.getByLabelText(/Ähnlicher Partner/)).toBeChecked();
    expect(screen.getByLabelText("Rechnungsnummer")).toHaveValue("re.26.001");
    expect(screen.getByText(/Ohne Rechnungsnummer/)).toBeVisible();
  });

  it("prüft die Eingaben vor dem Übernehmen", async () => {
    stubFetch({
      "GET /api/budget/imports/3": detail(),
      "GET /api/budget/accounts": [account],
      "GET /api/budget/items": [general],
      "GET /api/budget/partners": [partner],
      "GET /api/budget/settings": {},
    });
    render(<ImportDetailPage importId={3} />);
    await screen.findByRole("heading", { name: "Zeile 5: Notebooks" });
    fireEvent.change(screen.getByLabelText(/^Betrag brutto/), { target: { value: "viel" } });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und weiter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Betrag ist nicht lesbar");
    fireEvent.click(screen.getByLabelText("Anderen vorhandenen Partner wählen"));
    fireEvent.change(screen.getByLabelText(/^Betrag brutto/), { target: { value: "10,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen und weiter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte einen Partner wählen");
  });
});
