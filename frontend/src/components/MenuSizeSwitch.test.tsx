import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyMenuSize, MENU_SIZE_KEY, storedMenuSize } from "../menuSize";
import { MenuSizeSwitch } from "./MenuSizeSwitch";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.menu;
});

describe("MenuSizeSwitch", () => {
  it("steht ohne Auswahl auf „Normal“", () => {
    render(<MenuSizeSwitch />);
    expect(screen.getByRole("group", { name: "Schriftgröße im Menü" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Normal" })).toBeChecked();
    expect(document.documentElement.dataset.menu).toBeUndefined();
  });

  it("schaltet auf groß, merkt sich das und kehrt zu normal zurück", () => {
    render(<MenuSizeSwitch />);
    fireEvent.click(screen.getByRole("radio", { name: "Groß" }));
    expect(document.documentElement.dataset.menu).toBe("gross");
    expect(window.localStorage.getItem(MENU_SIZE_KEY)).toBe("gross");
    fireEvent.click(screen.getByRole("radio", { name: "Normal" }));
    expect(document.documentElement.dataset.menu).toBeUndefined();
    expect(window.localStorage.getItem(MENU_SIZE_KEY)).toBeNull();
  });

  it("zeigt eine gespeicherte Auswahl und ignoriert unbekannte Werte", () => {
    window.localStorage.setItem(MENU_SIZE_KEY, "sehr-gross");
    render(<MenuSizeSwitch />);
    expect(screen.getByRole("radio", { name: "Sehr groß" })).toBeChecked();
    window.localStorage.setItem(MENU_SIZE_KEY, "riesig");
    expect(storedMenuSize()).toBe("normal");
    applyMenuSize();
    expect(document.documentElement.dataset.menu).toBeUndefined();
  });
});
