import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DokuPageData, TreeSpace } from "./api";
import { MovePageDialog } from "./MovePageDialog";

const page = { id: "b", space_id: 1, parent_id: "a", title: "Drucker" } as DokuPageData;

function tree(role: TreeSpace["role"] = "edit"): TreeSpace[] {
  const p = (id: string, parent: string | null, title: string, position: number, edit = true) => ({
    id,
    parent_id: parent,
    title,
    icon: "",
    position,
    own_rights: false,
    locked: false,
    can_edit: edit,
  });
  return [
    {
      id: 1,
      name: "IT",
      icon: "",
      description: "",
      role,
      archived: false,
      pages: [
        p("a", null, "Geräte", 1),
        p("b", "a", "Drucker", 1),
        p("c", "b", "Toner", 1),
        p("d", "a", "Scanner", 2),
        p("e", null, "Netz", 2),
        p("f", null, "Geheim", 3, false),
      ],
    },
  ];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MovePageDialog", () => {
  it("bietet nur erlaubte Plätze an, ohne die Seite selbst und ihre Unterseiten", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ ...page, parent_id: "e" }), { status: 200 });
        }
        return new Response(JSON.stringify(url.endsWith("/tree") ? tree() : {}), { status: 200 });
      }),
    );
    const moved = vi.fn();
    render(<MovePageDialog page={page} onClose={vi.fn()} onMoved={moved} />);
    const place = await screen.findByRole("combobox", { name: /Neuer Platz/ });
    const labels = within(place)
      .getAllByRole("option")
      .map((option) => option.textContent?.trim());
    expect(labels).toEqual([
      "Oben im Arbeitsbereich",
      "Unter: Geräte",
      // eingerückt: Unterseite von „Geräte“
      "Unter: \u2003Scanner",
      "Unter: Netz",
    ]);
    // Am bisherigen Platz: Reihenfolge zeigt die Geschwister
    const order = screen.getByRole("combobox", { name: "Reihenfolge" });
    expect(
      within(order)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Am Ende", "Vor „Scanner“"]);
    fireEvent.change(place, { target: { value: "e" } });
    fireEvent.click(screen.getByRole("button", { name: "Verschieben" }));
    await waitFor(() => expect(bodies).toEqual([{ parent_id: "e", before_id: null }]));
    expect(moved).toHaveBeenCalled();
  });

  it("ohne Bearbeiten im Arbeitsbereich nicht nach oben", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(tree("none")), { status: 200 })),
    );
    render(<MovePageDialog page={page} onClose={vi.fn()} onMoved={vi.fn()} />);
    const place = await screen.findByRole("combobox", { name: /Neuer Platz/ });
    expect(within(place).queryByRole("option", { name: "Oben im Arbeitsbereich" })).toBeNull();
  });
});
