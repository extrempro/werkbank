import { useId, useState } from "react";
import type { Room } from "./api";

/** Ab so vielen Räumen gruppiert die Liste nach dem Anfang der Raumnummer. */
export const GROUP_FROM = 13;

export type RoomFilter = "alle" | "frei" | "geraete" | "ohne";

const FILTERS: { id: RoomFilter; label: string; test: (room: Room) => boolean }[] = [
  { id: "alle", label: "Alle Räume", test: () => true },
  { id: "frei", label: "Freie Plätze", test: (room) => room.workplaces_free > 0 },
  { id: "geraete", label: "Mit Geräten", test: (room) => room.hardware > 0 },
  { id: "ohne", label: "Ohne Geräte", test: (room) => room.hardware === 0 },
];

/** Erste Nummer im Raumnamen, z. B. „205“ aus „R. 205 - Büro“ oder „2.14“ aus „2.14“. */
export function roomNumber(name: string): string | null {
  const found = /\d+(?:\.\d+)*/.exec(name);
  return found ? found[0] : null;
}

/**
 * Gruppe nach dem Anfang der Raumnummer: „2.14“ → „2.xx“, „205“ → „200–299“,
 * „52“ → „50–59“, „7“ → „0–9“; ohne Nummer oder mit mehr als vier Ziffern „Ohne Nummer“.
 * Der Schlüssel sortiert die Gruppen in Zahlenreihenfolge.
 */
export function roomGroup(name: string): { key: string; label: string } {
  const number = roomNumber(name);
  if (number === null || /\d{5,}/.test(number)) {
    return { key: "zzz", label: "Ohne Nummer" };
  }
  const dot = number.lastIndexOf(".");
  if (dot > 0) {
    const head = number.slice(0, dot);
    return { key: head.padStart(8, "0"), label: `${head}.xx` };
  }
  const value = Number(number);
  const step = number.length >= 3 ? 10 ** (number.length - 1) : 10;
  const start = Math.floor(value / step) * step;
  return { key: String(start).padStart(8, "0"), label: `${start}–${start + step - 1}` };
}

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

function matches(room: Room, text: string): boolean {
  if (!text) {
    return true;
  }
  const needle = text.toLocaleLowerCase("de");
  return [room.name, room.description, ...room.people].some((value) =>
    value.toLocaleLowerCase("de").includes(needle),
  );
}

function places(room: Room): string {
  if (room.workplaces === 0) {
    return "";
  }
  const taken = room.workplaces - room.workplaces_free;
  return room.workplaces === 1
    ? taken === 1
      ? "1 Arbeitsplatz belegt"
      : "1 Arbeitsplatz, frei"
    : `${taken} von ${room.workplaces} Arbeitsplätzen belegt`;
}

function devices(count: number): string {
  return count === 0 ? "–" : count === 1 ? "1 Gerät" : `${count} Geräte`;
}

/** Räume einer Etage: Suche, Auswahl „Zeigen“ und bei vielen Räumen Gruppen nach Raumnummer. */
export function RoomList({
  rooms,
  emptyText,
  onOpen,
}: {
  rooms: Room[];
  emptyText: string;
  onOpen: (room: Room) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<RoomFilter>("alle");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  if (rooms.length === 0) {
    return <p className="small room-list-head">{emptyText}</p>;
  }

  const query = text.trim();
  const found = rooms.filter((room) => matches(room, query));
  const test = FILTERS.find((entry) => entry.id === filter)?.test ?? (() => true);
  const shown = found.filter(test).sort((left, right) => collator.compare(left.name, right.name));
  const grouped = rooms.length >= GROUP_FROM;
  const groups: { key: string; label: string; rooms: Room[] }[] = [];
  for (const room of shown) {
    const group = grouped ? roomGroup(room.name) : { key: "", label: "" };
    const last = groups.find((entry) => entry.key === group.key);
    if (last) {
      last.rooms.push(room);
    } else {
      groups.push({ ...group, rooms: [room] });
    }
  }
  groups.sort((left, right) => collator.compare(left.key, right.key));
  const summary =
    shown.length === rooms.length
      ? `${rooms.length} ${rooms.length === 1 ? "Raum" : "Räume"}`
      : `${shown.length} von ${rooms.length} Räumen`;

  const toggle = (key: string) => {
    const next = new Set(closed);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setClosed(next);
  };

  const rows = (list: Room[]) => (
    <ul className="room-rows">
      {list.map((room) => {
        const line = [room.description, places(room)].filter(Boolean).join(" · ");
        return (
          <li key={room.id}>
            <button type="button" className="room-row" onClick={() => onOpen(room)}>
              <span className="room-row-main">
                <span className="room-row-name">{room.name}</span>
                {line && <span className="small room-row-line">{line}</span>}
                {room.workplaces_free > 0 && (
                  <span className="small room-row-free">
                    {room.workplaces_free === 1 ? "1 frei" : `${room.workplaces_free} frei`}
                  </span>
                )}
              </span>
              <span className="small room-row-count">{devices(room.hardware)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="room-list" role="group" aria-label="Räume dieser Etage">
      <div className="room-list-tools">
        <div className="filter-search">
          <label htmlFor={`${id}-suche`}>Raum suchen</label>
          <input
            id={`${id}-suche`}
            type="search"
            value={text}
            maxLength={100}
            autoComplete="off"
            placeholder="Raum oder Person"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="filter-field">
          <label htmlFor={`${id}-zeigen`}>Zeigen</label>
          <select
            id={`${id}-zeigen`}
            value={filter}
            onChange={(event) => setFilter(event.target.value as RoomFilter)}
          >
            {FILTERS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({found.filter(entry.test).length})
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="small room-list-head" role="status">
        {summary}
      </p>
      {shown.length === 0 && (
        <p className="small room-list-empty">Kein Raum passt zur Suche und zur Auswahl.</p>
      )}
      {grouped
        ? groups.map((group) => {
            const open = !closed.has(group.key);
            const listId = `${id}-${group.key}`;
            return (
              <section key={group.key} className="room-group">
                <h4 className="room-group-head">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => toggle(group.key)}
                  >
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                    <span className="room-group-label">Räume {group.label}</span>
                    <span className="small">
                      {group.rooms.length} {group.rooms.length === 1 ? "Raum" : "Räume"}
                    </span>
                  </button>
                </h4>
                <div id={listId} hidden={!open}>
                  {rows(group.rooms)}
                </div>
              </section>
            );
          })
        : rows(shown)}
    </div>
  );
}
