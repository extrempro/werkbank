import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Me } from "../api";
import { StartPage } from "./StartPage";

afterEach(cleanup);

const me: Me = {
  display_name: "Rita Reviewer",
  email: null,
  roles: ["Config.Reviewer"],
  authenticated_at: "2026-11-14T08:00:00Z",
};

describe("StartPage", () => {
  it("zeigt Aufgaben mit Anzahl und Ziel", () => {
    const tasks = [
      {
        module: "M365-Konfiguration",
        title: "Änderungen bewerten",
        subtitle: "Erkannte Änderungen einordnen",
        link: "/m365/aenderungen",
        count: 3,
      },
      {
        module: "M365-Konfiguration",
        title: "Abruf aus dem Tenant ist fehlgeschlagen",
        subtitle: null,
        link: "/m365/snapshots",
        count: 1,
      },
    ];
    render(<StartPage me={me} tasks={tasks} />);
    expect(screen.getByRole("link", { name: "Änderungen bewerten (3)" })).toHaveAttribute(
      "href",
      "/m365/aenderungen",
    );
    expect(
      screen.getByRole("link", { name: "Abruf aus dem Tenant ist fehlgeschlagen" }),
    ).toBeVisible();
    expect(screen.queryByText("Keine offenen Aufgaben.")).toBeNull();
  });

  it("zeigt den leeren Zustand und den Ladezustand", () => {
    const { rerender } = render(<StartPage me={me} tasks={[]} />);
    expect(screen.getByText("Keine offenen Aufgaben.")).toBeVisible();
    rerender(<StartPage me={me} tasks={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Wird geladen");
  });
});
