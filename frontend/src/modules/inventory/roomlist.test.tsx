import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Room } from "./api";
import { GROUP_FROM, RoomList, roomGroup, roomNumber } from "./RoomList";

function room(id: number, name: string, extra: Partial<Room> = {}): Room {
  return {
    id,
    name,
    description: "",
    x: 0,
    y: 0,
    w: 5,
    h: 5,
    hardware: 0,
    workplaces: 0,
    workplaces_free: 0,
    people: [],
    ...extra,
  };
}

describe("Raumliste: Raumnummer und Gruppen", () => {
  it("liest die Nummer und bildet Gruppen nach ihrem Anfang", () => {
    expect(roomNumber("R. 205 - Büro")).toBe("205");
    expect(roomNumber("2.14")).toBe("2.14");
    expect(roomNumber("Lager")).toBeNull();
    expect(roomGroup("R. 205 - Büro").label).toBe("200–299");
    expect(roomGroup("R. 52 - Poststelle").label).toBe("50–59");
    expect(roomGroup("Raum 7").label).toBe("0–9");
    expect(roomGroup("2.14").label).toBe("2.xx");
    expect(roomGroup("Raum 123456789").label).toBe("Ohne Nummer");
    expect(roomGroup("Lager").label).toBe("Ohne Nummer");
    expect(roomGroup("R. 99").key < roomGroup("R. 105").key).toBe(true);
  });
});

describe("Raumliste", () => {
  it("zeigt wenige Räume ohne Gruppen, mit Beschreibung, Plätzen und Geräten", () => {
    const open = vi.fn();
    render(
      <RoomList
        rooms={[
          room(1, "R. 52 - Poststelle", { hardware: 2 }),
          room(2, "R. 51", {
            description: "IT",
            workplaces: 3,
            workplaces_free: 1,
            people: ["Ina Beispiel"],
            hardware: 1,
          }),
        ]}
        emptyText="leer"
        onOpen={open}
      />,
    );
    const list = screen.getByRole("group", { name: "Räume dieser Etage" });
    const buttons = within(list).getAllByRole("button");
    // natürlich sortiert, keine Gruppen-Knöpfe
    expect(buttons.map((button) => button.textContent)).toEqual([
      "R. 51IT · 2 von 3 Arbeitsplätzen belegt1 frei1 Gerät",
      "R. 52 - Poststelle2 Geräte",
    ]);
    fireEvent.click(buttons[1]!);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));

    // Suche auch nach Personen; Auswahl mit Anzahl
    fireEvent.change(screen.getByLabelText("Raum suchen"), { target: { value: "ina" } });
    expect(screen.getByRole("status").textContent).toBe("1 von 2 Räumen");
    const select = screen.getByLabelText("Zeigen");
    expect(within(select).getByRole("option", { name: "Freie Plätze (1)" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Raum suchen"), { target: { value: "" } });
    fireEvent.change(select, { target: { value: "ohne" } });
    expect(screen.getByText("Kein Raum passt zur Suche und zur Auswahl.")).toBeTruthy();
  });

  it("gruppiert viele Räume nach Raumnummer, Gruppen lassen sich zuklappen", () => {
    const rooms = Array.from({ length: GROUP_FROM }, (_, index) =>
      room(index + 1, `R. ${index < 7 ? 201 + index : 251 + index}`),
    );
    rooms.push(room(99, "Lager"));
    render(<RoomList rooms={rooms} emptyText="leer" onOpen={() => undefined} />);
    const heads = screen.getAllByRole("button", { expanded: true });
    expect(heads.map((head) => head.textContent)).toEqual([
      "▾Räume 200–29913 Räume",
      "▾Räume Ohne Nummer1 Raum",
    ]);
    fireEvent.click(heads[1]!);
    expect(screen.queryByRole("button", { name: "Lager" })).toBeNull();
    expect(screen.getByRole("button", { name: /Ohne Nummer/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("nennt den leeren Zustand", () => {
    render(<RoomList rooms={[]} emptyText="Noch keine Räume." onOpen={() => undefined} />);
    expect(screen.getByText("Noch keine Räume.")).toBeTruthy();
  });
});
