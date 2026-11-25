import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComboField, type ComboItem } from "./ComboField";
import { ChoiceCards, ErrorSummary, Field, RequiredNote, Segmented } from "./Field";
import { ListChoice } from "./ListChoice";
import { SearchField, type SearchHit } from "./SearchField";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ROOMS: ComboItem[] = Array.from({ length: 31 }, (_, index) => ({
  id: index + 1,
  label: `Raum ${index + 1}`,
  detail: index < 15 ? "Gebäude A" : "Gebäude B",
}));

function search(query: string) {
  const needle = query.trim().toLowerCase();
  const hits = ROOMS.filter((room) =>
    `${room.label} ${room.detail}`.toLowerCase().includes(needle),
  );
  return Promise.resolve({ items: hits.slice(0, 20), total: hits.length });
}

function Combo() {
  const [value, setValue] = useState<ComboItem | null>(null);
  return (
    <ComboField
      label="Raum"
      required
      unit="Räume"
      value={value}
      onChange={setValue}
      search={search}
    />
  );
}

describe("Feld", () => {
  it("beschriftet über dem Feld, Pflicht mit Stern, Fehler statt Hinweis", () => {
    const { rerender } = render(
      <Field label="Name" required hint="So heißt das Gerät.">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveClass("field-control");
    expect(input).toHaveAccessibleDescription("So heißt das Gerät.");
    rerender(
      <Field label="Name" required hint="So heißt das Gerät." error="Gib einen Namen ein.">
        {(control) => <input {...control} />}
      </Field>,
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Gib einen Namen ein.");
  });

  it("fasst fehlende Angaben oben zusammen und springt zum Feld", () => {
    render(
      <>
        <RequiredNote />
        <ErrorSummary problems={[{ id: "feld-raum", label: "Raum" }]} />
        <input id="feld-raum" aria-label="Raum" />
      </>,
    );
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("1 Angabe fehlt noch.");
    fireEvent.click(within(summary).getByRole("link", { name: "Raum" }));
    expect(screen.getByRole("textbox", { name: "Raum" })).toHaveFocus();
  });

  it("wählt über Auswahlkarten", () => {
    const onChange = vi.fn();
    render(
      <ChoiceCards
        legend="Herkunft"
        value="manuell"
        onChange={onChange}
        options={[
          { value: "manuell", label: "Von Hand", hint: "Selbst erfasst" },
          { value: "leasing", label: "Leasing", hint: "Rückgabe zum Vertragsende" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: /Von Hand/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Leasing/ }));
    expect(onChange).toHaveBeenCalledWith("leasing");
  });
});

describe("Auswahl mit Echtzeitsuche", () => {
  it("öffnet beim Antippen mit Zählzeile, grenzt beim Tippen ein und übernimmt", async () => {
    render(<Combo />);
    const input = screen.getByRole("combobox", { name: "Raum" });
    fireEvent.focus(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("31 Räume · tippe zum Eingrenzen")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(20);
    fireEvent.change(input, { target: { value: "Raum 3" } });
    expect(await screen.findByText("3 Treffer")).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Raum 30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Raum ändern: Raum 30" }));
    expect(screen.getByRole("combobox", { name: "Raum" })).toBeTruthy();
  });

  it("schließt, sobald der Fokus das Feld verlässt", async () => {
    render(<Combo />);
    const input = screen.getByRole("combobox", { name: "Raum" });
    fireEvent.focus(input);
    await screen.findByText("31 Räume · tippe zum Eingrenzen");
    vi.useFakeTimers();
    fireEvent.blur(input);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Suche über Listen", () => {
  const hits: SearchHit[] = Array.from({ length: 7 }, (_, index) => ({
    key: index,
    title: `NB-01${index}`,
    extra: "Notebook · Gebäude A",
    meta: `INV-0${index}`,
    href: `/bestand/hardware/${index + 1}`,
  }));

  function Search({ list = hits }: { list?: SearchHit[] }) {
    const [value, setValue] = useState("");
    return (
      <SearchField
        value={value}
        onChange={setValue}
        hits={value ? list : []}
        total={value ? list.length : 0}
      />
    );
  }

  it("zeigt beim Tippen ein schwebendes Fenster mit höchstens fünf Treffern", () => {
    render(<Search />);
    const input = screen.getByRole("combobox", { name: "Suchen" });
    fireEvent.change(input, { target: { value: "NB" } });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Alle 7 in der Liste" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Suche leeren" }));
    expect(input).toHaveValue("");
  });

  it("meldet, wenn nichts gefunden wurde", () => {
    render(<Search list={[]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Suchen" }), {
      target: { value: "xyz" },
    });
    expect(screen.getByText("Nichts gefunden für „xyz“.")).toBeTruthy();
  });

  it("ohne Treffer-Angabe nur ein Suchfeld ohne Fenster", () => {
    render(<SearchField value="a" onChange={() => undefined} noPanel />);
    expect(screen.getByRole("searchbox", { name: "Suchen" })).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("ListChoice und Segmented", () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    label: `Konto ${index + 1}`,
    detail: index === 2 ? "Hardware" : undefined,
  }));

  it("zeigt bis zehn Möglichkeiten als Karten, mit Karte für „nichts gewählt“", () => {
    const changes: string[] = [];
    render(
      <ListChoice
        label="IT-Projekt"
        none="Kein Projekt"
        options={many.slice(0, 3)}
        value=""
        onChange={(value) => changes.push(value)}
      />,
    );
    const group = screen.getByRole("group", { name: "IT-Projekt" });
    expect(within(group).getAllByRole("radio")).toHaveLength(4);
    expect(within(group).getByRole("radio", { name: "Kein Projekt" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: /Konto 3/ }));
    expect(changes).toEqual(["3"]);
  });

  it("zeigt mehr als zehn als Suchfeld mit schwebendem Fenster", async () => {
    const changes: string[] = [];
    render(
      <ListChoice
        label="Konto"
        required
        unit="Konten"
        options={many}
        value=""
        onChange={(value) => changes.push(value)}
      />,
    );
    const box = screen.getByRole("combobox", { name: "Konto" });
    expect(box).toHaveAttribute("aria-required", "true");
    fireEvent.focus(box);
    expect(await screen.findByText("12 Konten · tippe zum Eingrenzen")).toBeVisible();
    fireEvent.change(box, { target: { value: "hardware" } });
    const list = await screen.findByRole("listbox", { name: "Konto" });
    await vi.waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    fireEvent.click(within(list).getByRole("option", { name: /Konto 3/ }));
    expect(changes).toEqual(["3"]);
  });

  it("wählt in der Knopfleiste mit aria-pressed", () => {
    const changes: string[] = [];
    render(
      <Segmented
        label="Eingangsweg"
        value="phone"
        options={[
          { value: "phone", label: "Anruf" },
          { value: "manual", label: "Von Hand erfasst" },
        ]}
        onChange={(value) => changes.push(value)}
      />,
    );
    const group = screen.getByRole("group", { name: "Eingangsweg" });
    expect(within(group).getByRole("button", { name: "Anruf" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(group).getByRole("button", { name: "Von Hand erfasst" }));
    expect(changes).toEqual(["manual"]);
  });
});
