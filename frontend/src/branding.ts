/**
 * Branding: Name, Akzentfarbe, Logos und Favicon aus der Verwaltung.
 * Der Stand kommt von /api/branding (auch ohne Anmeldung) und wird im Browser gemerkt,
 * damit beim nächsten Laden nicht kurz das Standardaussehen aufblitzt.
 */

import { useSyncExternalStore } from "react";

export interface Branding {
  app_name: string;
  /** Eigene Akzentfarbe als #rrggbb, sonst null. */
  accent: string | null;
  /** Name neben dem Logo anzeigen. Ohne Logo steht der Name immer da. */
  show_name: boolean;
  logo_light_url: string | null;
  logo_dark_url: string | null;
  /** Logo für Mails (PNG); fehlt in älteren gemerkten Ständen */
  logo_mail_url?: string | null;
  favicon_url: string | null;
  /** Fußzeile aller Mails */
  mail_footer?: string;
  /** Link zur Datenschutzerklärung in Mails (https) */
  privacy_url?: string;
  max_image_bytes: number;
}

export type Theme = "hell" | "dunkel";

export const DEFAULT_BRANDING: Branding = {
  app_name: "Werkbank",
  accent: null,
  show_name: true,
  logo_light_url: null,
  logo_dark_url: null,
  logo_mail_url: null,
  favicon_url: null,
  mail_footer: "",
  privacy_url: "",
  max_image_bytes: 256 * 1024,
};

export const BRANDING_KEY = "werkbank-branding";
const HEX = /^#[0-9a-f]{6}$/;
const ASSET_URL = /^\/api\/branding\/assets\/[a-z-]+\?v=[0-9a-f]+$/;

// --- Farben --------------------------------------------------------------------------

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const DARK_TEXT = "#000000";
/** Flächen, auf denen die Farbe lesbar sein muss (jeweils die ungünstigste je Darstellung). */
const SURFACE: Record<Theme, { test: string; panel: string }> = {
  hell: { test: "#f5f6f8", panel: "#ffffff" },
  dunkel: { test: "#1d2430", panel: "#171c26" },
};

function parseHex(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

function mix(from: Rgb, to: Rgb, share: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * share,
    from[1] + (to[1] - from[1]) * share,
    from[2] + (to[2] - from[2]) * share,
  ];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((part) => {
    const value = part / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis nach WCAG, 1 bis 21. */
export function contrast(first: string, second: string): number {
  const a = luminance(parseHex(first));
  const b = luminance(parseHex(second));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Dunkelt (hell) bzw. hellt (dunkel) die Farbe schrittweise an, bis der Kontrast reicht. */
function readable(color: string, surface: string, minimum: number, theme: Theme): string {
  const start = parseHex(color);
  const target = theme === "hell" ? BLACK : WHITE;
  for (let step = 0; step <= 25; step += 1) {
    const candidate = toHex(mix(start, target, step / 25));
    if (contrast(candidate, surface) >= minimum) {
      return candidate;
    }
  }
  return toHex(target);
}

/**
 * Leitet aus der Akzentfarbe die Farben der Oberfläche ab. Jede Farbe wird so weit angepasst,
 * dass sie in der jeweiligen Darstellung lesbar bleibt (WCAG 2.2 AA).
 */
export function accentColors(accent: string, theme: Theme): Record<string, string> {
  const surface = SURFACE[theme];
  const primary = readable(accent, surface.test, 3, theme);
  const onPrimary =
    contrast(primary, "#ffffff") >= contrast(primary, DARK_TEXT) ? "#ffffff" : DARK_TEXT;
  const hover = toHex(mix(parseHex(primary), onPrimary === "#ffffff" ? BLACK : WHITE, 0.18));
  const link = readable(accent, surface.test, 4.5, theme);
  const selected = toHex(
    mix(parseHex(surface.panel), parseHex(accent), theme === "hell" ? 0.12 : 0.24),
  );
  return {
    "--farbe-primaer": primary,
    "--farbe-primaer-dunkel": hover,
    "--farbe-auf-primaer": onPrimary,
    "--farbe-link": link,
    "--farbe-modul": link,
    "--farbe-balken": primary,
    "--farbe-auswahl": selected,
    "--farbe-auswahl-text": readable(accent, selected, 4.5, theme),
  };
}

const ACCENT_VARIABLES = Object.keys(accentColors("#1f57c3", "hell"));

// --- Stand ---------------------------------------------------------------------------

function isBranding(value: unknown): value is Branding {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const data = value as Record<string, unknown>;
  const url = (entry: unknown) =>
    entry === null || (typeof entry === "string" && ASSET_URL.test(entry));
  return (
    typeof data.app_name === "string" &&
    data.app_name.length > 0 &&
    data.app_name.length <= 40 &&
    (data.accent === null || (typeof data.accent === "string" && HEX.test(data.accent))) &&
    typeof data.show_name === "boolean" &&
    url(data.logo_light_url) &&
    url(data.logo_dark_url) &&
    url(data.favicon_url) &&
    typeof data.max_image_bytes === "number"
  );
}

function cachedBranding(): Branding {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(BRANDING_KEY) ?? "null");
    return isBranding(parsed) ? parsed : DEFAULT_BRANDING;
  } catch {
    return DEFAULT_BRANDING;
  }
}

let current: Branding = DEFAULT_BRANDING;
const listeners = new Set<() => void>();

function theme(): Theme {
  return document.documentElement.dataset.theme === "dunkel" ? "dunkel" : "hell";
}

function applyFavicon(url: string | null): void {
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => {
    if (link.dataset.standard === undefined) {
      link.dataset.standard = link.getAttribute("href") ?? "";
      link.dataset.standardType = link.getAttribute("type") ?? "";
    }
    link.setAttribute("href", url ?? link.dataset.standard);
    link.setAttribute("type", url ? "image/png" : (link.dataset.standardType ?? ""));
  });
}

/** Überträgt den Stand auf die Seite: Titel, Favicon und Farben der aktuellen Darstellung. */
export function applyBranding(branding: Branding = current): void {
  document.title = branding.app_name;
  applyFavicon(branding.favicon_url);
  const style = document.documentElement.style;
  if (branding.accent) {
    for (const [name, value] of Object.entries(accentColors(branding.accent, theme()))) {
      style.setProperty(name, value);
    }
  } else {
    ACCENT_VARIABLES.forEach((name) => style.removeProperty(name));
  }
}

export function getBranding(): Branding {
  return current;
}

/** Setzt einen neuen Stand, merkt ihn im Browser und zeigt ihn sofort an. */
export function setBranding(branding: Branding): void {
  if (!isBranding(branding)) {
    return;
  }
  current = branding;
  try {
    window.localStorage.setItem(BRANDING_KEY, JSON.stringify(branding));
  } catch {
    // Speicher gesperrt: Der Stand wird dann bei jedem Laden neu geholt.
  }
  applyBranding();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBranding(): Branding {
  return useSyncExternalStore(subscribe, getBranding);
}

/** Beim Start: gemerkten Stand anzeigen, aktuellen holen, auf Wechsel hell/dunkel reagieren. */
export function initBranding(): void {
  current = cachedBranding();
  applyBranding();
  new MutationObserver(() => applyBranding()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  fetch("/api/branding", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) => {
      if (isBranding(data)) {
        setBranding(data);
      }
    })
    .catch(() => {
      // Ohne Netz bleibt der gemerkte Stand.
    });
}

/** Logo für den dunklen Kopf der Anwendung. */
export function headerLogo(branding: Branding): string | null {
  return branding.logo_dark_url ?? branding.logo_light_url;
}

/** Logo für Flächen in der aktuellen Darstellung (Anmeldeseite). */
export function surfaceLogo(branding: Branding, shown: Theme): string | null {
  return shown === "dunkel"
    ? (branding.logo_dark_url ?? branding.logo_light_url)
    : (branding.logo_light_url ?? branding.logo_dark_url);
}
