import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterBar } from "./FilterBar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Tut so, als wäre der Bildschirm so breit. */
function screenWidth(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const limit = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: limit ? width <= Number(limit[1]) : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
}

type Status = "alle" | "offen" | "fertig";

function Example() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("alle");
  const [kind, setKind] = useState("");
  const filtered = search !== "" || status !== "alle" || kind !== "";
  return (
    <>
      <FilterBar<Status>
        search={{ label: "Suchen", value: search, onChange: setSearch }}
        status={{
          label: "Status",
          value: status,
          onChange: setStatus,
          options: [
            { value: "alle", label: "Alle", count: 3 },
            { value: "offen", label: "Offen", count: 2 },
            { value: "fertig", label: "Fertig" },
          ],
        }}
        moreActive={kind ? 1 : 0}
        onReset={
          filtered
            ? () => {
                setSearch("");
                setStatus("alle");
                setKind("");
              }
            : undefined
        }
        more={
          <label className="filter-field">
            Art
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">alle</option>
              <option value="a">A</option>
            </select>
          </label>
        }
      />
      <p>
        Gewählt: {status} {kind}
      </p>
    </>
  );
}

describe("FilterBar", () => {
  it("zeigt am Computer Status-Chips und die weiteren Filter in der Zeile", () => {
    render(<Example />);
    const chips = within(screen.getByRole("group", { name: "Status" }));
    expect(chips.getByRole("button", { name: "Alle · 3" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chips.getByRole("button", { name: "Offen · 2" }));
    expect(screen.getByText("Gewählt: offen")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Art"), { target: { value: "a" } });
    expect(screen.queryByRole("button", { name: /Weitere Filter/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));
    expect(screen.getByText("Gewählt: alle")).toBeVisible();
  });

  it("zeigt am Handy den Status als Auswahl und die weiteren Filter im Blatt", () => {
    screenWidth(390);
    render(<Example />);
    expect(screen.queryByRole("group", { name: "Status" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "fertig" } });
    expect(screen.getByText("Gewählt: fertig")).toBeVisible();
    // Die weiteren Filter stehen nicht in der Zeile, sondern im Blatt.
    expect(screen.queryByLabelText("Art")).toBeNull();
    const open = screen.getByRole("button", { name: "Weitere Filter" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(open);
    const sheet = within(screen.getByRole("dialog", { name: "Weitere Filter" }));
    fireEvent.change(sheet.getByLabelText("Art"), { target: { value: "a" } });
    fireEvent.click(sheet.getByRole("button", { name: "Fertig" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Der Knopf zeigt, wie viele weitere Filter gesetzt sind.
    expect(screen.getByRole("button", { name: /Weitere Filter 1 geändert/ })).toBeVisible();
    expect(screen.getByText("Gewählt: fertig a")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Weitere Filter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Zurücksetzen" }));
    expect(screen.getByText("Gewählt: alle")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
