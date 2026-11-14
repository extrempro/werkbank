import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItemDetail, PlanEntry } from "./api";
import { PlanSection } from "./PlanSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function entry(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id: 1,
    label: "Aufzeichnung von Besprechungen",
    target_value: "disabled",
    instruction: "Teams Admin Center",
    provisional: false,
    status: "unbestaetigt",
    monitored: false,
    confirmed_by: null,
    confirmed_at: null,
    setting_id: null,
    setting_path: null,
    current_value: null,
    ...overrides,
  };
}

function detail(plan: PlanEntry[], canPlan: boolean): ItemDetail {
  return {
    item: {
      id: 5,
      number: "EV-2026-005",
      title: "Test",
      service: null,
      source: "manuell",
      major_change: false,
      rollout_date: null,
      step: "umsetzung",
      step_title: "Umsetzung",
      finished: false,
      waiting_for_me: false,
      created_at: "2026-11-14T08:00:00Z",
    },
    plan,
    can_plan: canPlan,
    provisional_hint: false,
    message: null,
    message_updated: false,
    summary: null,
    departments_feedback: null,
    not_controllable: false,
    steps: [],
    actions: [],
    events: [],
    can_edit: canPlan,
  };
}

function stubFetch(response: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response), { status: 200 });
    }),
  );
  return calls;
}

describe("PlanSection", () => {
  it("zeigt Lesern den Plan ohne Bedienelemente und ohne technische Angaben", () => {
    render(<PlanSection detail={detail([entry()], false)} onChange={() => {}} />);
    expect(screen.getByRole("heading", { level: 3, name: /Aufzeichnung/ })).toBeVisible();
    expect(screen.getByText("Noch nicht bestätigt")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Überwachte Einstellung")).toBeNull();
  });

  it("zeigt der IT Pfad und aktuellen Wert einer überwachten Einstellung", () => {
    const monitored = entry({
      status: "offen",
      monitored: true,
      setting_id: 3,
      setting_path: "teams/meetingPolicy/p1/AllowRecording",
      current_value: "enabled",
    });
    render(<PlanSection detail={detail([monitored], true)} onChange={() => {}} />);
    expect(screen.getByText("teams/meetingPolicy/p1/AllowRecording")).toBeVisible();
    expect(screen.getByText("enabled")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Als umgesetzt bestätigen/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Entfernen/ })).toBeVisible();
  });

  it("bestätigt einen Eintrag ohne Überwachung", async () => {
    const after = detail([entry({ status: "bestaetigt", confirmed_by: "Ina IT" })], true);
    const calls = stubFetch(after);
    const onChange = vi.fn();
    render(<PlanSection detail={detail([entry()], true)} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Als umgesetzt bestätigen/ }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(after));
    expect(calls[0]?.url).toBe("/api/evergreen/items/5/plan/1/confirm");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ done: true });
  });

  it("trägt einen Soll-Wert ein und prüft die Pflichtangaben", async () => {
    const after = detail([entry()], true);
    const calls = stubFetch(after);
    const onChange = vi.fn();
    render(<PlanSection detail={detail([], true)} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Soll-Wert hinzufügen" }));
    fireEvent.click(screen.getByRole("button", { name: "Eintragen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bezeichnung");

    fireEvent.change(screen.getByLabelText(/Bezeichnung/), {
      target: { value: "Loop in Outlook" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Eintragen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Soll-Wert");

    fireEvent.change(screen.getByLabelText(/^Soll-Wert/), { target: { value: "false" } });
    fireEvent.click(screen.getByLabelText("Vorläufige Sperre bis zum Beschluss"));
    fireEvent.click(screen.getByRole("button", { name: "Eintragen" }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(after));
    expect(calls[0]?.url).toBe("/api/evergreen/items/5/plan");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      label: "Loop in Outlook",
      target_value: false,
      instruction: null,
      provisional: true,
      setting_id: null,
    });
  });
});
