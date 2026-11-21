import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpProvider } from "../help/HelpContext";
import { HELP } from "../help/terms";
import { InfoTip } from "./InfoTip";

afterEach(cleanup);

function show(roles: string[]) {
  return render(
    <HelpProvider roles={roles}>
      <p>
        Verfügbar <InfoTip term="budget.verfuegbar" />
      </p>
      <button type="button">Daneben</button>
    </HelpProvider>,
  );
}

describe("InfoTip", () => {
  it("öffnet die Erklärung als Blase mit Verweis ins Handbuch und schließt wieder", () => {
    show(["Budget.Reader"]);
    const button = screen.getByRole("button", { name: "Erklärung: Verfügbar" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(HELP["budget.verfuegbar"].text)).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("status")).toHaveTextContent(HELP["budget.verfuegbar"].text);
    expect(screen.getByRole("link", { name: "Mehr im Handbuch ›" })).toHaveAttribute(
      "href",
      "/handbuch/it-budget/begriffe",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Daneben" }));
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("zeigt den Verweis nur, wenn die Person das Thema sehen darf", () => {
    show(["Evergreen.Reader"]);
    fireEvent.click(screen.getByRole("button", { name: "Erklärung: Verfügbar" }));
    expect(screen.getByRole("status")).toHaveTextContent(HELP["budget.verfuegbar"].text);
    expect(screen.queryByRole("link", { name: "Mehr im Handbuch ›" })).toBeNull();
  });
});
