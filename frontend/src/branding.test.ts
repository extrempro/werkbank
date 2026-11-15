import { afterEach, describe, expect, it } from "vitest";
import {
  accentColors,
  applyBranding,
  BRANDING_KEY,
  contrast,
  DEFAULT_BRANDING,
  getBranding,
  headerLogo,
  setBranding,
  surfaceLogo,
  type Branding,
} from "./branding";

const LIGHT = "/api/branding/assets/logo-hell?v=abc123";
const DARK = "/api/branding/assets/logo-dunkel?v=def456";

afterEach(() => {
  setBranding(DEFAULT_BRANDING);
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("accentColors", () => {
  const colors = ["#1f57c3", "#ffe100", "#ffffff", "#000000", "#e4002b", "#7fd1ae", "#0a7d5a"];

  it("hält in beiden Darstellungen die Kontraste ein", () => {
    for (const accent of colors) {
      for (const theme of ["hell", "dunkel"] as const) {
        const result = accentColors(accent, theme);
        const surface = theme === "hell" ? "#f5f6f8" : "#1d2430";
        const label = `${accent} ${theme}`;
        expect(contrast(result["--farbe-primaer"]!, surface), label).toBeGreaterThanOrEqual(3);
        expect(contrast(result["--farbe-link"]!, surface), label).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(result["--farbe-auf-primaer"]!, result["--farbe-primaer"]!),
          label,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(result["--farbe-auf-primaer"]!, result["--farbe-primaer-dunkel"]!),
          label,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(result["--farbe-auswahl-text"]!, result["--farbe-auswahl"]!),
          label,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("lässt eine Farbe unverändert, die schon lesbar ist", () => {
    expect(accentColors("#1f57c3", "hell")["--farbe-primaer"]).toBe("#1f57c3");
  });
});

describe("Stand", () => {
  const custom: Branding = {
    ...DEFAULT_BRANDING,
    app_name: "IT-Portal",
    accent: "#0a7d5a",
    favicon_url: "/api/branding/assets/favicon?v=0123",
  };

  it("setzt Titel, Farben und Favicon und merkt den Stand", () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />';
    setBranding(custom);
    expect(document.title).toBe("IT-Portal");
    expect(document.documentElement.style.getPropertyValue("--farbe-primaer")).toBe("#0a7d5a");
    const link = document.querySelector('link[rel="icon"]');
    expect(link?.getAttribute("href")).toBe(custom.favicon_url);
    expect(link?.getAttribute("type")).toBe("image/png");
    expect(JSON.parse(window.localStorage.getItem(BRANDING_KEY) ?? "")).toEqual(custom);

    setBranding(DEFAULT_BRANDING);
    expect(document.title).toBe("Werkbank");
    expect(document.documentElement.style.getPropertyValue("--farbe-primaer")).toBe("");
    expect(link?.getAttribute("href")).toBe("/favicon.svg");
    expect(link?.getAttribute("type")).toBe("image/svg+xml");
  });

  it("passt die Farben an die dunkle Darstellung an", () => {
    setBranding({ ...DEFAULT_BRANDING, accent: "#102a5c" });
    const light = document.documentElement.style.getPropertyValue("--farbe-link");
    document.documentElement.dataset.theme = "dunkel";
    applyBranding();
    expect(document.documentElement.style.getPropertyValue("--farbe-link")).not.toBe(light);
  });

  it("nimmt keine fremden Adressen oder Farben an", () => {
    setBranding({ ...custom, logo_light_url: "https://example.com/logo.png" });
    expect(getBranding()).toEqual(DEFAULT_BRANDING);
    setBranding({ ...custom, accent: "url(x)" });
    expect(getBranding()).toEqual(DEFAULT_BRANDING);
  });
});

describe("Logos", () => {
  it("wählt das passende Logo und weicht auf das andere aus", () => {
    const both = { ...DEFAULT_BRANDING, logo_light_url: LIGHT, logo_dark_url: DARK };
    expect(headerLogo(both)).toBe(DARK);
    expect(surfaceLogo(both, "hell")).toBe(LIGHT);
    expect(surfaceLogo(both, "dunkel")).toBe(DARK);
    const onlyLight = { ...DEFAULT_BRANDING, logo_light_url: LIGHT };
    expect(headerLogo(onlyLight)).toBe(LIGHT);
    expect(surfaceLogo(onlyLight, "dunkel")).toBe(LIGHT);
    expect(headerLogo(DEFAULT_BRANDING)).toBeNull();
  });
});
