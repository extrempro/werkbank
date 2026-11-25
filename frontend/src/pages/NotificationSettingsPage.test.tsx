import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storedSounds } from "../sounds";
import { NotificationSettingsPage } from "./NotificationSettingsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const settings = {
  kinds: [
    {
      kind: "budget.rechnung_pruefen",
      module: "IT-Budget",
      label: "Rechnung wartet auf Prüfung",
      enabled: true,
      mail: false,
      teams: false,
      push: false,
    },
  ],
  channels: { mail: false, teams: false, push: false, has_email: true },
};

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(settings), { status: 200 })),
  );
}

function phone(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

describe("NotificationSettingsPage", () => {
  it("wählt den Ton je Bereich und merkt ihn sich im Browser", async () => {
    stub();
    render(<NotificationSettingsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Benachrichtigungen" })).toBeVisible();
    const select = await screen.findByRole("combobox", { name: "Ton für IT-Budget" });
    expect(select).toHaveValue("glocke");
    fireEvent.change(select, { target: { value: "gong" } });
    expect(storedSounds().tones["IT-Budget"]).toBe("gong");
    expect(screen.getByRole("button", { name: "Ton für IT-Budget anhören: Gong" })).toBeEnabled();
    fireEvent.change(select, { target: { value: "aus" } });
    expect(
      screen.getByRole("button", { name: "Ton für IT-Budget anhören: Kein Ton" }),
    ).toBeDisabled();
  });

  it("schaltet Töne ein und sperrt die übrigen Einstellungen, solange sie aus sind", async () => {
    stub();
    render(<NotificationSettingsPage />);
    const section = screen.getByRole("region", { name: "Töne" });
    const quiet = within(section).getByRole("checkbox", { name: /Ruhezeit/ });
    expect(quiet).toBeDisabled();
    fireEvent.click(within(section).getByRole("checkbox", { name: "Töne abspielen" }));
    expect(storedSounds().enabled).toBe(true);
    expect(quiet).toBeEnabled();
    fireEvent.click(quiet);
    expect(storedSounds().quiet).toBe(true);
    fireEvent.change(within(section).getByRole("slider", { name: /Lautstärke/ }), {
      target: { value: "30" },
    });
    expect(storedSounds().volume).toBe(30);
  });

  it("zeigt am Handy je Art eine Zeile, die Wege klappen auf", async () => {
    phone(true);
    stub();
    render(<NotificationSettingsPage />);
    const row = await screen.findByRole("button", { name: /Rechnung wartet auf Prüfung/ });
    expect(row).toHaveTextContent("Glocke");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("checkbox", { name: "Rechnung wartet auf Prüfung: Glocke" }),
    ).toBeNull();
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("checkbox", { name: "Rechnung wartet auf Prüfung: Glocke" }),
    ).toBeChecked();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
