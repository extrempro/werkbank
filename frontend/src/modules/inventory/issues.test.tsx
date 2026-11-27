import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmIssuePage } from "../../pages/ConfirmIssuePage";
import { IssuesPage } from "./IssuesPage";
import {
  filterFree,
  fromLocalInput,
  issuePath,
  parseConfirmPath,
  parseIssuePath,
  parseReturnPath,
  returnPath,
  toLocalInput,
  type Issue,
  type Return,
} from "./issuesApi";
import { ReturnsPage } from "./ReturnsPage";

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

const issue: Issue = {
  id: 3,
  number: "A-003",
  person_name: "Pia Beispiel",
  position: "ST-001 Technik",
  reason: "neu",
  state: "vorbereitung",
  items: 1,
  tasks: 2,
  tasks_done: 1,
  created_at: "2026-11-27T08:00:00Z",
  handed_at: null,
  person_upn: "pia@example.com",
  has_address: true,
  position_id: 5,
  condition: "neuwertig",
  condition_note: "",
  attach_rules: true,
  notify_teams: false,
  confirm_method: "unterschrift",
  pickup_place: "",
  pickup_at: null,
  link_expires_at: null,
  has_signature: false,
  signed_name: "",
  confirmed_via: "",
  rules_text: "Bitte pfleglich behandeln.",
  ready_at: null,
  entries: [
    {
      hardware_id: 7,
      name: "Notebook 1",
      kind: "Notebook",
      serial: "NB-1",
      inventory_no: null,
      accessories: ["Netzteil"],
    },
  ],
  task_list: [
    {
      id: 1,
      label: "Konto anlegen",
      hardware_id: null,
      done: true,
      done_at: "2026-11-27T08:10:00Z",
    },
    { id: 2, label: "Notebook 1: Intune", hardware_id: 7, done: false, done_at: null },
  ],
  messages: [],
};

const issueList = {
  issues: [issue],
  preparing: 1,
  ready: 0,
  total: 1,
};

describe("Hilfsfunktionen Ausgabe und Rückgabe", () => {
  it("liest Pfade und Zeiten", () => {
    expect(issuePath(3)).toBe("/bestand/ausgaben/3");
    expect(parseIssuePath("/bestand/ausgaben")).toEqual({ id: null });
    expect(parseIssuePath("/bestand/ausgaben/neu")).toEqual({ id: "neu" });
    expect(parseIssuePath("/bestand/ausgaben/12")).toEqual({ id: 12 });
    expect(parseIssuePath("/bestand/ausgaben/x")).toBeNull();
    expect(returnPath(4)).toBe("/bestand/rueckgaben/4");
    expect(parseReturnPath("/bestand/rueckgaben/4")).toEqual({ id: 4 });
    expect(parseReturnPath("/bestand/rueckgaben/neu")).toBeNull();
    expect(parseConfirmPath(`/bestaetigen/${"a".repeat(43)}`)).toBe("a".repeat(43));
    expect(parseConfirmPath("/bestaetigen/kurz")).toBeNull();
    expect(parseConfirmPath("/bestaetigen/<script>aaaaaaaaaaaaaaaaaaaa")).toBeNull();
    const local = toLocalInput("2026-12-01T08:30:00Z");
    expect(fromLocalInput(local)).toBe("2026-12-01T08:30:00.000Z");
    expect(fromLocalInput("")).toBeNull();
  });

  it("sucht freie Geräte", () => {
    const devices = [
      {
        id: 1,
        name: "Notebook 1",
        kind_id: 1,
        kind: "Notebook",
        serial: "NB-1",
        inventory_no: null,
        accessories: [],
      },
      {
        id: 2,
        name: "Headset",
        kind_id: 2,
        kind: "Headset",
        serial: "",
        inventory_no: "INV-9",
        accessories: [],
      },
    ];
    expect(filterFree(devices, "inv-9").map((d) => d.id)).toEqual([2]);
    expect(filterFree(devices, " ")).toHaveLength(2);
  });
});

describe("Ausgabe", () => {
  it("zeigt Lesern die Vorbereitung ohne Bearbeitung", async () => {
    stubFetch({
      "GET /api/inventory/issues": issueList,
      "GET /api/inventory/issues/3": issue,
    });
    render(<IssuesPage issueId={3} roles={["Bestand.Reader"]} />);
    expect(await screen.findByRole("heading", { name: "Pia Beispiel" })).toBeTruthy();
    expect(screen.getByText("1 von 2 erledigt")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Notebook 1: Intune" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: "Neue Ausgabe" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Vorbereitung abschließen/ })).toBeNull();
  });

  it("hakt ab und schließt die Vorbereitung erst ab, wenn alles erledigt ist", async () => {
    const done = {
      ...issue,
      tasks_done: 2,
      task_list: issue.task_list.map((task) => ({ ...task, done: true })),
    };
    const calls = stubFetch({
      "GET /api/inventory/issues": issueList,
      "GET /api/inventory/issues/3": issue,
      "PUT /api/inventory/issues/3/tasks/2": done,
      "POST /api/inventory/issues/3/ready": { ...done, state: "bereit" },
    });
    render(<IssuesPage issueId={3} roles={["Bestand.Editor"]} />);
    const finish = await screen.findByRole("button", {
      name: "Vorbereitung abschließen und benachrichtigen",
    });
    expect(finish).toHaveProperty("disabled", true);
    expect(screen.getByText(/Noch 1 offen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Notebook 1: Intune" }));
    await vi.waitFor(() => expect(finish).toHaveProperty("disabled", false));
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ done: true });
    fireEvent.click(finish);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Pia Beispiel bekommt jetzt eine Mail");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Abschließen und benachrichtigen" }),
    );
    expect(await screen.findByRole("heading", { name: "Übergabe" })).toBeTruthy();
  });

  it("übergibt mit getipptem Namen statt Unterschrift", async () => {
    const ready = { ...issue, state: "bereit" as const };
    const calls = stubFetch({
      "GET /api/inventory/issues": issueList,
      "GET /api/inventory/issues/3": ready,
      "POST /api/inventory/issues/3/handover": {
        ...ready,
        state: "uebergeben",
        confirmed_via: "unterschrift",
        signed_name: "Pia Beispiel",
        handed_at: "2026-11-27T10:00:00Z",
      },
    });
    render(<IssuesPage issueId={3} roles={["Bestand.Editor"]} />);
    const handover = await screen.findByRole("region", { name: "Übergabe" });
    fireEvent.click(within(handover).getByRole("button", { name: "Übergeben" }));
    expect((await screen.findByRole("alert")).textContent).toContain("unterschreiben");
    fireEvent.click(screen.getByRole("button", { name: "Name eintippen statt unterschreiben" }));
    fireEvent.change(screen.getByLabelText(/Name von Pia Beispiel/), {
      target: { value: "Pia Beispiel" },
    });
    fireEvent.click(within(handover).getByRole("button", { name: "Übergeben" }));
    expect(await screen.findByRole("heading", { name: "Übergabeprotokoll" })).toBeTruthy();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      signed_name: "Pia Beispiel",
    });
    expect(screen.getByText(/mit getipptem Namen „Pia Beispiel“/)).toBeTruthy();
  });

  it("legt eine Ausgabe mit Person, Stelle, Gerät und Zubehör an", async () => {
    const calls = stubFetch({
      "GET /api/inventory/issues": { issues: [], preparing: 0, ready: 0, total: 0 },
      "GET /api/inventory/issues/free-devices": [
        {
          id: 7,
          name: "Notebook 1",
          kind_id: 1,
          kind: "Notebook",
          serial: "NB-1",
          inventory_no: null,
          accessories: ["Netzteil", "Tasche"],
        },
      ],
      "GET /api/inventory/people": [{ oid: OID, name: "Pia Beispiel", upn: "pia@example.com" }],
      "GET /api/inventory/issues/positions": [{ id: 5, number: "ST-001", name: "Technik" }],
      "POST /api/inventory/issues": issue,
      "GET /api/inventory/issues/3": issue,
    });
    render(<IssuesPage issueId="neu" roles={["Bestand.Editor"]} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Anlegen und Vorbereitung starten" }),
    );
    expect(await screen.findByRole("link", { name: "Person" })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: /Person aus Entra/ }), {
      target: { value: "pia" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /Pia Beispiel/ }));
    await screen.findByText(/ST-001 Technik/);
    fireEvent.click(screen.getByRole("checkbox", { name: /Notebook 1/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tasche" }));
    fireEvent.click(screen.getByRole("radio", { name: /Per Link in der Mail/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Zusätzlich per Teams" }));
    fireEvent.click(screen.getByRole("button", { name: "Anlegen und Vorbereitung starten" }));
    await vi.waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      person_oid: OID,
      position_id: 5,
      reason: "neu",
      items: [{ hardware_id: 7, accessories: ["Tasche"] }],
      condition: "neuwertig",
      condition_note: "",
      attach_rules: true,
      notify_teams: true,
      confirm_method: "link",
    });
  });
});

const ret: Return = {
  id: 4,
  number: "R-004",
  person_name: "Pia Beispiel",
  reason: "austritt",
  state: "offen",
  items: 1,
  items_back: 0,
  items_missing: 0,
  created_at: "2026-11-27T08:00:00Z",
  closed_at: null,
  entries: [
    {
      id: 11,
      hardware_id: 7,
      name: "Notebook 1",
      kind: "Notebook",
      serial: "NB-1",
      inventory_no: null,
      source: "Stelle ST-001 Technik",
      state: "offen",
      condition: "in_ordnung",
      room_id: null,
      room: "",
      accessories_ok: false,
      wiped: false,
    },
  ],
};

describe("Rückgabe", () => {
  it("trägt ein Gerät als zurück ein und schließt ab", async () => {
    const back = {
      ...ret,
      items_back: 1,
      entries: ret.entries.map((item) => ({ ...item, state: "zurueck" as const })),
    };
    const calls = stubFetch({
      "GET /api/inventory/returns": { returns: [ret], open: 1, total: 1 },
      "GET /api/inventory/returns/4": ret,
      "PUT /api/inventory/returns/4/items/11": back,
      "POST /api/inventory/returns/4/complete": { ...back, state: "abgeschlossen" },
    });
    render(<ReturnsPage returnId={4} roles={["Bestand.Editor"]} />);
    expect(await screen.findByText("Konto in Entra deaktiviert", { exact: false })).toBeTruthy();
    const finish = screen.getByRole("button", { name: "Rückgabe abschließen" });
    expect(finish).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    await vi.waitFor(() => expect(finish).toHaveProperty("disabled", false));
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      state: "zurueck",
      condition: "in_ordnung",
      room_id: null,
      accessories_ok: false,
      wiped: false,
    });
    expect(screen.getByRole("checkbox", { name: /Daten gelöscht/ })).toBeTruthy();
    fireEvent.click(finish);
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Abschließen" }),
    );
    expect(await screen.findByText("Die Rückgabe ist abgeschlossen.")).toBeTruthy();
  });
});

describe("Bestätigung per Link", () => {
  it("zeigt Geräte und Regeln und bestätigt erst mit Häkchen", async () => {
    const token = "a".repeat(43);
    const view = {
      number: "A-003",
      person_name: "Pia Beispiel",
      entries: issue.entries,
      rules_text: "Bitte pfleglich behandeln.",
      confirmed: false,
    };
    const calls = stubFetch({
      [`GET /api/public/ausgabe/${token}`]: view,
      [`POST /api/public/ausgabe/${token}`]: { ...view, confirmed: true },
    });
    render(<ConfirmIssuePage token={token} />);
    expect(await screen.findByText("Bitte pfleglich behandeln.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Empfang bestätigen" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Häkchen");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ich habe die Geräte bekommen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Empfang bestätigen" }));
    expect(
      await screen.findByText(/Du hast den Empfang der Geräte aus A-003 bestätigt/),
    ).toBeTruthy();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ accepted: true });
  });

  it("meldet einen abgelaufenen Link", async () => {
    stubFetch({});
    render(<ConfirmIssuePage token={"b".repeat(43)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Wende dich bitte an die IT");
  });
});
