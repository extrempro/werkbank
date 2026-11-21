import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const me: Me = {
  display_name: "Lea",
  email: null,
  roles: ["Config.Reader"],
  authenticated_at: "2026-11-14T08:00:00Z",
};

function setting(id: number, workload: string, name: string, extra: object = {}) {
  return {
    id,
    path: `${workload}/bereich/${id}/State`,
    workload,
    area: "bereich",
    object_id: String(id),
    object_name: name,
    property: "State",
    source: "utcm",
    active: true,
    value: "enabled",
    valid_from: "2026-11-01T08:00:00Z",
    criticality: null,
    deviates: false,
    open_changes: 0,
    ...extra,
  };
}

const tree = {
  settings: 3,
  open_changes: 2,
  deviating: 1,
  workloads: [
    {
      workload: "teams",
      settings: 1,
      open_changes: 0,
      deviating: 0,
      areas: [
        {
          area: "bereich",
          settings: 1,
          open_changes: 0,
          deviating: 0,
          objects: [
            {
              object_id: "1",
              object_name: "Besprechungsrichtlinie",
              settings: 1,
              open_changes: 0,
              deviating: 0,
              active: true,
            },
          ],
        },
      ],
    },
    {
      workload: "entra",
      settings: 2,
      open_changes: 2,
      deviating: 1,
      areas: [
        {
          area: "conditionalAccessPolicy",
          settings: 2,
          open_changes: 2,
          deviating: 1,
          objects: [
            {
              object_id: "2",
              object_name: "MFA für alle",
              settings: 2,
              open_changes: 2,
              deviating: 1,
              active: true,
            },
          ],
        },
      ],
    },
  ],
};

function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      let body: unknown = { entries: [], has_more: false };
      if (url.includes("/overview")) {
        body = { workloads: ["entra", "teams"] };
      } else if (url.includes("/settings/tree")) {
        body = tree;
      } else if (url.includes("/settings/2")) {
        body = {
          setting: { ...setting(2, "entra", "MFA für alle"), area: "conditionalAccessPolicy" },
          meta: {
            description: null,
            reasoning: null,
            criticality: null,
            owner: null,
            learn_url: null,
            target_set: false,
            target_value: null,
            target_source: null,
          },
          meta_history: [],
          versions: [],
          changes: [],
        };
      } else if (url.includes("object_id=2")) {
        body = {
          entries: [
            setting(2, "entra", "MFA für alle", {
              area: "conditionalAccessPolicy",
              open_changes: 2,
              deviates: true,
            }),
            setting(3, "entra", "MFA für alle", {
              area: "conditionalAccessPolicy",
              property: "GrantControls",
              value: { builtInControls: ["mfa"] },
            }),
          ],
          has_more: false,
        };
      } else if (url.includes("object_id=1")) {
        body = {
          entries: [setting(1, "teams", "Besprechungsrichtlinie")],
          has_more: false,
        };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return urls;
}

describe("SettingsPage", () => {
  it("zeigt Dienst, Bereich und Objekt als Baum und lädt Eigenschaften beim Aufklappen", async () => {
    const urls = stubFetch();
    render(<SettingsPage me={me} />);
    const services = within(await screen.findByRole("list", { name: "Dienste" }));
    const entra = services.getByText("Entra");
    expect(screen.getByText("3 Einstellungen in 2 Objekten")).toBeVisible();
    // Dienste alphabetisch, mit Zählern
    const summaries = [...document.querySelectorAll(".tree-level-1 > summary")];
    expect(summaries.map((node) => node.querySelector(".tree-name")?.textContent)).toEqual([
      "Entra",
      "Teams",
    ]);
    expect(summaries[0]).toHaveTextContent("2 offen");
    expect(summaries[0]).toHaveTextContent("1 weicht ab");
    // Zu Beginn ist nichts aufgeklappt; Eigenschaften werden erst beim Aufklappen geladen.
    expect(screen.queryByText("Bedingter Zugriff")).not.toBeInTheDocument();
    expect(urls.some((url) => url.includes("object_id="))).toBe(false);

    toggleOpen(entra.closest("details")!);
    toggleOpen((await screen.findByText("Bedingter Zugriff")).closest("details")!);
    const object = await screen.findByText("MFA für alle");
    expect(object.closest("summary")).toHaveTextContent("2 Eigenschaften");
    toggleOpen(object.closest("details")!);

    const list = within(
      await screen.findByRole("list", { name: "Eigenschaften von MFA für alle" }),
    );
    const state = list.getByRole("link", { name: /State/ });
    expect(state).toHaveAttribute("href", "/m365/einstellungen/2");
    expect(state).toHaveTextContent("offen");
    expect(state).toHaveTextContent("weicht ab");
    expect(list.getByRole("link", { name: /GrantControls/ })).toHaveTextContent(
      '{"builtInControls":["mfa"]}',
    );
    expect(urls.some((url) => url.includes("area=conditionalAccessPolicy&object_id=2"))).toBe(true);
    expect(screen.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    expect(screen.getByText(/Einstellung in der Liste wählen/)).toBeInTheDocument();
  });

  it("klappt den Weg zur geöffneten Einstellung auf", async () => {
    stubFetch();
    render(<SettingsPage me={me} selectedId={2} />);
    const list = within(
      await screen.findByRole("list", { name: "Eigenschaften von MFA für alle" }),
    );
    expect(list.getByRole("link", { name: /State/ })).toHaveAttribute("aria-current", "page");
  });
});

/** jsdom löst beim Setzen von „open“ kein toggle aus. */
function toggleOpen(details: HTMLDetailsElement) {
  details.open = !details.open;
  fireEvent(details, new Event("toggle"));
}
