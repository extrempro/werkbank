import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { filterPeople, type PersonRoles } from "../api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminPage", () => {
  it("zeigt die Rollen", async () => {
    const roles = [
      {
        value: "Werkbank.Admin",
        label: "Werkbank Admin",
        description: "Verwaltung der Werkbank",
        holders: [
          { display_name: "Ada Admin", email: null, last_login_at: "2026-11-14T08:00:00Z" },
        ],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(roles), { status: 200 })),
    );
    render(<AdminPage />);
    expect(await screen.findByText("Werkbank Admin")).toBeVisible();
    expect(screen.getByText(/Ada Admin/)).toBeVisible();
  });

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

  it("zeigt je Person alle Rollen und filtert", async () => {
    const people: PersonRoles[] = [
      {
        display_name: "Pia Projekt",
        email: "pia@example.com",
        last_login_at: "2026-11-14T08:00:00Z",
        roles: [
          { value: "Budget.Reader", label: "Budget Leser" },
          { value: "Projekte.Reader", label: "Projekte Leser" },
        ],
      },
      { display_name: "Otto Ohne", email: null, last_login_at: null, roles: [] },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/admin/people"
          ? new Response(JSON.stringify(people), { status: 200 })
          : new Response(JSON.stringify([]), { status: 200 }),
      ),
    );
    render(<AdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Nach Person" }));
    const table = within(await screen.findByRole("region", { name: "Personen und Rollen" }));
    const pia = table.getByRole("row", { name: /Pia Projekt/ });
    expect(pia).toHaveTextContent("Budget Leser");
    expect(pia).toHaveTextContent("Projekte Leser");
    expect(table.getByRole("row", { name: /Otto Ohne/ })).toHaveTextContent("keine Rolle");
    fireEvent.change(screen.getByLabelText("Person oder Rolle suchen"), {
      target: { value: "projekte" },
    });
    expect(table.queryByRole("row", { name: /Otto Ohne/ })).toBeNull();
  });

  it("filtert Personen nach Name, Mail, Rolle und ohne Rolle", () => {
    const people: PersonRoles[] = [
      {
        display_name: "Pia Projekt",
        email: "pia@example.com",
        last_login_at: null,
        roles: [{ value: "Projekte.Reader", label: "Projekte Leser" }],
      },
      { display_name: "Otto Ohne", email: null, last_login_at: null, roles: [] },
    ];
    const names = (list: PersonRoles[]) => list.map((person) => person.display_name);
    expect(names(filterPeople(people, "PIA@"))).toEqual(["Pia Projekt"]);
    expect(names(filterPeople(people, "projekte.reader"))).toEqual(["Pia Projekt"]);
    expect(names(filterPeople(people, "", true))).toEqual(["Otto Ohne"]);
  });
});
