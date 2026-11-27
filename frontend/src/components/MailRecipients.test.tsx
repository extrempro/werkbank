import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailRecipients, type MailContact } from "./MailRecipients";

function Harness({ search }: { search?: (q: string) => Promise<MailContact[]> }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <MailRecipients
      label="An"
      value={value}
      onChange={setValue}
      contacts={[{ name: "M. Muster", mail: "m.muster@example.com" }]}
      search={search}
    />
  );
}

describe("MailRecipients mit Suche", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sucht ab zwei Zeichen verzögert und zeigt Treffer mit Abteilung", async () => {
    const search = vi.fn(async () => [
      { name: "M. Muster", mail: "M.Muster@example.com", detail: "IT" },
      { name: "A. Beispiel", mail: "a.beispiel@example.com", detail: "Technik" },
    ]);
    render(<Harness search={search} />);
    const field = screen.getByRole("combobox", { name: /^An/ });

    fireEvent.change(field, { target: { value: "a" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(search).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "mu" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(search).toHaveBeenCalledWith("mu");

    // Der bekannte Kontakt erscheint nur einmal, der neue mit Abteilung und Hinweis
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getAllByRole("option", { name: /M. Muster/ })).toHaveLength(1);
    const hit = screen.getByRole("option", { name: /A. Beispiel/ });
    expect(hit).toHaveTextContent("a.beispiel@example.com · Technik");
    expect(hit).toHaveTextContent("aus Entra");

    fireEvent.mouseDown(hit);
    fireEvent.click(hit);
    expect(screen.getByRole("list", { name: "An: gewählte Empfänger" })).toHaveTextContent(
      "A. Beispiel",
    );
  });

  it("bleibt ohne Treffer bedienbar, wenn die Suche scheitert", async () => {
    const search = vi.fn(async () => {
      throw new Error("weg");
    });
    render(<Harness search={search} />);
    const field = screen.getByRole("combobox", { name: /^An/ });
    fireEvent.change(field, { target: { value: "muster" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole("option", { name: /M. Muster/ })).toBeTruthy();
  });
});
