import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, AUTH_EVENT, errorText, getJson, loginUrl, putJson } from "../api";
import { AuthBanner } from "./AuthBanner";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(status: number, stepUp = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "Erneute Anmeldung erforderlich" }), {
          status,
          headers: stepUp ? { "X-Werkbank-Step-Up": "required" } : {},
        }),
    ),
  );
}

function listen(): string[] {
  const seen: string[] = [];
  window.addEventListener(AUTH_EVENT, (event) => seen.push((event as CustomEvent<string>).detail), {
    once: true,
  });
  return seen;
}

describe("Meldungen zur Anmeldung", () => {
  it("meldet eine zu alte Anmeldung beim Speichern", async () => {
    stubFetch(403, true);
    const seen = listen();
    const error = await putJson("/api/admin/branding", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).stepUpRequired).toBe(true);
    expect(seen).toEqual(["anmeldung-zu-alt"]);
    expect(errorText(error, "x")).toMatch(/frische Anmeldung nötig/);
  });

  it("meldet eine abgelaufene Sitzung beim Lesen und beim Speichern", async () => {
    stubFetch(401);
    const first = listen();
    await getJson("/api/tasks").catch(() => undefined);
    expect(first).toEqual(["abgemeldet"]);
    const second = listen();
    await putJson("/api/x", {}).catch(() => undefined);
    expect(second).toEqual(["abgemeldet"]);
  });

  it("meldet bei fehlender Berechtigung nichts", async () => {
    stubFetch(403);
    const seen = listen();
    const error = await putJson("/api/x", {}).catch((caught: unknown) => caught);
    expect(seen).toEqual([]);
    expect(errorText(error, "Ersatz")).toBe("Erneute Anmeldung erforderlich");
  });

  it("baut die Adresse zur Anmeldung mit Rückweg", () => {
    expect(loginUrl("/")).toBe("/auth/login");
    expect(loginUrl("/m365/einstellungen/7")).toBe(
      "/auth/login?return_to=%2Fm365%2Feinstellungen%2F7",
    );
  });
});

describe("AuthBanner", () => {
  it("erscheint erst bei zu alter Anmeldung und bietet die erneute Anmeldung an", () => {
    render(<AuthBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: "abgemeldet" }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: "anmeldung-zu-alt" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte melde dich erneut an.");
    expect(screen.getByRole("link", { name: "Erneut anmelden" })).toHaveAttribute(
      "href",
      "/auth/login?step_up=true&return_to=%2F",
    );
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
