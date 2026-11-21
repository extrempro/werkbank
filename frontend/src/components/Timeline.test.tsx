import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline, monthLabel } from "./Timeline";

afterEach(cleanup);

const today = new Date(2026, 10, 21);

describe("Timeline", () => {
  it("benennt Monate auf Deutsch", () => {
    expect(monthLabel("2027-03")).toBe("Mär 2027");
  });

  it("zeigt Phasen als Balken und zusätzlich als Liste mit Zustand", () => {
    const { container } = render(
      <Timeline
        label="Rollout-Phasen"
        today={today}
        phases={[
          { name: "Vorschau", start: "2026-09", end: "2026-10" },
          { name: "Targeted Release", start: "2026-11", end: "2026-12" },
          { name: "Allgemein verfügbar", start: "2027-01", end: "2027-01" },
        ]}
        previous={[{ name: "Alt", start: "2026-10", end: "2026-10" }]}
      />,
    );
    const grid = container.querySelector(".timeline-grid");
    expect(grid).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".timeline-month")).toHaveLength(5);
    expect(container.querySelector(".timeline-bar-old")).toHaveTextContent("Alt");
    expect(container.querySelector(".timeline-bar-done")).toHaveTextContent("Vorschau");
    expect(container.querySelector(".timeline-bar-running")).toHaveTextContent("Targeted");
    expect(container.querySelector(".timeline-bar-planned")).toHaveTextContent("Allgemein");
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Alt: Okt 2026 (vorher geplant)",
      "Vorschau: Sep 2026 bis Okt 2026 (abgeschlossen)",
      "Targeted Release: Nov 2026 bis Dez 2026 (läuft)",
      "Allgemein verfügbar: Jan 2027 (geplant)",
    ]);
  });

  it("begrenzt sehr lange Zeiträume auf 18 Monate", () => {
    const { container } = render(
      <Timeline
        label="Rollout"
        today={today}
        phases={[{ name: "Lang", start: "2026-01", end: "2028-12" }]}
      />,
    );
    expect(container.querySelectorAll(".timeline-month")).toHaveLength(18);
  });
});
