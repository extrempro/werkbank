import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// Ohne Server: das gemeinsame Dokument ist leer und gilt als verbunden
const liveState = vi.hoisted(() => ({
  status: "live" as string,
  presence: [] as { id: number; name: string; color: string }[],
}));
vi.mock("./useLiveDoc", async (original) => {
  const actual = await original<typeof import("./useLiveDoc")>();
  const { Awareness } = await import("y-protocols/awareness");
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  return {
    ...actual,
    useLiveDoc: (pageId: string, session: number) => ({
      live: { doc, provider: { awareness }, color: "#1f57c3", pageId, session },
      status: liveState.status,
      synced: liveState.status === "live",
      presence: liveState.presence,
    }),
  };
});
import { areasFor } from "../../navigation";
import { DokuAdminPage } from "./DokuAdminPage";
import { allowedLink } from "./DokuEditor";
import { DokuPageView } from "./DokuPage";
import { RightsDialog } from "./RightsDialog";
import {
  buildTree,
  parseAdminPath,
  parsePagePath,
  type DokuPageData,
  type Rights,
  type TreePage,
} from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ID = "11111111-2222-3333-4444-555555555555";

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

function pageData(extra: Partial<DokuPageData> = {}): DokuPageData {
  return {
    id: ID,
    space_id: 1,
    space: "IT",
    parent_id: null,
    path: [],
    title: "Drucker",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Toner im Lager" }] }],
    },
    revision: 3,
    role: "edit",
    can_manage_space: false,
    archived: false,
    locked: false,
    locked_by_name: "",
    locked_at: null,
    own_rights: false,
    rights_from: null,
    created_by_name: "Ina Beispiel",
    created_at: "2026-11-24T10:00:00Z",
    updated_by_name: "Ina Beispiel",
    updated_at: "2026-11-24T10:00:00Z",
    versions: 0,
    ...extra,
  };
}

describe("Doku: Adressen, Baum, Links", () => {
  it("erkennt Seiten und Reiter der Verwaltung", () => {
    expect(parsePagePath(`/doku/seite/${ID}`)).toBe(ID);
    expect(parsePagePath("/doku/seite/abc")).toBeNull();
    expect(parseAdminPath("/doku/verwaltung")).toBe("arbeitsbereiche");
    expect(parseAdminPath("/doku/verwaltung/papierkorb")).toBe("papierkorb");
    expect(parseAdminPath("/doku/verwaltung/xyz")).toBeNull();
  });

  it("baut den Seitenbaum nach Reihenfolge", () => {
    const page = (id: string, parent: string | null, position: number): TreePage => ({
      id,
      parent_id: parent,
      title: id,
      position,
      own_rights: false,
      locked: false,
      can_edit: true,
    });
    const tree = buildTree([page("b", null, 2), page("a", null, 1), page("c", "a", 1)]);
    expect(tree.map((node) => node.id)).toEqual(["a", "b"]);
    expect(tree[0]?.children.map((node) => node.id)).toEqual(["c"]);
  });

  it("lässt nur sichere Links zu", () => {
    expect(allowedLink("https://example.com")).toBe(true);
    expect(allowedLink("mailto:it@example.com")).toBe(true);
    expect(allowedLink("/doku/seite/1")).toBe(true);
    expect(allowedLink("javascript:alert(1)")).toBe(false);
    expect(allowedLink("//example.com")).toBe(false);
    expect(allowedLink("/\\example.com")).toBe(false);
    expect(allowedLink("http://example.com")).toBe(false);
  });

  it("zeigt den Bereich nur mit Doku-Rolle, die Verwaltung nur der Doku-Verwaltung", () => {
    expect(areasFor(["Tools.User"]).some((area) => area.id === "doku")).toBe(false);
    const user = areasFor(["Doku.Nutzer"]).find((area) => area.id === "doku");
    expect(user?.groups.flatMap((g) => g.items.map((i) => i.path))).toEqual(["/doku"]);
    const admin = areasFor(["Doku.Admin"]).find((area) => area.id === "doku");
    expect(admin?.groups.flatMap((g) => g.items.map((i) => i.path))).toContain("/doku/verwaltung");
  });
});

describe("Doku: Seite", () => {
  it("speichert den Titel automatisch, der Inhalt läuft live", async () => {
    liveState.status = "live";
    liveState.presence = [{ id: 2, name: "Max Muster", color: "#1f57c3" }];
    const calls = stubFetch({
      [`GET /api/doku/pages/${ID}`]: pageData(),
      [`GET /api/doku/pages/${ID}/versions`]: [],
      [`PUT /api/doku/pages/${ID}`]: pageData({ title: "Drucker im Flur", revision: 4 }),
    });
    render(<DokuPageView pageId={ID} />);
    const title = await screen.findByRole("textbox", { name: "Titel der Seite" });
    expect(screen.getByRole("textbox", { name: "Inhalt der Seite" })).toBeInTheDocument();
    expect(screen.getByText("Live · wird automatisch gespeichert")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Gerade auf der Seite" })).getByText("Max Muster"),
    ).toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.change(title, { target: { value: "Drucker im Flur" } });
    expect(screen.getByText("Titel wird gespeichert …")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.getByText("Live · wird automatisch gespeichert")).toBeInTheDocument(),
    );
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.body).toEqual({ title: "Drucker im Flur", revision: 3 });
  });

  it("meldet eine unterbrochene Verbindung", async () => {
    liveState.status = "getrennt";
    liveState.presence = [];
    stubFetch({
      [`GET /api/doku/pages/${ID}`]: pageData(),
      [`GET /api/doku/pages/${ID}/versions`]: [],
    });
    render(<DokuPageView pageId={ID} />);
    expect(
      await screen.findByText("Verbindung unterbrochen – Änderungen werden nachgereicht"),
    ).toBeInTheDocument();
    liveState.status = "live";
  });

  it("zeigt gesperrte Seiten und Seiten zum Lesen ohne Eingabe", async () => {
    stubFetch({
      [`GET /api/doku/pages/${ID}`]: pageData({
        locked: true,
        locked_by_name: "Max Muster",
        locked_at: "2026-11-24T10:00:00Z",
      }),
      [`GET /api/doku/pages/${ID}/versions`]: [],
    });
    render(<DokuPageView pageId={ID} />);
    expect(await screen.findByText(/von Max Muster am/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Inhalt der Seite" })).toBeNull();
    expect(screen.getByRole("button", { name: "Entsperren" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /In den Papierkorb/ })).toBeNull();
  });
});

describe("Doku: Rechte", () => {
  it("speichert eigene Rechte nur mit Abweichungen vom Arbeitsbereich", async () => {
    const rights: Rights = {
      own_rights: false,
      inherited_from: null,
      entries: [],
      space_members: [
        { oid: "a", name: "Ina Beispiel", role: "manage" },
        { oid: "b", name: "Lea Leser", role: "read" },
      ],
      can_manage_space: false,
    };
    const calls = stubFetch({
      [`GET /api/doku/pages/${ID}/rights`]: rights,
      [`PUT /api/doku/pages/${ID}/rights`]: { ...rights, own_rights: true },
    });
    const onSaved = vi.fn();
    render(
      <RightsDialog
        pageId={ID}
        spaceId={1}
        space="IT"
        onClose={() => undefined}
        onFeedback={() => undefined}
        onSaved={onSaved}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Rechte und Teilen" });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Eigene Rechte/ }));
    // Verwalten zählt an der Seite wie Bearbeiten
    expect(within(dialog).getByLabelText("Recht für Ina Beispiel")).toHaveValue("edit");
    fireEvent.change(within(dialog).getByLabelText("Recht für Lea Leser"), {
      target: { value: "none" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rechte speichern" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.body).toEqual({
      own_rights: true,
      entries: [{ oid: "b", name: "Lea Leser", role: "none" }],
    });
  });
});

describe("Doku: Verwaltung", () => {
  it("zeigt den Papierkorb und stellt wieder her", async () => {
    const calls = stubFetch({
      "GET /api/doku/admin/trash": [
        {
          id: ID,
          title: "Alt",
          space: "IT",
          pages: 3,
          deleted_by_name: "Max Muster",
          deleted_at: "2026-11-20T10:00:00Z",
          purge_at: "2026-12-20T10:00:00Z",
        },
      ],
      [`POST /api/doku/admin/trash/${ID}/restore`]: { ok: true },
    });
    render(<DokuAdminPage tab="papierkorb" />);
    const row = await screen.findByRole("row", { name: /Alt/ });
    expect(within(row).getByText("mit 2 Unterseiten")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /Wiederherstellen/ }));
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith(`/trash/${ID}/restore`))).toBe(true),
    );
  });
});
