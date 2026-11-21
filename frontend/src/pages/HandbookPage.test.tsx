import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HandbookPage } from "./HandbookPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("HandbookPage", () => {
  it("zeigt nur die Kapitel der eigenen Rollen und sucht darin", () => {
    render(<HandbookPage roles={["Evergreen.Reader"]} chapterId={null} />);
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
      "/handbuch/erste-schritte#benachrichtigungen",
    );
  });

  it("zeigt ein Kapitel mit Inhalt, Anleitungen und Verweisen", () => {
    render(<HandbookPage roles={["Budget.Manager"]} chapterId="it-budget" />);
    expect(screen.getByRole("heading", { level: 1, name: "IT-Budget" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Inhalt" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Rechnungen prüfen und buchen" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Zu den Rechnungen" })).toHaveAttribute(
      "href",
      "/budget/rechnungen",
    );
    expect(screen.getByRole("link", { name: "← Erste Schritte" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Fragen und Hilfe →" })).toBeVisible();
  });

  it("blendet Abschnitte anderer Rollen aus und kennt fremde Kapitel nicht", () => {
    const { unmount } = render(<HandbookPage roles={["Budget.Reader"]} chapterId="it-budget" />);
    expect(screen.queryByRole("heading", { name: "Rechnungen prüfen und buchen" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Nur lesen" })).toBeVisible();
    unmount();
    const { container } = render(<HandbookPage roles={["Budget.Reader"]} chapterId="evergreen" />);
    expect(container.textContent).toBe("");
  });
});
