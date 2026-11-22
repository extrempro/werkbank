import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Feedback, FEEDBACK_SECONDS, type FeedbackMessage } from "./Feedback";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Host({ initial }: { initial: FeedbackMessage | null }) {
  const [message, setMessage] = useState(initial);
  return (
    <main>
      <p>Seite</p>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </main>
  );
}

describe("Feedback", () => {
  it("zeigt Erfolg außerhalb der Seite und blendet ihn von selbst aus", () => {
    vi.useFakeTimers();
    render(<Host initial={{ kind: "status", text: "Gespeichert." }} />);
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Gespeichert.");
    expect(toast.closest(".feedback-region")).not.toBeNull();
    expect(toast.closest("main")).toBeNull();
    act(() => vi.advanceTimersByTime(FEEDBACK_SECONDS * 1000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("pausiert, solange die Maus darauf steht", () => {
    vi.useFakeTimers();
    render(<Host initial={{ kind: "status", text: "Gespeichert." }} />);
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(FEEDBACK_SECONDS * 2000));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("lässt Fehler stehen, bis man sie schließt", () => {
    vi.useFakeTimers();
    render(<Host initial={{ kind: "alert", text: "Konnte nicht gespeichert werden." }} />);
    act(() => vi.advanceTimersByTime(FEEDBACK_SECONDS * 5000));
    expect(screen.getByRole("alert")).toHaveTextContent("Konnte nicht gespeichert werden.");
    fireEvent.click(screen.getByRole("button", { name: "Meldung schließen" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("zeigt nichts ohne Meldung", () => {
    render(<Host initial={null} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
