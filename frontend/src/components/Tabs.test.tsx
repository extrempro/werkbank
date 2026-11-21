import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, tabIds } from "./Tabs";

afterEach(cleanup);

const TABS = [
  { id: "a", label: "Erster" },
  { id: "b", label: "Zweiter" },
  { id: "c", label: "Dritter" },
] as const;

function Demo() {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <>
      <Tabs label="Beispiel" prefix="demo" tabs={TABS} value={value} onChange={setValue} />
      <div
        role="tabpanel"
        id={tabIds("demo", value).panel}
        aria-labelledby={tabIds("demo", value).tab}
      >
        Inhalt {value}
      </div>
    </>
  );
}

describe("Tabs", () => {
  it("wählt mit Klick, Pfeiltasten, Pos1 und Ende", () => {
    render(<Demo />);
    expect(screen.getByRole("tablist", { name: "Beispiel" })).toBeVisible();
    const first = screen.getByRole("tab", { name: "Erster" });
    expect(first).toHaveAttribute("aria-controls", "demo-panel-a");
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Dritter" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Dritter" }), { key: "Home" });
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(first, { key: "End" });
    expect(screen.getByRole("tabpanel", { name: "Dritter" })).toHaveTextContent("Inhalt c");
    fireEvent.click(screen.getByRole("tab", { name: "Zweiter" }));
    expect(screen.getByRole("tab", { name: "Zweiter" })).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
  });
});
