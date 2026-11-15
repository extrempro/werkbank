/**
 * Darstellung hell/dunkel. „auto“ folgt der Einstellung des Geräts.
 * Die Auswahl gilt für diesen Browser (localStorage), nicht für das Konto.
 * Beim Laden der Seite setzt public/theme.js den ersten Stand.
 */

import { useSyncExternalStore } from "react";

export type ThemeChoice = "auto" | "hell" | "dunkel";

export const THEME_KEY = "werkbank-darstellung";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function deviceWantsDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function storedTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "hell" || value === "dunkel" ? value : "auto";
  } catch {
    return "auto";
  }
}

export function resolveTheme(choice: ThemeChoice, deviceDark: boolean): "hell" | "dunkel" {
  if (choice === "auto") {
    return deviceDark ? "dunkel" : "hell";
  }
  return choice;
}

export function applyTheme(choice: ThemeChoice = storedTheme()): void {
  document.documentElement.dataset.theme = resolveTheme(choice, deviceWantsDark());
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === "auto") {
      window.localStorage.removeItem(THEME_KEY);
    } else {
      window.localStorage.setItem(THEME_KEY, choice);
    }
  } catch {
    // Speicher gesperrt: Die Auswahl gilt dann nur bis zum Neuladen.
  }
  applyTheme(choice);
}

/** Reagiert auf Wechsel am Gerät und auf eine Auswahl in einem anderen Tab. */
export function watchTheme(): () => void {
  const update = () => applyTheme();
  const query = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  query?.addEventListener("change", update);
  window.addEventListener("storage", update);
  return () => {
    query?.removeEventListener("change", update);
    window.removeEventListener("storage", update);
  };
}

/** Aktuell angezeigte Darstellung (nach Auswahl oder Gerät). */
export function currentTheme(): "hell" | "dunkel" {
  return document.documentElement.dataset.theme === "dunkel" ? "dunkel" : "hell";
}

function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** Aktuelle Darstellung; ändert sich mit, wenn umgeschaltet wird. */
export function useTheme(): "hell" | "dunkel" {
  return useSyncExternalStore(subscribeTheme, currentTheme);
}
