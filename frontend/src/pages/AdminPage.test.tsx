import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";
import { filterPermissionPeople, rightLabels, type PermissionPerson } from "./Permissions";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminPage", () => {
  it("bittet um erneute Anmeldung, wenn die letzte zu lange her ist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "Erneute Anmeldung erforderlich" }), {
            status: 403,
            headers: { "X-Werkbank-Step-Up": "required" },
          }),
      ),
    );
    render(<AdminPage />);
    const link = await screen.findByRole("link", { name: "Erneut anmelden" });
    expect(link).toHaveAttribute("href", "/auth/login?step_up=true&return_to=%2Fverwaltung");
    expect(screen.queryByText(/Keine Berechtigung/)).toBeNull();
    cleanup();
    // Nach der Anmeldung geht es zurück auf dieselbe Seite der Verwaltung.
    render(<AdminPage section="mail-teams" />);
    expect(await screen.findByRole("link", { name: "Erneut anmelden" })).toHaveAttribute(
      "href",
      "/auth/login?step_up=true&return_to=%2Fverwaltung%2Fmail-teams",
    );
  });

  it("meldet fehlende Berechtigung ohne Hinweis auf erneute Anmeldung", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    render(<AdminPage />);
    expect(await screen.findByText(/Keine Berechtigung/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Erneut anmelden" })).toBeNull();
  });
});

const OVERVIEW = {
  groups_configured: true,
  areas: [
    {
      key: "budget",
      name: "IT-Budget",
      hint: "Hinweis",
      levels: [{ label: "Kein Zugriff" }, { label: "Lesen" }, { label: "Bearbeiten" }],
    },
    {
      key: "tools",
      name: "IT-Tools",
      hint: "Hinweis",
      levels: [{ label: "Kein Zugriff" }, { label: "Nutzen" }],
    },
  ],
  people: [
    {
      id: "p1",
      display_name: "Ina Beispiel",
      email: "ina@example.com",
      avatar_url: null,
      last_login_at: "2026-11-24T08:00:00Z",
      is_admin: true,
      levels: {},
      permissions_since: "2026-11-24T08:00:00Z",
      permissions_origin: "app_rollen",
    },
    {
      id: "p2",
      display_name: "Max Muster",
      email: "max@example.com",
      avatar_url: null,
      last_login_at: null,
      is_admin: false,
      levels: { budget: 1, tools: 1 },
      permissions_since: null,
      permissions_origin: null,
    },
  ],
};

describe("Berechtigungen", () => {
  it("filtert nach Name und Bereich und fasst die Rechte zusammen", () => {
    const names = (list: PermissionPerson[]) => list.map((person) => person.display_name);
    const people = OVERVIEW.people as PermissionPerson[];
    expect(names(filterPermissionPeople(people, "MAX@", ""))).toEqual(["Max Muster"]);
    expect(names(filterPermissionPeople(people, "", "budget"))).toEqual(["Max Muster"]);
    expect(names(filterPermissionPeople(people, "", "ohne"))).toEqual(["Ina Beispiel"]);
    expect(rightLabels(people[1]!, OVERVIEW.areas)).toEqual(["IT-Budget · Lesen", "IT-Tools"]);
  });

  it("speichert neue Stufen einer Person", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (url === "/api/admin/settings") {
          return new Response(JSON.stringify({ smtp: {} }), { status: 200 });
        }
        if (method === "PUT") {
          return new Response(
            JSON.stringify({ ...OVERVIEW.people[1], levels: { budget: 2, tools: 1 } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(OVERVIEW), { status: 200 });
      }),
    );
    render(<AdminPage section="berechtigungen" />);
    fireEvent.click(await screen.findByRole("link", { name: "Max Muster" }));
    const detail = await screen.findByRole("region", { name: "Max Muster" });
    const budget = within(detail).getByRole("group", { name: /IT-Budget/ });
    fireEvent.click(within(budget).getByRole("radio", { name: "Bearbeiten" }));
    fireEvent.click(within(detail).getByRole("button", { name: "Rechte speichern" }));
    expect(await screen.findByText(/sind gespeichert/)).toBeInTheDocument();
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("/api/admin/permissions/p2");
    expect(put?.body).toEqual({ levels: { budget: 2, tools: 1 } });
  });
});
