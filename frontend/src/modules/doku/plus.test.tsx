import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DokuMenuContent } from "./DokuMenu";
import type { TreeSpace } from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function tree(role: TreeSpace["role"] = "edit", locked = false): TreeSpace[] {
  return [
    {
      id: 1,
      name: "IT",
      icon: "🖥️",
      description: "",
      role,
      archived: false,
      pages: [
        {
          id: "a",
          parent_id: null,
          title: "Netzwerk",
          icon: "🌐",
          position: 1,
          own_rights: false,
          locked,
          can_edit: role !== "read",
        },
      ],
    },
  ];
}

function stub(spaces: TreeSpace[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url === "/api/doku/tree") {
        return new Response(JSON.stringify(spaces), { status: 200 });
      }
      if (url === "/api/doku/me") {
        return new Response(JSON.stringify({ is_admin: false, spaces }), { status: 200 });
      }
      if (url === "/api/doku/pages" && method === "POST") {
        return new Response(JSON.stringify({ id: "neu", title: "VLAN" }), { status: 201 });
      }
      return new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

const props = { pageId: null, adminOpen: false, onNavigate: () => undefined };

describe("Doku: Seiten über das Plus im Baum", () => {
  it("legt eine Unterseite mit Emoji direkt im Baum an", async () => {
    const calls = stub(tree());
    render(<DokuMenuContent {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unterseite zu Netzwerk anlegen" }));
    const input = screen.getByRole("textbox", { name: "Unterseite zu „Netzwerk“" });
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole("button", { name: "Emoji wählen" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Schloss" })[0]!);
    fireEvent.change(input, { target: { value: "VLAN" } });
    fireEvent.submit(input);
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      space_id: 1,
      parent_id: "a",
      title: "VLAN",
      icon: "🔒",
    });
  });

  it("legt oben im Arbeitsbereich an und bricht mit Esc ab", async () => {
    const calls = stub(tree());
    render(<DokuMenuContent {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Neue Seite in IT anlegen" }));
    const input = screen.getByRole("textbox", { name: "Neue Seite in IT" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Neue Seite in IT" })).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("zeigt kein Plus zum Lesen und nicht an gesperrten Seiten", async () => {
    stub(tree("read"));
    render(<DokuMenuContent {...props} />);
    await screen.findByText("Netzwerk");
    expect(screen.queryByRole("button", { name: /anlegen$/ })).not.toBeInTheDocument();
    cleanup();
    stub(tree("edit", true));
    render(<DokuMenuContent {...props} />);
    await screen.findByText("Netzwerk");
    expect(
      screen.queryByRole("button", { name: "Unterseite zu Netzwerk anlegen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neue Seite in IT anlegen" })).toBeInTheDocument();
  });
});
