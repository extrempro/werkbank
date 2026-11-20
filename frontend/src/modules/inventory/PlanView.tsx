import { useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { navigate } from "../../router";
import {
  clampRect,
  rectFromPoints,
  spotInfo,
  workplacePath,
  type Floor,
  type Room,
  type RoomRect,
} from "./api";

/** Platz eines Arbeitsplatzes im Grundriss, in Prozent der Etage. */
export interface PlanSpot {
  id: number;
  x: number;
  y: number;
  label: string;
  on: boolean;
  /** Info-Fenster: Überschrift und Zeilen; mit ``href`` öffnet ein Klick den Arbeitsplatz */
  title?: string;
  lines?: string[];
  href?: string;
}

type Drag =
  | { kind: "neu"; start: { x: number; y: number }; rect: RoomRect }
  | { kind: "schieben"; room: Room; offset: { x: number; y: number }; rect: RoomRect }
  | { kind: "groesse"; room: Room; rect: RoomRect };

function styleOf(rect: RoomRect) {
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`,
  };
}

/**
 * Grundriss einer Etage mit den Räumen als Rechtecke.
 *
 * Im Bearbeiten-Modus zieht man auf freier Fläche einen neuen Raum auf, verschiebt Räume und
 * ändert ihre Größe am Griff unten rechts. Für die Bedienung ohne Maus gibt es die Zahlenfelder
 * im Raum (siehe LocationsPage).
 */
export function PlanView({
  floor,
  selectedId,
  highlighted = [],
  spots = [],
  placing = false,
  editing = false,
  label,
  onSelect,
  onDraw,
  onMove,
  onPlace,
}: {
  floor: Floor;
  selectedId: number | null;
  /** weitere hervorgehobene Räume (z. B. alle Räume einer Stelle) */
  highlighted?: number[];
  /** Plätze der Arbeitsplätze; ``on`` hebt sie hervor */
  spots?: PlanSpot[];
  /** Platzieren: ein Klick in den Grundriss meldet die Stelle über ``onPlace`` */
  placing?: boolean;
  editing?: boolean;
  label: string;
  onSelect?: (room: Room) => void;
  onDraw?: (rect: RoomRect) => void;
  onMove?: (room: Room, rect: RoomRect) => void;
  onPlace?: (point: { x: number; y: number }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [openSpot, setOpenSpot] = useState<number | null>(null);
  const [touchTip, setTouchTip] = useState(false);
  // Wie zuletzt gezeigt wurde: Bei Berührung öffnet das erste Antippen das Info-Fenster.
  const pointerKind = useRef("mouse");
  const ratio = floor.plan ? `${floor.plan.width} / ${floor.plan.height}` : "4 / 3";

  const point = (event: PointerEvent) => {
    const bounds = box.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  };

  const capture = (event: PointerEvent) => {
    try {
      box.current?.setPointerCapture(event.pointerId);
    } catch {
      // ältere Browser ohne Pointer Capture
    }
  };

  const onBoxDown = (event: PointerEvent<HTMLDivElement>) => {
    if (placing) {
      event.preventDefault();
      onPlace?.(point(event));
      return;
    }
    if (!editing || event.target !== event.currentTarget) {
      return;
    }
    const start = point(event);
    capture(event);
    setDrag({ kind: "neu", start, rect: { ...start, w: 0, h: 0 } });
  };

  const onRoomDown = (event: PointerEvent, room: Room) => {
    if (placing || !editing) {
      return;
    }
    event.stopPropagation();
    const at = point(event);
    capture(event);
    onSelect?.(room);
    setDrag({
      kind: "schieben",
      room,
      offset: { x: at.x - room.x, y: at.y - room.y },
      rect: { x: room.x, y: room.y, w: room.w, h: room.h },
    });
  };

  const onHandleDown = (event: PointerEvent, room: Room) => {
    event.stopPropagation();
    capture(event);
    setDrag({ kind: "groesse", room, rect: { x: room.x, y: room.y, w: room.w, h: room.h } });
  };

  const onMoveDrag = (event: PointerEvent) => {
    if (!drag) {
      return;
    }
    const at = point(event);
    if (drag.kind === "neu") {
      setDrag({ ...drag, rect: rectFromPoints(drag.start, at) });
    } else if (drag.kind === "schieben") {
      setDrag({
        ...drag,
        rect: clampRect({ ...drag.rect, x: at.x - drag.offset.x, y: at.y - drag.offset.y }),
      });
    } else {
      setDrag({
        ...drag,
        rect: clampRect({ ...drag.rect, w: at.x - drag.rect.x, h: at.y - drag.rect.y }),
      });
    }
  };

  const onUp = () => {
    if (!drag) {
      return;
    }
    if (drag.kind === "neu") {
      // Kleine Rechtecke sind meist ein versehentlicher Klick.
      if (drag.rect.w >= 2 && drag.rect.h >= 2) {
        onDraw?.(clampRect(drag.rect));
      }
    } else {
      const { room, rect } = drag;
      if (rect.x !== room.x || rect.y !== room.y || rect.w !== room.w || rect.h !== room.h) {
        onMove?.(room, rect);
      }
    }
    setDrag(null);
  };

  return (
    <div
      ref={box}
      className={["plan-box", editing ? "plan-edit" : "", placing ? "plan-placing" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{ aspectRatio: ratio }}
      role="group"
      aria-label={label}
      onPointerDown={onBoxDown}
      onPointerMove={onMoveDrag}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
    >
      {floor.plan ? (
        <img className="plan-image" src={floor.plan.url} alt="" draggable={false} />
      ) : (
        <span className="plan-empty small">Noch kein Grundriss</span>
      )}
      {floor.rooms.map((room) => {
        const moving = drag && drag.kind !== "neu" && drag.room.id === room.id;
        const rect = moving ? drag.rect : room;
        const selected = room.id === selectedId || highlighted.includes(room.id);
        return (
          <div
            key={room.id}
            className={selected ? "plan-room plan-room-on" : "plan-room"}
            style={styleOf(rect)}
            onPointerDown={(event) => onRoomDown(event, room)}
          >
            <button
              type="button"
              className="plan-room-button"
              aria-pressed={selected}
              tabIndex={placing ? -1 : undefined}
              onClick={() => onSelect?.(room)}
            >
              {room.name}
            </button>
            {editing && selected && (
              <span
                className="plan-handle"
                aria-hidden="true"
                onPointerDown={(event) => onHandleDown(event, room)}
              />
            )}
          </div>
        );
      })}
      {spots.map((spot) => {
        const className = spot.on ? "plan-spot plan-spot-on" : "plan-spot";
        const style = { left: `${spot.x}%`, top: `${spot.y}%` };
        if (placing || editing || !spot.href) {
          return (
            <span
              key={spot.id}
              className={className}
              style={style}
              title={spot.label}
              aria-hidden="true"
            >
              {spot.on && <span className="plan-spot-label">{spot.label}</span>}
            </span>
          );
        }
        const href = spot.href;
        const text = [spot.title ?? spot.label, ...(spot.lines ?? [])];
        const open = openSpot === spot.id;
        const tipClass = [
          "plan-tip",
          spot.x > 55 ? "plan-tip-left" : "",
          spot.y > 60 ? "plan-tip-up" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={spot.id} className="plan-spot-wrap" style={style}>
            <button
              type="button"
              className={`${className} plan-spot-button`}
              aria-label={`${text.join(". ")}. Arbeitsplatz öffnen`}
              onPointerDown={(event) => {
                event.stopPropagation();
                pointerKind.current = event.pointerType;
              }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch" && event.pointerType !== "pen") {
                  setTouchTip(false);
                  setOpenSpot(spot.id);
                }
              }}
              onPointerLeave={(event) =>
                event.pointerType !== "touch" &&
                event.pointerType !== "pen" &&
                setOpenSpot((current) => (current === spot.id ? null : current))
              }
              onFocus={(event: FocusEvent<HTMLButtonElement>) => {
                if (pointerKind.current === "mouse" || focusVisible(event.currentTarget)) {
                  setTouchTip(false);
                  setOpenSpot(spot.id);
                }
              }}
              onBlur={() => setOpenSpot((current) => (current === spot.id ? null : current))}
              onKeyDown={(event) => {
                pointerKind.current = "keyboard";
                if (event.key === "Escape") {
                  setOpenSpot(null);
                }
              }}
              onClick={() => {
                const touch = pointerKind.current === "touch" || pointerKind.current === "pen";
                if (touch && !open) {
                  setTouchTip(true);
                  setOpenSpot(spot.id);
                  return;
                }
                navigate(href);
              }}
            >
              {spot.on && <span className="plan-spot-label">{spot.label}</span>}
            </button>
            {open && (
              <span className={tipClass} role="tooltip" aria-hidden="true">
                <strong>{text[0]}</strong>
                {text.slice(1).map((line, index) => (
                  <span key={index}>{line}</span>
                ))}
                <span className="plan-tip-hint">
                  {touchTip ? "Nochmal tippen zum Öffnen" : "Klick öffnet den Arbeitsplatz"}
                </span>
              </span>
            )}
          </span>
        );
      })}
      {drag && drag.kind === "neu" && drag.rect.w > 0 && (
        <span className="plan-draft" style={styleOf(drag.rect)} aria-hidden="true" />
      )}
    </div>
  );
}

function focusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** Plätze der Etage mit Info-Fenster und Link zum Arbeitsplatz (nicht hervorgehoben). */
export function planSpots(floor: Floor): PlanSpot[] {
  const rooms = new Map(floor.rooms.map((room) => [room.id, room.name]));
  return floor.workplaces.map((spot) => {
    const info = spotInfo(spot, rooms.get(spot.room_id) ?? null);
    return {
      id: spot.id,
      x: spot.x,
      y: spot.y,
      label: spot.number,
      on: false,
      title: info.title,
      lines: info.lines,
      href: workplacePath(spot.id),
    };
  });
}
