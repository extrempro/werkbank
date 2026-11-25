import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { DokuEditor } from "./DokuEditor";
import { tableSpot } from "./DokuTable";
import { confirmDialog } from "../../test/confirm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  let editor: Editor | null = null;
  render(
    <DokuEditor
      editable
      label="Inhalt"
      content={{ type: "doc", content: [{ type: "paragraph" }] }}
      onReady={(current) => {
        editor = current;
      }}
    />,
  );
  if (!editor) {
    throw new Error("Editor fehlt");
  }
  return editor as Editor;
}

describe("Doku: Tabellen", () => {
  it("fügt eine Tabelle in der gewählten Größe ein, mit oder ohne Kopfzeile", () => {
    const editor = setup();
    fireEvent.click(screen.getByRole("button", { name: /Baustein/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /Tabelle/ }));
    const picker = screen.getByRole("dialog", { name: "Tabelle einfügen" });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "Erste Zeile ist Kopfzeile" }));
    fireEvent.click(within(picker).getByRole("button", { name: "2 Zeilen × 4 Spalten" }));
    const spot = tableSpot(editor.state);
    expect(spot).toMatchObject({ rows: 2, cols: 4, header: false, row: 0, col: 0 });
    expect(screen.queryByRole("dialog", { name: "Tabelle einfügen" })).toBeNull();
  });

  it("bearbeitet Zeilen und Spalten über die Leiste und die Ränder", () => {
    const editor = setup();
    act(() => {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    });
    const tools = screen.getByRole("toolbar", { name: "Tabelle" });
    expect(within(tools).getByText(/Kopfzeile, Spalte 1/)).toBeInTheDocument();
    fireEvent.click(within(tools).getByRole("button", { name: "↓ darunter" }));
    expect(tableSpot(editor.state)?.rows).toBe(4);
    fireEvent.click(within(tools).getByRole("button", { name: "→ rechts" }));
    expect(tableSpot(editor.state)?.cols).toBe(4);
    fireEvent.click(within(tools).getByRole("button", { name: "Spalte löschen" }));
    expect(tableSpot(editor.state)?.cols).toBe(3);
    const header = within(tools).getByRole("button", { name: "Kopfzeile" });
    expect(header).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(header);
    expect(tableSpot(editor.state)?.header).toBe(false);
  });

  it("löscht die Tabelle erst nach Bestätigung", async () => {
    const editor = setup();
    act(() => {
      editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    });
    const tools = screen.getByRole("toolbar", { name: "Tabelle" });
    fireEvent.click(within(tools).getByRole("button", { name: "Tabelle löschen" }));
    expect(tableSpot(editor.state)).not.toBeNull();
    await confirmDialog("Löschen");
    expect(tableSpot(editor.state)).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Tabelle" })).toBeNull();
  });
});
