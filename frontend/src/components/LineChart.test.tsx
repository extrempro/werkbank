import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axisTicks, formatDay, LineChart, niceStep } from "./LineChart";

afterEach(cleanup);

describe("Achse des Liniendiagramms", () => {
  it("wählt runde Schritte, mindestens 1", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(3)).toBe(1);
    expect(niceStep(40)).toBe(10);
    expect(niceStep(130)).toBe(50);
  });

  it("schließt alle Werte ein, auch wenn sie gleich sind", () => {
    expect(axisTicks(48, 50)).toEqual([48, 49, 50]);
    expect(axisTicks(20, 20)).toEqual([20, 21]);
    expect(axisTicks(95, 132)).toEqual([90, 100, 110, 120, 130, 140]);
  });

  it("schreibt Tage deutsch", () => {
    expect(formatDay("2026-11-05")).toBe("05.11.2026");
    expect(formatDay("kaputt")).toBe("kaputt");
  });
});

describe("LineChart", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03"];
  const series = [
    { id: "gekauft", label: "Gekauft", values: [50, 50, 60] },
    { id: "zugewiesen", label: "Zugewiesen", values: [45, null, 49] },
  ];

  it("zeigt den letzten Tag, lässt einen anderen wählen und bietet eine Tabelle", () => {
    render(<LineChart title="Verlauf der Lizenz" days={days} series={series} />);
    expect(
      screen.getByRole("img", { name: /^Verlauf der Lizenz: 01.11.2026 bis 03.11.2026/ }),
    ).toBeVisible();
    const legend = screen.getByRole("list");
    expect(legend).toHaveTextContent("Gekauft: 60");
    expect(legend).toHaveTextContent("Zugewiesen: 49");

    fireEvent.change(screen.getByLabelText("Tag wählen"), { target: { value: "1" } });
    expect(screen.getByText("02.11.2026", { selector: ".chart-day" })).toBeVisible();
    expect(legend).toHaveTextContent("Gekauft: 50");
    expect(legend).toHaveTextContent("Zugewiesen: –");

    // Die Tabelle steht in einem aufklappbaren Bereich.
    document.querySelector("details")?.setAttribute("open", "");
    const table = within(screen.getByRole("region", { name: "Verlauf der Lizenz" }));
    // neuester Tag zuerst
    expect(table.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      "03.11.2026",
      "02.11.2026",
      "01.11.2026",
    ]);
    expect(table.getByRole("row", { name: /^02.11.2026/ })).toHaveTextContent("50–");
  });

  it("kommt mit einem einzelnen Tag und mit leeren Daten zurecht", () => {
    const { rerender } = render(
      <LineChart
        title="Benutzer"
        days={["2026-11-01"]}
        series={[{ id: "a", label: "Konten", values: [120] }]}
      />,
    );
    expect(screen.getByRole("list")).toHaveTextContent("Konten: 120");
    expect(screen.queryByLabelText("Tag wählen")).toBeNull();
    rerender(<LineChart title="Benutzer" days={[]} series={[]} />);
    expect(screen.getByText("Noch kein Verlauf vorhanden.")).toBeVisible();
  });
});
