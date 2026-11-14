import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { daysUntil, isUrgent, rolloutText } from "./api";
import { ItemDetailPage } from "./ItemDetailPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const steps = [
  { id: "it_bewertung", title: "IT-Bewertung" },
  { id: "fachabteilungen", title: "Fachabteilungen" },
  { id: "vorlage_br", title: "Vorlage BR" },
  { id: "betriebsrat", title: "Betriebsrat" },
  { id: "geschaeftsfuehrung", title: "Geschäftsführung" },
  { id: "umsetzung", title: "Umsetzung" },
];

function detail(overrides: Record<string, unknown> = {}) {
  return {
    item: {
      id: 5,
      number: "EV-2026-005",
      title: "Copilot in Outlook",
      service: "Exchange",
      source: "manuell",
      major_change: true,
      rollout_date: null,
      step: "betriebsrat",
      step_title: "Betriebsrat",
      finished: false,
      waiting_for_me: true,
      created_at: "2026-11-14T08:00:00Z",
    },
    message: null,
    message_updated: false,
    plan: [],
    can_plan: false,
    provisional_hint: false,
    summary: "Neue Zusammenfassungen",
    departments_feedback: null,
    not_controllable: false,
    steps,
    actions: [
      { id: "zustimmen", title: "Zustimmen", comment_required: false, on_behalf: false },
      { id: "ablehnen", title: "Ablehnen", comment_required: true, on_behalf: false },
    ],
    events: [
      {
        id: 1,
        occurred_at: "2026-11-14T09:00:00Z",
        step_title: "IT-Bewertung",
        action_title: "Mitbestimmungspflichtig",
        target_title: "Fachabteilungen",
        user: "Ina IT",
        on_behalf_of: null,
        comment: null,
        session_date: null,
      },
    ],
    can_edit: false,
    ...overrides,
  };
}

function stubFetch(first: unknown, afterAction: unknown = first) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = init?.method === "POST" ? afterAction : first;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

describe("Frist bis zum Rollout", () => {
  const today = new Date(2026, 10, 14);

  it("rechnet in Tagen und markiert dringende Vorgänge", () => {
    expect(daysUntil("2026-11-24", today)).toBe(10);
    expect(rolloutText({ rollout_date: "2026-11-24", finished: false }, today)).toContain(
      "in 10 Tagen (dringend)",
    );
    expect(rolloutText({ rollout_date: "2026-12-24", finished: false }, today)).toContain(
      "in 40 Tagen",
    );
    expect(rolloutText({ rollout_date: "2026-12-24", finished: false }, today)).not.toContain(
      "dringend",
    );
    expect(rolloutText({ rollout_date: "2026-11-01", finished: false }, today)).toContain(
      "Rollout hat begonnen",
    );
    expect(rolloutText({ rollout_date: null, finished: false }, today)).toBe("–");
    expect(isUrgent({ rollout_date: "2026-11-24", finished: false }, today)).toBe(true);
    expect(isUrgent({ rollout_date: "2026-11-24", finished: true }, today)).toBe(false);
  });
});

describe("ItemDetailPage", () => {
  it("zeigt Ablauf, Angaben und Protokoll", async () => {
    stubFetch(detail());
    render(<ItemDetailPage id={5} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Copilot in Outlook" }),
    ).toBeVisible();
    const current = screen.getByText("Betriebsrat", { selector: "li" });
    expect(current).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Neue Zusammenfassungen")).toBeVisible();
    expect(screen.getByRole("cell", { name: /Mitbestimmungspflichtig/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Angaben bearbeiten" })).toBeNull();
  });

  it("verlangt den Kommentar, wo er Pflicht ist, und sendet die Entscheidung", async () => {
    const after = detail({
      item: { ...detail().item, step: "abgelehnt", step_title: "Abgelehnt", finished: true },
      actions: [],
    });
    const calls = stubFetch(detail(), after);
    render(<ItemDetailPage id={5} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ablehnen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Kommentar nötig");
    expect(calls.some((call) => call.init?.method === "POST")).toBe(false);

    fireEvent.change(screen.getByLabelText("Kommentar"), {
      target: { value: " Zu viel Kontrolle " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ablehnen" }));
    expect(await screen.findByText(/Neuer Schritt: Abgelehnt/)).toBeVisible();
    const post = calls.find((call) => call.init?.method === "POST");
    expect(post?.url).toBe("/api/evergreen/items/5/actions");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      action: "ablehnen",
      expected_step: "betriebsrat",
      comment: "Zu viel Kontrolle",
      session_date: null,
    });
    expect(screen.queryByRole("button", { name: "Ablehnen" })).toBeNull();
  });

  it("verlangt beim Erfassen im Auftrag Sitzungsdatum und Inhalt", async () => {
    const onBehalf = detail({
      actions: [{ id: "zustimmen", title: "Zustimmen", comment_required: true, on_behalf: true }],
    });
    const calls = stubFetch(onBehalf);
    render(<ItemDetailPage id={5} />);
    expect(
      await screen.findByRole("heading", { name: "Beschluss im Auftrag erfassen" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zustimmen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Inhalt des Beschlusses");
    fireEvent.change(screen.getByLabelText("Inhalt des Beschlusses"), {
      target: { value: "Einstimmig" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zustimmen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Datum der Sitzung");
    fireEvent.change(screen.getByLabelText("Datum der Sitzung"), {
      target: { value: "2026-11-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zustimmen" }));
    await screen.findByText(/ist erfasst/);
    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body)).session_date).toBe("2026-11-10");
  });
});
