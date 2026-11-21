import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/* Trenner zwischen Liste/Tabelle und Ansicht: Breite der Liste in Prozent (30–75),
   gemerkt im Browser unter einem Schlüssel je Seite. Gestaltung in styles.css (.case-split). */

const SPLIT_DEFAULT = 54;
const SPLIT_MIN = 30;
const SPLIT_MAX = 75;
const SPLIT_STEP = 2;

function clampSplit(value: number): number {
  return Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value)));
}

function readSplit(key: string): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return value ? clampSplit(value) : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

function saveSplit(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ohne Speicher im Browser gilt die Breite nur bis zum Neuladen
  }
}

/** Trenner zwischen Tabelle und Ansicht: ziehen oder mit den Pfeiltasten verschieben. */
export function SplitHandle({
  value,
  onChange,
  container,
}: {
  value: number;
  onChange: (next: number) => void;
  container: () => HTMLElement | null;
}) {
  const dragging = useRef(false);
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = container()?.getBoundingClientRect();
    if (box && box.width > 0) {
      onChange(clampSplit(((event.clientX - box.left) / box.width) * 100));
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? value - SPLIT_STEP
        : event.key === "ArrowRight"
          ? value + SPLIT_STEP
          : event.key === "Home"
            ? SPLIT_MIN
            : event.key === "End"
              ? SPLIT_MAX
              : null;
    if (next !== null) {
      event.preventDefault();
      onChange(clampSplit(next));
    }
  };
  return (
    <div
      className="case-split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite von Tabelle und Ansicht"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={value}
      aria-valuetext={`Tabelle ${value} Prozent`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(SPLIT_DEFAULT)}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => dragging.current && fromPointer(event)}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}

/** Breite der Liste und Funktion zum Ändern, die sie auch im Browser speichert. */
export function useSplit(key: string): [number, (next: number) => void] {
  const [split, setSplit] = useState(() => readSplit(key));
  const change = (next: number) => {
    setSplit(next);
    saveSplit(key, next);
  };
  return [split, change];
}
