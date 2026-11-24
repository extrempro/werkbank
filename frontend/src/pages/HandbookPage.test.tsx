import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HELP } from "../help/terms";
import { HandbookPage } from "./HandbookPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("HandbookPage", () => {
  it("zeigt nur die Bereiche der eigenen Rollen und sucht darin", () => {
    render(<HandbookPage roles={["Evergreen.Reader"]} areaId={null} topicId={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Handbuch" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Evergreen" })).toHaveAttribute(
      "href",
      "/handbuch/evergreen",
    );
    expect(screen.queryByRole("link", { name: "IT-Budget" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Im Handbuch suchen"), {
      target: { value: "Glocke" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }));
    expect(screen.getByRole("link", { name: "Benachrichtigungen (Glocke)" })).toHaveAttribute(
      "href",
      "/handbuch/grundlagen/benachrichtigungen",
    );
  });

  it("zeigt einen Bereich mit seinen Teilen und Themen", () => {
    render(<HandbookPage roles={["Budget.Manager"]} areaId="it-budget" topicId={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "IT-Budget" })).toBeVisible();
    const parts = screen.getAllByRole("heading", { level: 2 }).map((head) => head.textContent);
    expect(parts).toEqual(["Überblick", "Ausgaben", "Stammdaten", "Verwaltung"]);
    expect(screen.getByRole("link", { name: "Rechnungen prüfen und buchen" })).toHaveAttribute(
      "href",
      "/handbuch/it-budget/buchen",
    );
  });

  it("zeigt ein Thema mit Pfad, Rollen, Verweis, weiteren Themen und vor/zurück", () => {
    render(<HandbookPage roles={["Budget.Manager"]} areaId="it-budget" topicId="rechnungen" />);
    expect(screen.getByRole("heading", { level: 1, name: "Rechnungen erfassen" })).toBeVisible();
    expect(screen.getByText(/›\s*Ausgaben/)).toBeVisible();
    expect(screen.getByText(/^Für: .*IT-Budget: Verwalten/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Zu den Rechnungen ›" })).toHaveAttribute(
      "href",
      "/budget/rechnungen",
    );
    const related = screen.getByRole("navigation", { name: "Weitere Themen in Ausgaben" });
    expect(within(related).getByRole("link", { name: "Verträge" })).toBeVisible();
    const pager = screen.getByRole("navigation", { name: "Vorheriges und nächstes Thema" });
    expect(within(pager).getByRole("link", { name: "‹ Budgetposten" })).toBeVisible();
    expect(
      within(pager).getByRole("link", { name: "Rechnungen prüfen und buchen ›" }),
    ).toBeVisible();
  });

  it("blendet Themen anderer Rollen aus und kennt fremde Themen nicht", () => {
    const { container } = render(
      <HandbookPage roles={["Budget.Reader"]} areaId="it-budget" topicId="buchen" />,
    );
    expect(container.textContent).toBe("");
    cleanup();
    const other = render(
      <HandbookPage roles={["Budget.Reader"]} areaId="evergreen" topicId={null} />,
    );
    expect(other.container.textContent).toBe("");
  });

  it("sammelt unter Begriffe A–Z die Erklärungen der sichtbaren Themen", () => {
    render(<HandbookPage roles={["Budget.Reader"]} areaId="hilfe" topicId="begriffe" />);
    expect(screen.getByText(HELP["budget.verfuegbar"].text, { exact: false })).toBeVisible();
    expect(screen.queryByText(HELP["evergreen.steuerbar"].text, { exact: false })).toBeNull();
    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual([...terms].sort((a, b) => (a ?? "").localeCompare(b ?? "", "de")));
  });
});
