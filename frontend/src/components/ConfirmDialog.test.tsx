import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./ConfirmDialog";

afterEach(() => cleanup());

const BOOK = { title: "Rechnung buchen?", text: "RE-1 wird gebucht.", action: "Buchen" };

describe("ConfirmButton", () => {
  it("fragt nach, startet auf „Abbrechen“ und führt erst nach Bestätigung aus", () => {
    const run = vi.fn();
    render(
      <ConfirmButton className="button" confirm={BOOK} onConfirm={run}>
        Prüfen und buchen
      </ConfirmButton>,
    );
    const trigger = screen.getByRole("button", { name: "Prüfen und buchen" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog", { name: "Rechnung buchen?" });
    expect(dialog).toHaveAccessibleDescription("RE-1 wird gebucht.");
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus();
    expect(dialog).not.toHaveTextContent("nicht rückgängig");
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Buchen" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("bricht mit Esc, „Abbrechen“ und Klick daneben ab", () => {
    const run = vi.fn();
    render(
      <ConfirmButton confirm={BOOK} onConfirm={run}>
        Buchen
      </ConfirmButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Buchen" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Buchen" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Buchen" }));
    const backdrop = screen.getByRole("alertdialog").parentElement as HTMLElement;
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("RE-1 wird gebucht."));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(backdrop);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("warnt bei Gefahr und bleibt offen, bis die Aktion fertig ist", async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ConfirmButton
        confirm={{
          title: "Posten löschen?",
          text: "Wird gelöscht.",
          action: "Löschen",
          danger: true,
        }}
        onConfirm={run}
      >
        Löschen
      </ConfirmButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Das lässt sich nicht rückgängig machen.");
    const action = within(dialog).getByRole("button", { name: "Löschen" });
    expect(action).toHaveClass("confirm-button-danger");
    fireEvent.click(action);
    expect(run).toHaveBeenCalledTimes(1);
    expect(action).toBeDisabled();
    // Während die Aktion läuft, bricht Esc nicht ab.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await act(async () => finish());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("ist ohne Freigabe des Knopfs nicht zu öffnen", () => {
    render(
      <ConfirmButton disabled confirm={BOOK} onConfirm={vi.fn()}>
        Buchen
      </ConfirmButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Buchen" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
