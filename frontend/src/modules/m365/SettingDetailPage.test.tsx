import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { parseTargetInput, targetInputText } from "./api";
import { SettingDetailPage } from "./SettingDetailPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const detail = {
  setting: {
    id: 3,
    path: "entra/conditionalaccesspolicy/p1/State",
    workload: "entra",
    area: "conditionalaccesspolicy",
    object_id: "p1",
    object_name: "MFA für alle",
    property: "State",
    source: "utcm:microsoft.entra.conditionalaccesspolicy",
    active: true,
    value: "disabled",
    valid_from: "2026-11-14T08:00:00Z",
    criticality: "hoch",
    deviates: true,
  },
  meta: {
    description: "Erzwingt MFA",
    reasoning: null,
    criticality: "hoch",
    owner: null,
    learn_url: "https://learn.microsoft.com/de-de/entra/",
    target_set: true,
    target_value: "enabled",
    target_source: "manuell",
  },
  meta_history: [
    {
      id: 1,
      field: "soll_wert",
      old_value: null,
      new_value: { wert: "enabled" },
      user: "Rita Reviewer",
      changed_at: "2026-11-14T09:00:00Z",
    },
  ],
  versions: [{ id: 2, value: "disabled", valid_from: "2026-11-14T08:00:00Z", valid_to: null }],
  changes: [],
};

function me(roles: string[]): Me {
  return { display_name: "Rita", email: null, roles, authenticated_at: "2026-11-14T08:00:00Z" };
}

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = init?.method === "PUT" ? detail.meta : detail;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

describe("Soll-Wert als Eingabe", () => {
  it("übernimmt JSON als JSON und alles andere als Text", () => {
    expect(parseTargetInput(" enabled ")).toBe("enabled");
    expect(parseTargetInput("true")).toBe(true);
    expect(parseTargetInput('["mfa"]')).toEqual(["mfa"]);
    expect(parseTargetInput('"true"')).toBe("true");
  });

  it("zeigt gespeicherte Werte so an, dass sie unverändert zurückkommen", () => {
    for (const value of ["enabled", "true", true, 5, ["mfa"], { a: 1 }, null]) {
      expect(parseTargetInput(targetInputText(value))).toEqual(value);
    }
  });
});

describe("SettingDetailPage", () => {
  it("zeigt Angaben, Abweichung und Verlauf der Angaben", async () => {
    stubFetch();
    render(<SettingDetailPage id={3} me={me(["Config.Reader"])} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "MFA für alle – State" }),
    ).toBeVisible();
    expect(screen.getByText("Weicht vom Soll-Wert ab.")).toBeVisible();
    expect(screen.getByText("Erzwingt MFA")).toBeVisible();
    expect(screen.getByRole("link", { name: /Dokumentation öffnen/ })).toHaveAttribute(
      "href",
      "https://learn.microsoft.com/de-de/entra/",
    );
    expect(screen.getByRole("cell", { name: "Soll-Wert" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Angaben bearbeiten" })).toBeNull();
  });

  it("lässt Reviewer die Angaben bearbeiten und speichert sie", async () => {
    const calls = stubFetch();
    render(<SettingDetailPage id={3} me={me(["Config.Reviewer"])} />);
    fireEvent.click(await screen.findByRole("button", { name: "Angaben bearbeiten" }));

    fireEvent.change(screen.getByLabelText("Link zu Microsoft Learn"), {
      target: { value: "http://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("https://");

    fireEvent.change(screen.getByLabelText("Link zu Microsoft Learn"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Warum bei uns so"), {
      target: { value: "Vorgabe der IT-Leitung" },
    });
    fireEvent.change(screen.getByLabelText("Soll-Wert"), { target: { value: '["mfa"]' } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("button", { name: "Angaben bearbeiten" })).toBeVisible();
    const put = calls.find((call) => call.init?.method === "PUT");
    expect(put?.url).toBe("/api/m365-config/settings/3/meta");
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      description: "Erzwingt MFA",
      reasoning: "Vorgabe der IT-Leitung",
      criticality: "hoch",
      owner: "",
      learn_url: "",
      target_set: true,
      target_value: ["mfa"],
    });
  });

  it("zeigt den Verlauf als Zeitleiste", async () => {
    const change = {
      id: 9,
      setting_id: 3,
      path: detail.setting.path,
      workload: "entra",
      object_name: "MFA für alle",
      property: "State",
      criticality: "hoch",
      description: null,
      kind: "geaendert",
      status: "ungewollt",
      detected_at: "2026-11-14T08:00:00Z",
      old_value: "enabled",
      new_value: "disabled",
      changed_by: "ada@example.com",
      reviewed_by: "Rita Reviewer",
      reviewed_at: "2026-11-14T09:00:00Z",
      comment: "Nicht abgestimmt",
    };
    const body = {
      ...detail,
      meta: { ...detail.meta, target_source: "Evergreen EV-2026-014" },
      changes: [change],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    render(<SettingDetailPage id={3} me={me(["Config.Reader"])} />);
    expect(await screen.findByText("✗ weicht ab")).toBeVisible();
    expect(screen.queryByText("Geregelt durch Evergreen-Vorgang")).toBeNull();
    expect(screen.getByText("1 Änderung")).toBeVisible();
    const entry = screen.getByText(/bewertet von Rita Reviewer · Nicht abgestimmt/);
    expect(entry).toHaveTextContent("von ada@example.com");
    expect(screen.getByText("Ungewollt")).toBeVisible();
  });
});
