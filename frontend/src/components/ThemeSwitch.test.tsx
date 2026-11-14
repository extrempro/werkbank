import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_KEY } from "../theme";
import { ThemeSwitch } from "./ThemeSwitch";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("ThemeSwitch", () => {
  it("steht ohne Auswahl auf „Automatisch“", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("group", { name: "Darstellung" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Automatisch" })).toBeChecked();
  });

  it("schaltet auf dunkel und merkt sich die Auswahl", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("radio", { name: "Dunkel" }));
    expect(screen.getByRole("radio", { name: "Dunkel" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dunkel");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dunkel");
  });

  it("zeigt eine gespeicherte Auswahl an", () => {
    window.localStorage.setItem(THEME_KEY, "hell");
    render(<ThemeSwitch />);
    expect(screen.getByRole("radio", { name: "Hell" })).toBeChecked();
  });
});
