import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSettings, TeamsSettings as Teams } from "../api";
import { TeamsSettings } from "./TeamsSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const teams: Teams = { enabled: true, url_set: true, url_storage_available: true };
const saved: AdminSettings = {
  smtp: {
    host: "",
    port: 587,
    security: "starttls",
    username: "",
    sender_address: "",
    sender_name: "",
    password_set: false,
    password_storage_available: true,
  },
  teams,
  audit_retention_days: 90,
  audit_retention_min: 30,
  audit_retention_max: 3650,
};

function stubFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

describe("TeamsSettings", () => {
  it("zeigt die gespeicherte Adresse nie und behält sie beim Speichern", async () => {
    const calls = stubFetch(saved);
    render(<TeamsSettings teams={teams} onChange={() => undefined} />);
    expect(screen.getByText("eingeschaltet")).toBeVisible();
    expect(screen.getByLabelText("Neue Adresse des Workflows")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Teams speichern" }));
    expect(await screen.findByText("Die Einstellungen für Teams sind gespeichert.")).toBeVisible();
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe("/api/admin/settings/teams");
    expect(body).toEqual({ enabled: true });
  });

  it("löscht die Adresse und schaltet dabei aus", async () => {
    const calls = stubFetch(saved);
    render(<TeamsSettings teams={teams} onChange={() => undefined} />);
    fireEvent.click(screen.getByLabelText("Gespeicherte Adresse löschen"));
    fireEvent.click(screen.getByRole("button", { name: "Teams speichern" }));
    await screen.findByText("Die Einstellungen für Teams sind gespeichert.");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ enabled: false, url: "" });
  });

  it("schickt eine Testnachricht und zeigt Fehler des Servers", async () => {
    stubFetch({ detail: "Der Workflow hat mit 500 geantwortet." }, 502);
    render(<TeamsSettings teams={teams} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Testnachricht an mich senden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Workflow hat mit 500 geantwortet.",
    );
  });
});
