import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojiPicker } from "./EmojiPicker";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("EmojiPicker", () => {
  it("sucht, wählt und merkt sich das Emoji", () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="" onChange={onChange} label="Emoji wählen" />);
    fireEvent.click(screen.getByRole("button", { name: "Emoji wählen" }));
    const dialog = screen.getByRole("dialog", { name: "Emoji wählen" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Emoji suchen" }), {
      target: { value: "schloss" },
    });
    expect(screen.getByText(/Treffer/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Schloss" })[0]!);
    expect(onChange).toHaveBeenCalledWith("🔒");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("werkbank:emoji-zuletzt")).toContain("🔒");
  });

  it("entfernt das Emoji und schließt mit Esc", () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="🌐" onChange={onChange} label="Emoji der Seite ändern" />);
    const trigger = screen.getByRole("button", { name: "Emoji der Seite ändern (jetzt Netz)" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Emoji entfernen" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("bewegt den Fokus mit den Pfeiltasten durch das Raster", () => {
    render(<EmojiPicker value="" onChange={() => undefined} label="Emoji wählen" />);
    fireEvent.click(screen.getByRole("button", { name: "Emoji wählen" }));
    const first = screen.getByRole("button", { name: "Computer" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Laptop" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-emoji-index")).toBe("9");
  });
});
