import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Me } from "../api";
import { AccountPage } from "./AccountPage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const me: Me = {
  user_id: "11111111-1111-1111-1111-111111111111",
  display_name: "Erika Beispiel",
  email: "erika@example.com",
  roles: ["Config.Reviewer", "Evergreen.Editor"],
  authenticated_at: "2026-11-14T08:00:00Z",
  session_expires_at: "2026-11-14T16:00:00Z",
  avatar_url: null,
  version: "0.3.0",
};

describe("AccountPage", () => {
  it("zeigt Angaben, Rollen mit Beschreibung, Sitzung und Version", () => {
    render(<AccountPage me={me} />);
    expect(screen.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible();
    expect(screen.getByText("erika@example.com")).toBeVisible();
    expect(screen.getByText("EB")).toBeInTheDocument();
    expect(screen.getByText("Konfiguration Prüfer")).toBeVisible();
    expect(screen.getByText("Evergreen.Editor")).toBeVisible();
    expect(screen.getByText("Läuft spätestens ab")).toBeVisible();
    expect(screen.getByText("0.3.0")).toBeVisible();
    expect(screen.getByRole("link", { name: "Neuigkeiten ansehen" })).toHaveAttribute(
      "href",
      "/neuigkeiten",
    );
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeVisible();
  });

  it("zeigt das Profilbild und fällt bei einem Fehler auf die Initialen zurück", () => {
    const url = "/api/users/11111111-1111-1111-1111-111111111111/avatar?v=abc";
    const { container } = render(<AccountPage me={{ ...me, avatar_url: url }} />);
    const image = container.querySelector("img.avatar");
    expect(image).toHaveAttribute("src", url);
    expect(screen.queryByText("EB")).toBeNull();
    fireEvent.error(image as Element);
    expect(screen.getByText("EB")).toBeInTheDocument();
  });

  it("stellt die Darstellung um", () => {
    render(<AccountPage me={me} />);
    fireEvent.click(screen.getByRole("radio", { name: "Dunkel" }));
    expect(document.documentElement.dataset.theme).toBe("dunkel");
  });
});
