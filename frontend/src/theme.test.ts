import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, resolveTheme, saveTheme, storedTheme, THEME_KEY } from "./theme";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("Darstellung", () => {
  it("folgt bei „auto“ dem Gerät und sonst der Auswahl", () => {
    expect(resolveTheme("auto", true)).toBe("dunkel");
    expect(resolveTheme("auto", false)).toBe("hell");
    expect(resolveTheme("hell", true)).toBe("hell");
    expect(resolveTheme("dunkel", false)).toBe("dunkel");
  });

  it("speichert die Auswahl im Browser und setzt sie am Dokument", () => {
    saveTheme("dunkel");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dunkel");
    expect(storedTheme()).toBe("dunkel");
    expect(document.documentElement.dataset.theme).toBe("dunkel");
  });

  it("entfernt die Auswahl bei „auto“ und ignoriert fremde Werte", () => {
    saveTheme("hell");
    saveTheme("auto");
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    window.localStorage.setItem(THEME_KEY, "bunt");
    expect(storedTheme()).toBe("auto");
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe("hell");
  });
});
