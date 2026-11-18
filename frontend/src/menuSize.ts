/**
 * Schriftgröße im Menü (Navigation links, auf dem Handy das aufgeklappte Menü).
 * Die Auswahl gilt für diesen Browser (localStorage), nicht für das Konto.
 * Beim Laden der Seite setzt public/theme.js den ersten Stand.
 */

export type MenuSize = "klein" | "normal" | "gross" | "sehr-gross";

export const MENU_SIZE_KEY = "werkbank-menue-schrift";
const SIZES: readonly MenuSize[] = ["klein", "normal", "gross", "sehr-gross"];

function isMenuSize(value: unknown): value is MenuSize {
  return typeof value === "string" && (SIZES as readonly string[]).includes(value);
}

export function storedMenuSize(): MenuSize {
  try {
    const value = window.localStorage.getItem(MENU_SIZE_KEY);
    return isMenuSize(value) ? value : "normal";
  } catch {
    return "normal";
  }
}

/** Setzt data-menu am Wurzelelement; „normal“ entfernt es. */
export function applyMenuSize(size: MenuSize = storedMenuSize()): void {
  if (size === "normal") {
    delete document.documentElement.dataset.menu;
  } else {
    document.documentElement.dataset.menu = size;
  }
}

export function saveMenuSize(size: MenuSize): void {
  try {
    if (size === "normal") {
      window.localStorage.removeItem(MENU_SIZE_KEY);
    } else {
      window.localStorage.setItem(MENU_SIZE_KEY, size);
    }
  } catch {
    // Speicher gesperrt: Die Auswahl gilt dann nur bis zum Neuladen.
  }
  applyMenuSize(size);
}

/** Übernimmt eine Auswahl aus einem anderen Tab. */
export function watchMenuSize(): () => void {
  const update = () => applyMenuSize();
  window.addEventListener("storage", update);
  return () => window.removeEventListener("storage", update);
}
