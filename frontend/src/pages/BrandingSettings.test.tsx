import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRANDING, getBranding, setBranding, type Branding } from "../branding";
import { BrandingSettings } from "./BrandingSettings";
import { confirmDialog } from "../test/confirm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setBranding(DEFAULT_BRANDING);
  window.localStorage.clear();
});

const LOGO = "/api/branding/assets/logo-dunkel?v=abc123";

function stubFetch(body: Branding, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(status === 200 ? body : { detail: "Abgelehnt." }), {
        status,
      });
    }),
  );
  return calls;
}

describe("BrandingSettings", () => {
  it("speichert Name und Akzentfarbe und zeigt sie sofort", async () => {
    const saved = { ...DEFAULT_BRANDING, app_name: "IT-Portal", accent: "#0a7d5a" };
    const calls = stubFetch(saved);
    render(<BrandingSettings />);
    expect(screen.queryByLabelText("Akzentfarbe")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name der Anwendung"), {
      target: { value: " IT-Portal " },
    });
    fireEvent.click(screen.getByLabelText("Eigene Akzentfarbe verwenden"));
    fireEvent.change(screen.getByLabelText("Akzentfarbe"), { target: { value: "#0a7d5a" } });
    fireEvent.click(screen.getByRole("button", { name: "Name und Farbe speichern" }));
    expect(await screen.findByText("Name und Farbe sind gespeichert.")).toBeVisible();
    expect(calls[0]?.url).toBe("/api/admin/branding");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      app_name: "IT-Portal",
      accent: "#0a7d5a",
      show_name: true,
    });
    expect(getBranding().app_name).toBe("IT-Portal");
    expect(document.title).toBe("IT-Portal");
  });

  it("schickt ohne eigene Farbe keine Farbe mit", async () => {
    const calls = stubFetch(DEFAULT_BRANDING);
    render(<BrandingSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Name und Farbe speichern" }));
    await screen.findByText("Name und Farbe sind gespeichert.");
    expect(JSON.parse(String(calls[0]?.init?.body)).accent).toBeNull();
  });

  it("lädt ein Logo hoch", async () => {
    const calls = stubFetch({ ...DEFAULT_BRANDING, logo_dark_url: LOGO });
    render(<BrandingSettings />);
    const file = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Bild hochladen – Logo für dunklen Hintergrund/), {
      target: { files: [file] },
    });
    expect(await screen.findByText("Logo für dunklen Hintergrund: gespeichert.")).toBeVisible();
    expect(calls[0]?.url).toBe("/api/admin/branding/assets/logo-dunkel");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ content_base64: "iVBORw==" });
    expect(getBranding().logo_dark_url).toBe(LOGO);
    expect(
      screen.getByRole("button", { name: /Entfernen – Logo für dunklen Hintergrund/ }),
    ).toBeVisible();
  });

  it("lehnt falsche Formate und zu große Dateien schon im Browser ab", async () => {
    const calls = stubFetch(DEFAULT_BRANDING);
    render(<BrandingSettings />);
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByLabelText(/Bild hochladen – Logo für hellen Hintergrund/), {
      target: { files: [svg] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Erlaubt sind PNG-, WebP- und JPEG-Dateien.",
    );
    // Lässt sich das Bild im Browser nicht verkleinern, bleibt die Grenze für die Dateigröße.
    const big = new File([new Uint8Array(DEFAULT_BRANDING.max_image_bytes + 1)], "gross.png", {
      type: "image/png",
    });
    fireEvent.change(screen.getByLabelText(/Bild hochladen – Favicon/), {
      target: { files: [big] },
    });
    expect(await screen.findByText(/Die Datei ist zu groß/)).toBeVisible();
    expect(calls).toHaveLength(0);
  });

  it("bietet die Wahl zwischen automatischer Anpassung und Original", () => {
    render(<BrandingSettings />);
    const auto = screen.getByRole("button", { name: "Automatisch anpassen (empfohlen)" });
    expect(auto).toHaveAttribute("aria-pressed", "true");
    const original = screen.getByRole("button", { name: "Original behalten" });
    fireEvent.click(original);
    expect(original).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Vergrößert wird nie/)).toBeVisible();
  });

  it("entfernt ein Bild und zeigt die Meldung des Servers bei Fehlern", async () => {
    setBranding({ ...DEFAULT_BRANDING, logo_dark_url: LOGO });
    const calls = stubFetch(DEFAULT_BRANDING);
    render(<BrandingSettings />);
    fireEvent.click(
      screen.getByRole("button", { name: /Entfernen – Logo für dunklen Hintergrund/ }),
    );
    await confirmDialog("Entfernen");
    expect(await screen.findByText("Logo für dunklen Hintergrund: entfernt.")).toBeVisible();
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(getBranding().logo_dark_url).toBeNull();

    stubFetch(DEFAULT_BRANDING, 422);
    fireEvent.click(screen.getByRole("button", { name: "Name und Farbe speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Abgelehnt.");
  });
});
