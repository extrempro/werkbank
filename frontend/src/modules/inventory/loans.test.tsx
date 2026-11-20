import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daysFrom,
  filterLoanable,
  loanPath,
  parseLoanPath,
  today,
  type Loan,
  type LoanList,
} from "./api";
import { LoansPage } from "./LoansPage";

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

const OID = "11111111-2222-3333-4444-555555555555";

const loan: Loan = {
  id: 4,
  number: "L-004",
  person_name: "Pia Beispiel",
  issued_on: "2026-11-20",
  due_on: "2026-12-04",
  returned_on: null,
  state: "offen",
  items: 2,
  items_open: 2,
  person_upn: "pia@example.com",
  has_address: true,
  note: "",
  created_at: "2026-11-20T09:00:00Z",
  entries: [
    {
      hardware_id: 7,
      name: "Leih-Notebook 1",
      kind: "Notebook",
      serial: "LN-1",
      inventory_no: null,
      returned_on: null,
    },
    {
      hardware_id: 8,
      name: "Headset 7",
      kind: "Headset",
      serial: "",
      inventory_no: null,
      returned_on: null,
    },
  ],
  messages: [
    {
      kind: "ausgabe",
      kind_label: "Ausgabe",
      channel: "mail",
      status: "gesendet",
      created_at: "2026-11-20T09:00:00Z",
      sent_at: "2026-11-20T09:15:00Z",
    },
  ],
  cases: [],
};

const list: LoanList = {
  loans: [
    {
      id: loan.id,
      number: loan.number,
      person_name: loan.person_name,
      issued_on: loan.issued_on,
      due_on: loan.due_on,
      returned_on: null,
      state: "offen",
      items: 2,
      items_open: 2,
    },
  ],
  open: 1,
  overdue: 0,
  total: 1,
};

describe("Hilfsfunktionen Verleih", () => {
  it("liest die Pfade und rechnet Tage", () => {
    expect(loanPath(4)).toBe("/bestand/verleih/4");
    expect(parseLoanPath("/bestand/verleih")).toEqual({ id: null });
    expect(parseLoanPath("/bestand/verleih/neu")).toEqual({ id: "neu" });
    expect(parseLoanPath("/bestand/verleih/12")).toEqual({ id: 12 });
    expect(parseLoanPath("/bestand/verleih/x")).toBeNull();
    expect(daysFrom("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("sucht verleihbare Geräte", () => {
    const devices = [
      { id: 1, name: "Leih-Notebook 1", kind: "Notebook", serial: "LN-1", inventory_no: null },
      { id: 2, name: "Headset 7", kind: "Headset", serial: "", inventory_no: "INV-9" },
    ];
    expect(filterLoanable(devices, "inv-9").map((item) => item.id)).toEqual([2]);
    expect(filterLoanable(devices, "notebook").map((item) => item.id)).toEqual([1]);
    expect(filterLoanable(devices, " ")).toHaveLength(2);
  });
});

describe("Verleih", () => {
  it("zeigt Lesern die Liste und den Verleih ohne Bearbeitung", async () => {
    stubFetch({
      "GET /api/inventory/loans": list,
      "GET /api/inventory/loans/4": loan,
    });
    render(<LoansPage loanId={4} roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("heading", { name: "Pia Beispiel" })).toBeTruthy();
    expect(screen.getByText("Leih-Notebook 1")).toBeTruthy();
    expect(screen.getByText("verschickt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Neuer Verleih" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rückgabe eintragen" })).toBeNull();
  });

  it("legt einen Verleih mit Person und Geräten an", async () => {
    const calls = stubFetch({
      "GET /api/inventory/loans": { loans: [], open: 0, overdue: 0, total: 0 },
      "GET /api/inventory/loans/available": [
        { id: 7, name: "Leih-Notebook 1", kind: "Notebook", serial: "LN-1", inventory_no: null },
        { id: 8, name: "Headset 7", kind: "Headset", serial: "", inventory_no: null },
      ],
      "GET /api/inventory/people": [{ oid: OID, name: "Pia Beispiel", upn: "pia@example.com" }],
      "POST /api/inventory/loans": loan,
      "GET /api/inventory/loans/4": loan,
    });
    render(<LoansPage loanId="neu" roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Verleihen" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Person");

    fireEvent.change(screen.getByLabelText(/Wer leiht aus/), { target: { value: "pia" } });
    fireEvent.click(await screen.findByRole("button", { name: /Pia Beispiel/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Leih-Notebook 1/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Headset 7/ }));
    fireEvent.change(screen.getByLabelText("Rückgabe bis"), {
      target: { value: daysFrom(today(), 7) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verleihen" }));
    await vi.waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      person: { oid: OID },
      due_on: daysFrom(today(), 7),
      hardware_ids: [7, 8],
      note: "",
    });
  });

  it("trägt die Rückgabe einzelner Geräte ein", async () => {
    const calls = stubFetch({
      "GET /api/inventory/loans": list,
      "GET /api/inventory/loans/4": loan,
      "POST /api/inventory/loans/4/return": {
        ...loan,
        items_open: 1,
        entries: [loan.entries[0], { ...loan.entries[1], returned_on: "2026-11-21" }],
        cases: [{ id: 30, number: "V-030", kind: "rueckgabe", status: "neu" }],
      },
    });
    render(<LoansPage loanId={4} roles={["Bestand.Editor"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rückgabe eintragen" }));
    expect(screen.getByRole("alert").textContent).toContain("Geräte wählen");
    fireEvent.click(screen.getByRole("checkbox", { name: /Headset 7/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rückgabe eintragen" }));
    expect(await screen.findByText(/Rückgabe eingetragen/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /V-030/ })).toBeTruthy();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ hardware_ids: [8] });
  });
});

describe("Suche und Mehr anzeigen", () => {
  it("lädt weitere Verleihe nach und sucht auf dem Server", async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...list.loans[0],
        id: from + index,
        number: `L-${String(from + index).padStart(3, "0")}`,
      }));
    const calls = stubFetch({
      "GET /api/inventory/loans?state=offen": { ...list, loans: page(1, 50), total: 52 },
      "GET /api/inventory/loans?state=offen&offset=50": {
        ...list,
        loans: page(51, 2),
        total: 52,
      },
      "GET /api/inventory/loans?state=offen&q=L-052": { ...list, loans: page(52, 1), total: 1 },
    });
    render(<LoansPage loanId={null} roles={["Bestand.Reader"]} />);
    expect(await screen.findByText("50 von 52")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mehr anzeigen" }));
    expect(await screen.findByText("52 von 52")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mehr anzeigen" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Verleihe durchsuchen"), {
      target: { value: "L-052" },
    });
    expect(await screen.findByText("1 von 1")).toBeTruthy();
    expect(calls.some((call) => call.url.includes("q=L-052"))).toBe(true);
  });
});
