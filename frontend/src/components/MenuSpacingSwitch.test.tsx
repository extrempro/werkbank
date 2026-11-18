import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyMenuSpacing, MENU_SPACING_KEY, storedMenuSpacing } from "../menuSize";
import { MenuSpacingSwitch } from "./MenuSpacingSwitch";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.menuSpacing;
});

describe("MenuSpacingSwitch", () => {
  it("steht ohne Auswahl auf „Normal“", () => {
    render(<MenuSpacingSwitch />);
    expect(screen.getByRole("group", { name: "Abstände im Menü" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Normal" })).toBeChecked();
    expect(document.documentElement.dataset.menuSpacing).toBeUndefined();
  });

  it("schaltet auf kompakt und weiträumig, merkt sich das und kehrt zu normal zurück", () => {
    render(<MenuSpacingSwitch />);
    fireEvent.click(screen.getByRole("radio", { name: "Kompakt" }));
    expect(document.documentElement.dataset.menuSpacing).toBe("kompakt");
    expect(window.localStorage.getItem(MENU_SPACING_KEY)).toBe("kompakt");
    fireEvent.click(screen.getByRole("radio", { name: "Weiträumig" }));
    expect(document.documentElement.getAttribute("data-menu-spacing")).toBe("weit");
    fireEvent.click(screen.getByRole("radio", { name: "Normal" }));
    expect(document.documentElement.dataset.menuSpacing).toBeUndefined();
    expect(window.localStorage.getItem(MENU_SPACING_KEY)).toBeNull();
  });

  it("zeigt eine gespeicherte Auswahl und ignoriert unbekannte Werte", () => {
    window.localStorage.setItem(MENU_SPACING_KEY, "weit");
    render(<MenuSpacingSwitch />);
    expect(screen.getByRole("radio", { name: "Weiträumig" })).toBeChecked();
    window.localStorage.setItem(MENU_SPACING_KEY, "riesig");
    expect(storedMenuSpacing()).toBe("normal");
    applyMenuSpacing();
    expect(document.documentElement.dataset.menuSpacing).toBeUndefined();
  });
});
